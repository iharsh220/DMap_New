const { Op } = require('sequelize');
const {
    sequelize,
    WorkRequestManagers,
    UserDivisions,
    RequestDivisionReference,
    Tasks,
    TaskAssignments,
    IssueAssignments
} = require('../models');

const SUPER_ADMIN_ROLE_ID = 1;

const isSuperAdmin = (user) => !!(user && user.jobRole && user.jobRole.id === SUPER_ADMIN_ROLE_ID);

// Manager is assigned to the work request (work_request_managers row).
const isWorkRequestManager = async (managerId, workRequestId) => {
    if (!managerId || !workRequestId) return false;
    const row = await WorkRequestManagers.findOne({
        where: { work_request_id: workRequestId, manager_id: managerId },
        attributes: ['id']
    });
    return !!row;
};

// Manager belongs to one of the divisions linked to the request type.
// This is how issues (change requests) are scoped, see acceptIssueRequest.
const isDivisionManagerForRequestType = async (managerId, requestTypeId) => {
    if (!managerId || !requestTypeId) return false;
    const divisions = await RequestDivisionReference.findAll({
        where: { request_id: requestTypeId },
        attributes: ['division_id'],
        raw: true
    });
    if (divisions.length === 0) return false;
    const row = await UserDivisions.findOne({
        where: { user_id: managerId, division_id: { [Op.in]: divisions.map(d => d.division_id) } },
        attributes: ['id']
    });
    return !!row;
};

// Requester-side actions (PM approve / change request): the user who raised the
// work request, or a colleague in one of the requester's divisions. This matches
// who can already see the request through /work-requests/division/*.
const canActAsRequester = async (userId, requesterId) => {
    if (!userId || !requesterId) return false;
    if (userId === requesterId) return true;
    const requesterDivisions = await UserDivisions.findAll({
        where: { user_id: requesterId },
        attributes: ['division_id'],
        raw: true
    });
    if (requesterDivisions.length === 0) return false;
    const row = await UserDivisions.findOne({
        where: { user_id: userId, division_id: { [Op.in]: requesterDivisions.map(d => d.division_id) } },
        attributes: ['id']
    });
    return !!row;
};

// Read access to a work request and everything under it (tasks, issues, history, feedback),
// as one SQL condition on `work_requests w`. Allowed: the requester and colleagues in the
// requester's divisions, the request's managers, members of the request type's divisions
// (the creative team), anyone assigned to one of its tasks or issues, and past participants
// (e.g. the manager before a transfer). Super admin is handled by the callers.
// Validated on 2026-10-29: every (actor, work request) pair in the history tables passes.
// userId must be a number (it comes from the decrypted token).
const viewableWorkRequestSql = (userId) => {
    const uid = Number(userId);
    if (!Number.isSafeInteger(uid)) throw new Error('Invalid user id');
    return `(
        w.user_id = ${uid}
        OR w.user_id IN (SELECT b.user_id FROM user_divisions a JOIN user_divisions b ON b.division_id = a.division_id WHERE a.user_id = ${uid})
        OR w.id IN (SELECT m.work_request_id FROM work_request_managers m WHERE m.manager_id = ${uid})
        OR w.request_type_id IN (SELECT r.request_id FROM request_division_reference r JOIN user_divisions u ON u.division_id = r.division_id WHERE u.user_id = ${uid})
        OR w.id IN (SELECT t.work_request_id FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id WHERE ta.user_id = ${uid})
        OR w.id IN (SELECT t.work_request_id FROM tasks t JOIN issue_assignments ia ON ia.task_id = t.id JOIN issue_user_assignments iu ON iu.issue_assignment_id = ia.id WHERE iu.user_id = ${uid})
        OR w.id IN (SELECT th.work_request_id FROM task_history th WHERE th.actor_id = ${uid} OR th.assigned_to_user_id = ${uid})
        OR w.id IN (SELECT wh.work_request_id FROM work_request_history wh WHERE wh.actor_id = ${uid})
    )`;
};

const canViewWorkRequest = async (user, workRequestId) => {
    if (!user || !workRequestId) return false;
    if (isSuperAdmin(user)) return true;
    const rows = await sequelize.query(
        `SELECT 1 AS ok FROM work_requests w WHERE w.id = :workRequestId AND ${viewableWorkRequestSql(user.id)} LIMIT 1`,
        { replacements: { workRequestId }, type: sequelize.QueryTypes.SELECT }
    );
    return rows.length > 0;
};

// Subquery selecting the ids of work requests this user may view (null = no restriction),
// for use as `... work_request_id IN ${subquery}` in list queries
const viewableWorkRequestIdsSubquery = (user) => {
    if (isSuperAdmin(user)) return null;
    return `(SELECT w.id FROM work_requests w WHERE ${viewableWorkRequestSql(user.id)})`;
};

const workRequestIdForTask = async (taskId) => {
    const task = await Tasks.findByPk(taskId, { attributes: ['work_request_id'] });
    return task ? task.work_request_id : null;
};

const workRequestIdForIssue = async (issueAssignmentId) => {
    const issue = await IssueAssignments.findByPk(issueAssignmentId, {
        attributes: ['id'],
        include: [{ model: Tasks, as: 'task', attributes: ['work_request_id'] }]
    });
    return issue && issue.task ? issue.task.work_request_id : null;
};

// Delegation (re)assignment of a task: allowed for super admin, the request's managers,
// managers in the task's request-type division, and the task's current assignee (a manager
// who received the task and passes it on to their team). Checked against all historical
// reassignments in the data on 2026-10-29.
const canDelegateTask = async (user, task) => {
    if (!user || !task) return false;
    if (isSuperAdmin(user)) return true;
    if (await isWorkRequestManager(user.id, task.work_request_id)) return true;
    if (await isDivisionManagerForRequestType(user.id, task.request_type_id)) return true;
    const currentAssignment = await TaskAssignments.findOne({ where: { task_id: task.id, user_id: user.id }, attributes: ['id'] });
    return !!currentAssignment;
};

module.exports = {
    isSuperAdmin,
    isWorkRequestManager,
    isDivisionManagerForRequestType,
    canActAsRequester,
    canViewWorkRequest,
    viewableWorkRequestIdsSubquery,
    workRequestIdForTask,
    workRequestIdForIssue,
    canDelegateTask
};
