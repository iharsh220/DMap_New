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

// Creative Manager / Creative Lead (manager-level routes use checkRole([1, 2, 3]))
const MANAGER_ROLE_IDS = [2, 3];
// Creative roles: they deliver work, they are not the requester side (PMT)
const CREATIVE_ROLE_IDS = [2, 3, 4];

const roleIdOf = (user) => (user && user.jobRole ? Number(user.jobRole.id) : null);
const isManagerRole = (user) => MANAGER_ROLE_IDS.includes(roleIdOf(user));

const safeUid = (userId) => {
    const uid = Number(userId);
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error('Invalid user id');
    return uid;
};

// "Task manager" of the task with alias `t` (owner's rule, 2026-11-04): the request's managers
// (project managers), the manager the task was delegated to (current assignee or anyone in the
// task's 'assigned' history), and the artist's manager (shares a division with the task's or one
// of its changes' assignees). Only meaningful for manager-role callers.
// Validated on the dump: all but one of the 4,870 manager actions on change requests in
// issue_history pass.
const taskManagerSql = (userId, t = 't') => {
    const uid = safeUid(userId);
    return `(
        EXISTS (SELECT 1 FROM work_request_managers m WHERE m.work_request_id = ${t}.work_request_id AND m.manager_id = ${uid})
        OR EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = ${t}.id AND ta.user_id = ${uid})
        OR EXISTS (SELECT 1 FROM task_history th WHERE th.task_id = ${t}.id AND th.action = 'assigned' AND (th.actor_id = ${uid} OR th.assigned_to_user_id = ${uid}))
        OR EXISTS (SELECT 1 FROM task_assignments ta JOIN user_divisions a ON a.user_id = ta.user_id JOIN user_divisions b ON b.division_id = a.division_id AND b.user_id = ${uid} WHERE ta.task_id = ${t}.id)
        OR EXISTS (SELECT 1 FROM issue_assignments ia JOIN issue_user_assignments iu ON iu.issue_assignment_id = ia.id JOIN user_divisions a ON a.user_id = iu.user_id JOIN user_divisions b ON b.division_id = a.division_id AND b.user_id = ${uid} WHERE ia.task_id = ${t}.id)
    )`;
};

// Read access to a work request and everything under it (tasks, issues, history, feedback),
// as one SQL condition on `work_requests w` (owner's rule R2, 2026-11-04). Allowed:
// - the requester, and (requester side only, not creative roles) colleagues in the requester's divisions;
// - the request's managers;
// - anyone assigned to one of its tasks or changes, and past task participants (task_history);
// - managers who are a task manager of one of its tasks (delegated manager, artist's manager).
// No longer allowed: every member of the request type's division (artists saw all their vertical's
// requests) and actors that appear only in work_request_history (a manager who deferred the request
// to someone else). Super admin is handled by the callers.
// `user` is the token user (id + jobRole); a bare id is treated as a requester-side user.
const viewableWorkRequestSql = (user) => {
    const u = (user && typeof user === 'object') ? user : { id: user };
    const uid = safeUid(u.id);
    const roleId = roleIdOf(u);
    const parts = [
        `w.user_id = ${uid}`,
        `w.id IN (SELECT m.work_request_id FROM work_request_managers m WHERE m.manager_id = ${uid})`,
        `w.id IN (SELECT t.work_request_id FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id WHERE ta.user_id = ${uid})`,
        `w.id IN (SELECT t.work_request_id FROM tasks t JOIN issue_assignments ia ON ia.task_id = t.id JOIN issue_user_assignments iu ON iu.issue_assignment_id = ia.id WHERE iu.user_id = ${uid})`,
        `w.id IN (SELECT th.work_request_id FROM task_history th WHERE th.actor_id = ${uid} OR th.assigned_to_user_id = ${uid})`
    ];
    if (!CREATIVE_ROLE_IDS.includes(roleId)) {
        parts.push(`w.user_id IN (SELECT b.user_id FROM user_divisions a JOIN user_divisions b ON b.division_id = a.division_id WHERE a.user_id = ${uid})`);
    }
    if (MANAGER_ROLE_IDS.includes(roleId)) {
        parts.push(`w.id IN (SELECT t.work_request_id FROM tasks t WHERE ${taskManagerSql(uid, 't')})`);
    }
    return `(\n        ${parts.join('\n        OR ')}\n    )`;
};

const canViewWorkRequest = async (user, workRequestId) => {
    if (!user || !workRequestId) return false;
    if (isSuperAdmin(user)) return true;
    const rows = await sequelize.query(
        `SELECT 1 AS ok FROM work_requests w WHERE w.id = :workRequestId AND ${viewableWorkRequestSql(user)} LIMIT 1`,
        { replacements: { workRequestId }, type: sequelize.QueryTypes.SELECT }
    );
    return rows.length > 0;
};

// Subquery selecting the ids of work requests this user may view (null = no restriction),
// for use as `... work_request_id IN ${subquery}` in list queries
const viewableWorkRequestIdsSubquery = (user) => {
    if (isSuperAdmin(user)) return null;
    return `(SELECT w.id FROM work_requests w WHERE ${viewableWorkRequestSql(user)})`;
};

// Manager-level action on a task (review, share, accept/assign/cancel its changes, delegate):
// super admin, or a manager-role user who is a task manager (see taskManagerSql).
const isTaskManager = async (user, taskId) => {
    if (!user || !taskId) return false;
    if (isSuperAdmin(user)) return true;
    if (!isManagerRole(user)) return false;
    const rows = await sequelize.query(
        `SELECT 1 AS ok FROM tasks t WHERE t.id = :taskId AND ${taskManagerSql(user.id, 't')} LIMIT 1`,
        { replacements: { taskId }, type: sequelize.QueryTypes.SELECT }
    );
    return rows.length > 0;
};

// Delegation (owner's rule, 2026-11-06): when a project manager gives a task to a manager of
// another vertical (Manager -> Manager -> User), that manager is the task's handler: only he (and
// super admin) may act on it; the project manager and the others can still view it.
// Handler = the manager the task is assigned to, otherwise the manager who last assigned it
// ('assigned' history). Only a handler who is NOT one of the project's managers counts as a
// delegation; tasks handled by the project's own managers keep the task-manager rule above.
// Returns the handler's user id, or null when the task is not delegated.
const delegatedHandler = async (taskId) => {
    if (!taskId) return null;
    const rows = await sequelize.query(
        `SELECT h.handler FROM (
            SELECT ta.user_id AS handler, 2 AS pri, NULL AS at FROM task_assignments ta
              JOIN users u ON u.id = ta.user_id AND u.job_role_id IN (:roles) WHERE ta.task_id = :taskId
            UNION ALL
            SELECT th.actor_id, 1, th.created_at FROM task_history th
              JOIN users u ON u.id = th.actor_id AND u.job_role_id IN (:roles) WHERE th.task_id = :taskId AND th.action = 'assigned'
         ) h
         JOIN tasks t ON t.id = :taskId
         WHERE h.handler NOT IN (SELECT m.manager_id FROM work_request_managers m WHERE m.work_request_id = t.work_request_id)
         ORDER BY h.pri DESC, h.at DESC LIMIT 1`,
        { replacements: { taskId, roles: MANAGER_ROLE_IDS }, type: sequelize.QueryTypes.SELECT }
    );
    // the newest assigner / current assignee may be a project manager again (task given back):
    // then it is no longer delegated
    const [latest] = await sequelize.query(
        `SELECT h.handler FROM (
            SELECT ta.user_id AS handler, 2 AS pri, NULL AS at FROM task_assignments ta
              JOIN users u ON u.id = ta.user_id AND u.job_role_id IN (:roles) WHERE ta.task_id = :taskId
            UNION ALL
            SELECT th.actor_id, 1, th.created_at FROM task_history th
              JOIN users u ON u.id = th.actor_id AND u.job_role_id IN (:roles) WHERE th.task_id = :taskId AND th.action = 'assigned'
         ) h ORDER BY h.pri DESC, h.at DESC LIMIT 1`,
        { replacements: { taskId, roles: MANAGER_ROLE_IDS }, type: sequelize.QueryTypes.SELECT }
    );
    if (!rows.length || !latest || Number(latest.handler) !== Number(rows[0].handler)) return null;
    return Number(rows[0].handler);
};

// The task was delegated to another manager than `user` (so `user` may only view it)
const isDelegatedAway = async (user, taskId) => {
    if (!user || isSuperAdmin(user)) return false;
    const handler = await delegatedHandler(taskId);
    return handler !== null && handler !== Number(user.id);
};

// Manager-level ACTION on a task: a task manager (see isTaskManager) that the task was not
// delegated away from. Viewing still uses isTaskManager / canViewWorkRequest.
const canActOnTask = async (user, taskId) => {
    if (!(await isTaskManager(user, taskId))) return false;
    return !(await isDelegatedAway(user, taskId));
};

// Subquery of the task ids this manager may act on (null = no restriction, super admin)
const managedTaskIdsSubquery = (user) => {
    if (isSuperAdmin(user)) return null;
    if (!isManagerRole(user)) return '(SELECT NULL FROM DUAL WHERE 1 = 0)';
    return `(SELECT t.id FROM tasks t WHERE ${taskManagerSql(user.id, 't')})`;
};

// The two users share at least one division (same team)
const sharesDivision = async (userIdA, userIdB) => {
    if (!userIdA || !userIdB) return false;
    const rows = await sequelize.query(
        `SELECT 1 AS ok FROM user_divisions a JOIN user_divisions b ON b.division_id = a.division_id
         WHERE a.user_id = :a AND b.user_id = :b LIMIT 1`,
        { replacements: { a: userIdA, b: userIdB }, type: sequelize.QueryTypes.SELECT }
    );
    return rows.length > 0;
};

// A Creative Manager / Lead of one of the Digilabs department's divisions (delegation target)
const isDigilabsManager = async (userId) => {
    if (!userId) return false;
    const rows = await sequelize.query(
        `SELECT 1 AS ok FROM users u
         JOIN user_divisions ud ON ud.user_id = u.id
         JOIN division d ON d.id = ud.division_id
         JOIN department dep ON dep.id = d.department_id AND dep.department_name = 'Digilabs'
         WHERE u.id = :userId AND u.job_role_id IN (:roles) LIMIT 1`,
        { replacements: { userId, roles: MANAGER_ROLE_IDS }, type: sequelize.QueryTypes.SELECT }
    );
    return rows.length > 0;
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

// Who may (re)assign a task (POST /users/assign-task): super admin or a task manager
// (request manager, the manager it was delegated to, the artist's manager). Managers of the
// request type's division that are not involved may no longer do it (owner's rule, 2026-11-04).
const canDelegateTask = async (user, task) => {
    if (!user || !task) return false;
    return canActOnTask(user, task.id);
};

// To whom a task may be given (owner's rule, 2026-11-04), checked for createTask and assign-task:
// - super admin: anyone in the task's request-type division (as before);
// - a request manager: an artist of their own team (shares a division with them), or a
//   Creative Manager / Lead of a Digilabs division (delegation, Manager -> Manager -> User);
// - anyone else (the manager the task was delegated to, the artist's manager): only someone of
//   their own team.
// Returns null when allowed, otherwise the error message for a 403.
// Checked on the dump: 148 of 149 reassignments in task_history are own-team, the other one is a
// manager -> manager delegation. At creation, 73 tasks went straight to another vertical's artist
// (Content); those managers now have to give the task to the Content manager.
const assignTargetError = async (user, task, assigneeId, { isRequestManager } = {}) => {
    if (isSuperAdmin(user)) {
        return (await isDivisionManagerForRequestType(assigneeId, task.request_type_id))
            ? null : 'User does not belong to the division of this task';
    }
    if (Number(assigneeId) === Number(user.id)) return null;
    if (await sharesDivision(user.id, assigneeId)) return null;
    const requestManager = isRequestManager !== undefined
        ? isRequestManager
        : await isWorkRequestManager(user.id, task.work_request_id);
    if (requestManager && await isDigilabsManager(assigneeId)) return null;
    return requestManager
        ? 'You can assign a task only to an artist of your own team, or delegate it to a manager of another Digilabs division'
        : 'You can assign this task only to an artist of your own team';
};

module.exports = {
    MANAGER_ROLE_IDS,
    isSuperAdmin,
    isManagerRole,
    isWorkRequestManager,
    isDivisionManagerForRequestType,
    canActAsRequester,
    taskManagerSql,
    canViewWorkRequest,
    viewableWorkRequestSql,
    viewableWorkRequestIdsSubquery,
    isTaskManager,
    canActOnTask,
    isDelegatedAway,
    delegatedHandler,
    managedTaskIdsSubquery,
    sharesDivision,
    isDigilabsManager,
    workRequestIdForTask,
    workRequestIdForIssue,
    canDelegateTask,
    assignTargetError
};
