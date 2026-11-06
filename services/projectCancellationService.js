// Project cancellation (owner's requirement, 2026-11-06).
//   - Who: the request's managers (work_request_managers) and Super Admin.
//   - When: the cancellation date is always today; a reason is required; projects that are
//     completed / cancelled / rejected / deleted cannot be cancelled.
//   - Tasks and changes of the project:
//       started, not submitted (in_progress, or accepted / u_accepted with start <= today)
//                           -> 'cancelled', start kept, end date = cancellation date
//       not started (pending, assigned, accepted / u_accepted with a future start, m_pending,
//                    m_accepted, u_pending, on_hold, draft, deferred)
//                           -> 'cancelled', no start / end date
//       submitted, awaiting review / approval (completed, not final approved)
//                           -> unchanged; flagged; the normal review + PMT approval still works
//       completed + final approved, cancelled, rejected            -> unchanged
//   - Audit: one work_request_history row 'cancelled' (reason, date, summary, every item that
//     changed with its old and new status / dates) and one task / issue history row per item.
//   - After the cancellation the project is read-only (see `blockIfProjectCancelled`), except the
//     review / approval of submitted work.
//   - Assigned CUs, the request's managers and the requester are emailed.
const { sequelize } = require('../config/databaseConfig');
const { recordWorkRequestHistory, recordTaskHistory, recordIssueHistory } = require('./historyService');
const { isSuperAdmin, workRequestIdForTask, workRequestIdForIssue } = require('./accessService');
const { todayDateOnly } = require('../utils/validators');
const { sendMail } = require('./mailService');
const { renderTemplate } = require('./templateService');
const { clearAdminCache } = require('./adminCacheService');

const SELECT = { type: sequelize.QueryTypes.SELECT };
const q = (text, replacements = {}, transaction) => sequelize.query(text, Object.assign({ replacements, transaction }, SELECT));

const NOT_CANCELLABLE = ['completed', 'cancelled', 'rejected'];
const REASON_MIN = 5;
const REASON_MAX = 1000;

class CancelError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const isFinal = x => x.review === 'approved' && x.review_stage === 'final_approved';

// category of one task / change for a cancellation on `today`
const classify = (kind, x, today) => {
    if (x.status === 'cancelled' || x.status === 'rejected') return 'closed';
    if (x.status === 'completed') return isFinal(x) ? 'completed' : 'pending_approval';
    const acceptedStatus = kind === 'task' ? 'accepted' : 'u_accepted';
    const started = x.status === 'in_progress' || (x.status === acceptedStatus && x.start_date && x.start_date <= today);
    return started ? 'in_progress' : 'not_started';
};

const newValues = (category, x, today) => {
    if (category === 'in_progress') {
        return { status: 'cancelled', start_date: x.start_date && x.start_date <= today ? x.start_date : today, end_date: today };
    }
    if (category === 'not_started') return { status: 'cancelled', start_date: null, end_date: null };
    return null;
};

const load = async (workRequestId, transaction) => {
    const [project] = await q(`
        SELECT wr.id, wr.project_name, wr.status, wr.is_deleted, wr.user_id, wr.priority,
               ru.name AS requester_name, ru.email AS requester_email
        FROM work_requests wr LEFT JOIN users ru ON ru.id = wr.user_id
        WHERE wr.id = :id`, { id: workRequestId }, transaction);
    if (!project || project.is_deleted) return null;
    const tasks = await q(`
        SELECT t.id, t.task_name, t.status, t.review, t.review_stage, t.start_date, t.end_date, t.deadline, t.task_count
        FROM tasks t WHERE t.work_request_id = :id AND t.is_deleted = 0 ORDER BY t.id`, { id: workRequestId }, transaction);
    const changes = await q(`
        SELECT ia.id, ia.task_id, ia.version, ia.status, ia.review, ia.review_stage, ia.start_date, ia.end_date, ia.deadline, ia.task_count,
               t.task_name
        FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
        WHERE t.work_request_id = :id AND ia.is_deleted = 0 ORDER BY ia.task_id, ia.id`, { id: workRequestId }, transaction);
    const people = await q(`
        SELECT DISTINCT u.id, u.name, u.email, 'manager' AS kind FROM work_request_managers wrm JOIN users u ON u.id = wrm.manager_id
         WHERE wrm.work_request_id = :id
        UNION SELECT DISTINCT u.id, u.name, u.email, 'assignee' FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id AND t.is_deleted = 0
         JOIN users u ON u.id = ta.user_id WHERE t.work_request_id = :id
        UNION SELECT DISTINCT u.id, u.name, u.email, 'assignee' FROM issue_user_assignments iua JOIN issue_assignments ia ON ia.id = iua.issue_assignment_id AND ia.is_deleted = 0
         JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0 JOIN users u ON u.id = iua.user_id WHERE t.work_request_id = :id`, { id: workRequestId }, transaction);
    const [latest] = await q(`
        SELECT GREATEST(
            COALESCE((SELECT MAX(DATE(td.uploaded_at)) FROM task_documents td JOIN task_assignments ta ON ta.id = td.task_assignment_id
                       JOIN tasks t ON t.id = ta.task_id AND t.is_deleted = 0 WHERE t.work_request_id = :id), '1000-01-01'),
            COALESCE((SELECT MAX(DATE(idc.uploaded_at)) FROM issue_documents idc JOIN issue_user_assignments iua ON iua.id = idc.issue_user_assignment_id
                       JOIN issue_assignments ia ON ia.id = iua.issue_assignment_id AND ia.is_deleted = 0
                       JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0 WHERE t.work_request_id = :id), '1000-01-01')
        ) AS last_upload`, { id: workRequestId }, transaction);
    return { project, tasks, changes, people, lastUpload: latest && latest.last_upload !== '1000-01-01' ? latest.last_upload : null };
};

const canCancel = async (user, workRequestId) => {
    if (isSuperAdmin(user)) return true;
    const [row] = await q('SELECT 1 AS ok FROM work_request_managers WHERE work_request_id = :id AND manager_id = :uid LIMIT 1', { id: workRequestId, uid: user.id });
    return !!row;
};

// what a cancellation today would do; `blockers` lists why it cannot be done
const plan = (data, today) => {
    const { project, tasks, changes } = data;
    const blockers = [];
    if (NOT_CANCELLABLE.includes(project.status)) blockers.push(`The project is already ${project.status}`);
    const items = [];
    const summary = {};
    for (const [kind, list] of [['task', tasks], ['change', changes]]) {
        const counts = { in_progress: 0, not_started: 0, pending_approval: 0, completed: 0, closed: 0 };
        for (const x of list) {
            const category = classify(kind, x, today);
            counts[category]++;
            const next = newValues(category, x, today);
            items.push({
                kind, id: x.id, task_id: kind === 'change' ? x.task_id : x.id, name: x.task_name, version: x.version || null,
                category, status: x.status, start_date: x.start_date, end_date: x.end_date,
                new_status: next ? next.status : x.status,
                new_start_date: next ? next.start_date : x.start_date,
                new_end_date: next ? next.end_date : x.end_date,
                flagged: category === 'pending_approval'
            });
        }
        summary[kind === 'task' ? 'tasks' : 'changes'] = counts;
    }
    // the cancellation date (today) must not be before the start of the project's work, nor before
    // its latest recorded work (dates and uploads; D-Map has no time entries)
    const workDates = items.filter(i => ['in_progress', 'pending_approval', 'completed'].includes(i.category))
        .flatMap(i => [i.start_date, i.end_date]).filter(Boolean);
    if (data.lastUpload) workDates.push(data.lastUpload);
    const projectStart = items.filter(i => i.category !== 'not_started' && i.start_date).map(i => i.start_date).sort()[0] || null;
    const latestWork = workDates.sort().pop() || null;
    if (projectStart && projectStart > today) blockers.push(`The project's work starts on ${projectStart}, after today`);
    if (latestWork && latestWork > today) blockers.push(`Work is recorded on ${latestWork}, after today; correct that date first`);
    return { cancel_date: today, blockers, summary, items, project_start: projectStart, latest_work: latestWork };
};

const publicProject = p => ({ id: p.id, project_name: p.project_name, status: p.status, requester_name: p.requester_name });

const preview = async (user, workRequestId) => {
    const data = await load(workRequestId);
    if (!data) throw new CancelError(404, 'Work request not found');
    if (!(await canCancel(user, workRequestId))) throw new CancelError(404, 'Work request not found or not assigned to you');
    const p = plan(data, todayDateOnly());
    return {
        project: publicProject(data.project),
        can_cancel: p.blockers.length === 0,
        ...p,
        notify: data.people.concat(data.project.requester_email ? [{ id: data.project.user_id, name: data.project.requester_name, email: data.project.requester_email, kind: 'requester' }] : [])
            .map(x => ({ id: x.id, name: x.name, kind: x.kind }))
    };
};

const parseReason = (reason) => {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < REASON_MIN) throw new CancelError(400, `A reason for the cancellation is required (at least ${REASON_MIN} characters)`);
    if (text.length > REASON_MAX) throw new CancelError(400, `The reason can have at most ${REASON_MAX} characters`);
    return text;
};

const cancel = async (req, workRequestId, body = {}) => {
    const user = req.user;
    const reason = parseReason(body.reason !== undefined ? body.reason : body.cancel_reason);
    const first = await load(workRequestId);
    if (!first) throw new CancelError(404, 'Work request not found');
    if (!(await canCancel(user, workRequestId))) throw new CancelError(404, 'Work request not found or not assigned to you');
    const today = todayDateOnly();

    const result = await sequelize.transaction(async (transaction) => {
        // re-read inside the transaction, with the project row locked
        await q('SELECT id FROM work_requests WHERE id = :id FOR UPDATE', { id: workRequestId }, transaction);
        const data = await load(workRequestId, transaction);
        const p = plan(data, today);
        if (p.blockers.length) throw new CancelError(400, p.blockers.join('; '));

        const wrRes = await sequelize.query(
            `UPDATE work_requests SET status = 'cancelled', notification_alert = 0
             WHERE id = :id AND is_deleted = 0 AND status NOT IN ('completed', 'cancelled', 'rejected')`,
            { replacements: { id: workRequestId }, transaction });
        if (!affected(wrRes)) throw new CancelError(409, 'The project changed in the meantime; reload and try again');

        const comment = `Project cancelled on ${today}: ${reason}`;
        for (const item of p.items) {
            if (!['in_progress', 'not_started'].includes(item.category)) continue;
            const table = item.kind === 'task' ? 'tasks' : 'issue_assignments';
            const upd = await sequelize.query(
                `UPDATE ${table} SET status = 'cancelled', start_date = :start, end_date = :end, notification_alert = 0
                 WHERE id = :id AND status = :status AND is_deleted = 0`,
                { replacements: { id: item.id, status: item.status, start: item.new_start_date, end: item.new_end_date }, transaction });
            if (!affected(upd)) throw new CancelError(409, `The ${item.kind} #${item.id} changed in the meantime; reload and try again`);
            const before = { status: item.status, start_date: item.start_date, end_date: item.end_date };
            const after = { status: 'cancelled', start_date: item.new_start_date, end_date: item.new_end_date };
            const common = {
                req, transaction, workRequestId, action: 'cancelled_with_project', previousData: before, nextData: after,
                previousStatus: item.status, newStatus: 'cancelled',
                comments: item.category === 'in_progress' ? `${comment} (work had started; end date set to the cancellation date)` : `${comment} (not started)`
            };
            if (item.kind === 'task') await recordTaskHistory(Object.assign({ taskId: item.id }, common));
            else await recordIssueHistory(Object.assign({ issueAssignmentId: item.id, taskId: item.task_id }, common));
        }
        // submitted work still waiting for review / approval stays as it is: flag it in its history
        for (const item of p.items.filter(i => i.flagged)) {
            const common = { req, transaction, workRequestId, action: 'flagged_on_cancellation', previousStatus: item.status, newStatus: item.status,
                comments: `${comment} (submitted, waiting for review / approval: not changed)` };
            if (item.kind === 'task') await recordTaskHistory(Object.assign({ taskId: item.id }, common));
            else await recordIssueHistory(Object.assign({ issueAssignmentId: item.id, taskId: item.task_id }, common));
        }
        await recordWorkRequestHistory({
            req, transaction, workRequestId, action: 'cancelled',
            previousStatus: data.project.status, newStatus: 'cancelled',
            previousData: { status: data.project.status },
            nextData: { status: 'cancelled', cancelled_on: today, reason },
            changes: {
                status: { before: data.project.status, after: 'cancelled' },
                cancelled_on: today, reason, summary: p.summary,
                items: p.items.filter(i => i.category !== 'closed' && i.category !== 'completed').map(i => ({
                    kind: i.kind, id: i.id, task_id: i.task_id, version: i.version, category: i.category,
                    status: { before: i.status, after: i.new_status },
                    start_date: { before: i.start_date, after: i.new_start_date },
                    end_date: { before: i.end_date, after: i.new_end_date }
                }))
            },
            comments: reason,
            relatedUserId: data.project.user_id,
            relatedManagerId: user.id
        });
        return { data, p };
    });

    // the admin dashboards show the new status at once (also when cancelled from the user app)
    await clearAdminCache().catch(() => {});
    const emailStatus = await notify(req, result.data, result.p, reason);
    console.log(`[cancel] work request ${workRequestId} cancelled by user ${user.id}: ${JSON.stringify(result.p.summary)}, email ${emailStatus}`);
    return {
        project: Object.assign(publicProject(result.data.project), { status: 'cancelled' }),
        cancel_date: today, reason, summary: result.p.summary,
        items: result.p.items, email_status: emailStatus
    };
};

// rows changed by a raw UPDATE ([results, metadata]; mysql2 puts affectedRows on either)
const affected = res => {
    for (const part of Array.isArray(res) ? res : [res]) {
        if (part && typeof part === 'object' && part.affectedRows !== undefined) return part.affectedRows;
        if (typeof part === 'number') return part;
    }
    return 0;
};

const LABEL = { in_progress: 'Started: cancelled, end date = cancellation date', not_started: 'Not started: cancelled', pending_approval: 'Submitted: waiting for review / approval', completed: 'Completed: unchanged', closed: 'Already closed' };

const notify = async (req, data, p, reason) => {
    try {
        const seen = new Set();
        const cc = [];
        for (const x of data.people) {
            if (!x.email || seen.has(x.email.toLowerCase())) continue;
            seen.add(x.email.toLowerCase()); cc.push(x.email);
        }
        const to = data.project.requester_email || cc.shift();
        if (!to) return 'no_recipient';
        const ccList = cc.filter(e => e.toLowerCase() !== String(to).toLowerCase());
        const html = renderTemplate('projectCancelled', {
            project_id: data.project.id,
            project_name: data.project.project_name,
            cancel_date: p.cancel_date,
            cancelled_by: req.user.name || 'D-Map',
            reason,
            tasks: p.summary.tasks,
            changes: p.summary.changes,
            has_pending: p.items.some(i => i.flagged),
            items: p.items.filter(i => i.category !== 'closed').map(i => ({
                label: i.kind === 'task' ? `Task #${i.id} ${i.name || ''}` : `${i.version || 'Change'} #${i.id} on ${i.name || 'task #' + i.task_id}`,
                result: LABEL[i.category]
            })),
            frontend_url: process.env.FRONTEND_URL
        });
        const queued = await sendMail({ to, cc: ccList.length ? ccList.join(', ') : undefined, subject: `Project cancelled: ${data.project.project_name} (#${data.project.id}) - D-Map`, html });
        return queued ? 'queued' : 'failed';
    } catch (err) {
        console.error('Project cancellation email:', err.message);
        return 'failed';
    }
};

// ---- read-only after cancellation -----------------------------------------------------------
const cancelledMessage = 'This project is cancelled and read-only';

const isCancelled = async (workRequestId) => {
    if (!workRequestId) return false;
    const [row] = await q('SELECT status FROM work_requests WHERE id = :id', { id: workRequestId });
    return !!row && row.status === 'cancelled';
};

const idOf = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const TARGETS = {
    workRequest: id => id,
    task: id => workRequestIdForTask(id),
    change: id => workRequestIdForIssue(id),
    taskDocument: async id => {
        const [row] = await q('SELECT t.work_request_id AS w FROM task_documents td JOIN task_assignments ta ON ta.id = td.task_assignment_id JOIN tasks t ON t.id = ta.task_id WHERE td.id = :id', { id });
        return row ? row.w : null;
    },
    changeDocument: async id => {
        const [row] = await q(`SELECT t.work_request_id AS w FROM issue_documents idc JOIN issue_user_assignments iua ON iua.id = idc.issue_user_assignment_id
            JOIN issue_assignments ia ON ia.id = iua.issue_assignment_id JOIN tasks t ON t.id = ia.task_id WHERE idc.id = :id`, { id });
        return row ? row.w : null;
    }
};

// Route guard: `pick(req)` returns [kind, id] (kind in TARGETS) or null to let the request through.
// The handler still does its own checks (404s etc.); this only refuses writes on cancelled projects.
const blockIfProjectCancelled = (pick) => async (req, res, next) => {
    try {
        const target = pick(req);
        if (!target) return next();
        const id = idOf(target[1]);
        if (!id) return next();
        const workRequestId = await TARGETS[target[0]](id);
        if (await isCancelled(workRequestId)) return res.status(400).json({ success: false, error: cancelledMessage });
        return next();
    } catch (err) {
        return next(err);
    }
};

module.exports = { preview, cancel, CancelError, classify, isCancelled, blockIfProjectCancelled, cancelledMessage };
