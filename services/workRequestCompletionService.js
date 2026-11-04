const { sequelize } = require('../config/databaseConfig');
const { WorkRequests } = require('../models');
const { recordWorkRequestHistory } = require('./historyService');

// A work request is finished when it has at least one live task and every live task and
// change request (issue) on it is completed and finally approved by the PM/requester.
// Cancelled / rejected / soft-deleted tasks and issues don't count either way.
// Only requests that are underway are completed; pending, deferred, cancelled and already
// completed requests are never touched.
const OPEN_WORK_REQUEST_STATUSES = ['accepted', 'assigned', 'in_progress'];
const IGNORED_ITEM_STATUSES = "('cancelled', 'rejected')";

const SYSTEM_ACTOR = { id: null, actor_type: 'system', name: 'System (daily completion check)', email: null };

const finishedWorkRequests = async (workRequestIds = null) => {
    if (workRequestIds && workRequestIds.length === 0) return [];
    return sequelize.query(`
        SELECT wr.id, wr.status, wr.user_id
        FROM work_requests wr
        WHERE wr.is_deleted = 0
          AND wr.status IN (:openStatuses)
          ${workRequestIds ? 'AND wr.id IN (:workRequestIds)' : ''}
          AND EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.work_request_id = wr.id AND t.is_deleted = 0 AND t.status NOT IN ${IGNORED_ITEM_STATUSES}
          )
          AND NOT EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.work_request_id = wr.id AND t.is_deleted = 0 AND t.status NOT IN ${IGNORED_ITEM_STATUSES}
                AND NOT (t.status = 'completed' AND t.review = 'approved' AND t.review_stage = 'final_approved')
          )
          AND NOT EXISTS (
              SELECT 1 FROM issue_assignments ia
              JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0 AND t.status NOT IN ${IGNORED_ITEM_STATUSES}
              WHERE t.work_request_id = wr.id AND ia.is_deleted = 0 AND ia.status NOT IN ${IGNORED_ITEM_STATUSES}
                AND NOT (ia.status = 'completed' AND ia.review = 'approved' AND ia.review_stage = 'final_approved')
          )`, {
        replacements: { openStatuses: OPEN_WORK_REQUEST_STATUSES, workRequestIds },
        type: sequelize.QueryTypes.SELECT
    });
};

// Marks each finished request completed (guarded by its current status, so a request that
// changed in the meantime is skipped) and records it in work_request_history.
const completeWorkRequests = async (rows, { req = null, actorOverride = null, comments, relatedTaskId = null, relatedIssueId = null }) => {
    const completedIds = [];
    for (const row of rows) {
        const [updated] = await WorkRequests.update(
            { status: 'completed' },
            { where: { id: row.id, status: row.status, is_deleted: 0 } }
        );
        if (!updated) continue;
        completedIds.push(row.id);
        await recordWorkRequestHistory({
            req,
            workRequestId: row.id,
            action: 'auto_completed',
            previousData: { status: row.status },
            nextData: { status: 'completed' },
            previousStatus: row.status,
            newStatus: 'completed',
            relatedUserId: row.user_id,
            relatedTaskId,
            relatedIssueId,
            comments,
            actorOverride
        });
    }
    return completedIds;
};

// Called right after a PM/requester approval: completes the request if that was the last open item.
const completeWorkRequestIfFinished = async (workRequestId, { req, relatedTaskId = null, relatedIssueId = null } = {}) => {
    if (!workRequestId) return false;
    const rows = await finishedWorkRequests([workRequestId]);
    const done = await completeWorkRequests(rows, {
        req,
        relatedTaskId,
        relatedIssueId,
        comments: 'Work request completed automatically: all tasks and change requests are completed and approved'
    });
    return done.length > 0;
};

// Daily safety net (scheduler): completes every request whose work is all done and approved,
// e.g. ones approved before this check existed or finished by a path that did not check.
const completeAllFinishedWorkRequests = async () => {
    const rows = await finishedWorkRequests();
    const completedIds = await completeWorkRequests(rows, {
        actorOverride: SYSTEM_ACTOR,
        comments: 'Work request completed by the daily check: all tasks and change requests are completed and approved'
    });
    return { success: true, checked: rows.length, completed: completedIds.length, workRequestIds: completedIds };
};

module.exports = {
    finishedWorkRequests,
    completeWorkRequestIfFinished,
    completeAllFinishedWorkRequests
};
