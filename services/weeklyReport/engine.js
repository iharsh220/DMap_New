// Weekly report engine: the Node port of "Weekly Report App/engine.py", reading live D-Map data
// instead of the Projects / Tasks / Changes Excel exports.
//
// Two report units (settings.unit):
//   'project' - one row per work request (how the Web Application team reports), the same rules as
//               engine.py: a project belongs to the team when its request type is one of the team's
//               verticals or one of its tasks is assigned to someone in the team's division.
//   'task'    - one row per task (Graphic, Video, Content, Shoot): tasks of the team's request type
//               or assigned to someone in the division.
// Status comes from tasks and change requests, because a request is often left "accepted" after
// the work is done:
//   Completed - all (live) tasks done and no change request open; in the report when the last piece
//               of work finished inside the report week.
//   Ongoing   - work started, or a change request is open.
//   Upcoming  - nothing started yet.
//   Cancelled - cancelled in D-Map.
const { sequelize } = require('../../config/databaseConfig');

const ACTIVE_CHANGE = new Set(['m_pending', 'u_pending', 'm_accepted', 'u_accepted', 'in_progress', 'pending', 'accepted']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- date helpers (YYYY-MM-DD strings)
const toDate = (v) => {
    if (v === null || v === undefined) return null;
    const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m || m[1] === '0000') return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
};
const parseIso = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
const iso = dt => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = parseIso(d); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); };
const maxDate = list => list.filter(Boolean).sort().pop() || null;
const minDate = list => list.filter(Boolean).sort()[0] || null;

const fmtDate = d => (d ? `${d.slice(8, 10)}-${MONTHS[+d.slice(5, 7) - 1]}-${d.slice(0, 4)}` : 'TBD');

// Tuesday-to-Monday week ending on the most recent Monday (today if Monday)
const reportWeek = (today) => {
    const t = today || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST date
    const weekday = (parseIso(t).getUTCDay() + 6) % 7; // Monday = 0
    const end = addDays(t, -weekday);
    return [addDays(end, -6), end];
};

const initials = (name, overrides) => {
    const n = String(name || '').trim();
    if (overrides && overrides[n]) return overrides[n];
    const parts = n.split(/\s+/).filter(p => p && /[A-Za-z]/.test(p[0]));
    if (!parts.length) return '';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const s = v => (v === null || v === undefined ? '' : String(v).trim());
const splitNames = v => s(v).split(',').map(x => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- loading
// Request types that belong to this division alone (e.g. "Web & Digital Solutions" -> Web
// Application). Types shared by every division ("Consulting & Advisory") are left out; their work
// still shows up through the team's task assignments.
const defaultRequestedVerticals = async (divisionId) => {
    const rows = await sequelize.query(`
        SELECT rt.request_type AS name
        FROM request_type rt
        JOIN request_division_reference r ON r.request_id = rt.id
        WHERE r.division_id = :divisionId
          AND (SELECT COUNT(DISTINCT r2.division_id) FROM request_division_reference r2 WHERE r2.request_id = rt.id) = 1
        ORDER BY rt.request_type`, { replacements: { divisionId }, type: sequelize.QueryTypes.SELECT });
    return rows.map(r => r.name);
};

const requestedVerticalsOf = settings => {
    const v = settings.requested_verticals !== undefined ? settings.requested_verticals : settings.requested_vertical;
    return (Array.isArray(v) ? v : [v]).map(s).filter(Boolean);
};

async function loadData(divisionId, settings) {
    const select = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const verticals = requestedVerticalsOf(settings);
    const replacements = { divisionId, verticals: verticals.length ? verticals : ['\u0000'] };
    const inTeam = alias => `EXISTS (SELECT 1 FROM task_assignments x_ta JOIN user_divisions x_ud ON x_ud.user_id = x_ta.user_id
        WHERE x_ta.task_id = ${alias}.id AND x_ud.division_id = :divisionId)`;

    // which work requests the team's report looks at
    const wrIds = settings.unit === 'task'
        ? (await select(`SELECT DISTINCT t.work_request_id AS id FROM tasks t
                JOIN work_requests wr ON wr.id = t.work_request_id AND wr.is_deleted = 0
                LEFT JOIN request_type trt ON trt.id = t.request_type_id
                WHERE t.is_deleted = 0 AND (trt.request_type IN (:verticals) OR ${inTeam('t')})`, replacements)).map(r => r.id)
        : (await select(`SELECT wr.id FROM work_requests wr
                LEFT JOIN request_type rt ON rt.id = wr.request_type_id
                WHERE wr.is_deleted = 0 AND (rt.request_type IN (:verticals)
                    OR EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id = wr.id AND t.is_deleted = 0 AND ${inTeam('t')}))`, replacements)).map(r => r.id);
    if (!wrIds.length) return { projects: [], tasks: [], changes: [] };
    const ids = { ...replacements, wrIds };

    const [projects, tasks, changes] = await Promise.all([
        select(`SELECT wr.id, wr.status, wr.project_name, wr.requested_at, rt.request_type, pt.project_type, ru.name AS client,
                (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ') FROM user_divisions ud
                    JOIN division d ON d.id = ud.division_id WHERE ud.user_id = wr.user_id) AS client_division,
                (SELECT MAX(h.created_at) FROM work_request_history h WHERE h.work_request_id = wr.id
                    AND h.action IN ('completed', 'auto_completed')) AS completed_at
            FROM work_requests wr
            LEFT JOIN request_type rt ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt ON pt.id = wr.project_id
            LEFT JOIN users ru ON ru.id = wr.user_id
            WHERE wr.id IN (:wrIds)`, ids),
        select(`SELECT t.id, t.work_request_id, t.task_name, t.status, t.start_date, t.end_date, t.deadline,
                t.shared_with_client_at, t.task_count, trt.request_type, tt.task_type,
                (SELECT MIN(h.created_at) FROM task_history h WHERE h.task_id = t.id AND h.action = 'created') AS requested_at,
                (SELECT GROUP_CONCAT(DISTINCT au.name ORDER BY au.name SEPARATOR ', ') FROM task_assignments ta
                    JOIN users au ON au.id = ta.user_id WHERE ta.task_id = t.id) AS assignees,
                ${inTeam('t')} AS in_team
            FROM tasks t
            LEFT JOIN task_type tt ON tt.id = t.task_type_id
            LEFT JOIN request_type trt ON trt.id = t.request_type_id
            WHERE t.is_deleted = 0 AND t.work_request_id IN (:wrIds)
            ORDER BY t.id`, ids),
        select(`SELECT ia.id, ia.task_id, t.work_request_id, ia.status, ia.version, ia.start_date, ia.end_date,
                (SELECT MIN(h.created_at) FROM issue_history h WHERE h.issue_assignment_id = ia.id
                    AND h.action IN ('created', 'child_change_request_created') AND h.actor_type IN ('manager', 'user')) AS requested_at
            FROM issue_assignments ia
            JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
            WHERE ia.is_deleted = 0 AND t.work_request_id IN (:wrIds)
            ORDER BY ia.id`, ids)
    ]);
    return { projects, tasks, changes };
}

// ---------------------------------------------------------------- model
async function buildModel(divisionId, settings, ws, we) {
    const { projects, tasks, changes } = await loadData(divisionId, settings);
    const ctx = {
        ws, we,
        activeDays: parseInt(settings.active_days, 10) || 30,
        initClients: new Set((settings.initiative_clients || []).map(c => s(c).toLowerCase())),
        over: settings.initials_overrides || {},
        verticals: new Set(requestedVerticalsOf(settings))
    };
    const tasksBy = new Map(), changesBy = new Map(), changesByTask = new Map();
    tasks.forEach(t => { if (!tasksBy.has(t.work_request_id)) tasksBy.set(t.work_request_id, []); tasksBy.get(t.work_request_id).push(t); });
    changes.forEach(c => {
        if (!changesBy.has(c.work_request_id)) changesBy.set(c.work_request_id, []);
        changesBy.get(c.work_request_id).push(c);
        if (!changesByTask.has(c.task_id)) changesByTask.set(c.task_id, []);
        changesByTask.get(c.task_id).push(c);
    });

    const model = {};
    for (const p of projects) {
        const pTasks = tasksBy.get(p.id) || [];
        const pChanges = changesBy.get(p.id) || [];
        if (settings.unit === 'task') {
            for (const t of pTasks) {
                if (!(ctx.verticals.has(s(t.request_type)) || Number(t.in_team))) continue;
                const row = deriveTask(p, t, changesByTask.get(t.id) || [], ctx);
                model[row.id] = row;
            }
        } else {
            const row = deriveProject(p, pTasks, pChanges, ctx);
            model[row.id] = row;
        }
    }
    return model;
}

// Shared tail of both derive functions: inclusion rule, hints, suggested remark, contributors
function finish(base, { status, lastEnd, plannedEnd, deadlines, activity, live, activeChanges, ctx }) {
    const { ws, we, activeDays, over } = ctx;
    const end = status === 'Completed' ? lastEnd : plannedEnd;
    const lastActivity = maxDate(activity);
    const futureDeadline = deadlines.some(d => d >= ws);

    let autoInclude;
    if (status === 'Completed') autoInclude = !!(lastEnd && ws <= lastEnd && lastEnd <= we);
    else if (status === 'Cancelled') autoInclude = false;
    else autoInclude = !!((lastActivity && lastActivity >= addDays(we, -activeDays)) || futureDeadline);

    const hint = base.hint;
    if ((status === 'Ongoing' || status === 'Upcoming') && end && end < we) hint.push('Deadline passed ' + fmtDate(end));

    const sharedClient = live.some(t => t.shared_with_client_at);
    let suggestion = '';
    if (status === 'Completed') suggestion = sharedClient ? 'Shared with client.' : 'Completed.';
    else if (status === 'Ongoing') suggestion = activeChanges.length ? 'Changes in progress.' : 'Under development.';
    else if (status === 'Upcoming') suggestion = live.length ? 'Scheduled.' : 'Awaiting brief.';

    const people = [];
    live.forEach(t => splitNames(t.assignees).forEach(n => { if (!people.includes(n)) people.push(n); }));

    return {
        ...base,
        status,
        start: base.start ? fmtDate(base.start) : 'TBD',
        end: end ? fmtDate(end) : 'TBD',
        end_iso: end || '',
        completed_in_week: status === 'Completed' && !!(lastEnd && ws <= lastEnd && lastEnd <= we),
        auto_include: autoInclude,
        last_activity: lastActivity || '',
        hint: hint.join('; '),
        suggested_remark: suggestion,
        contributors: people.map(n => initials(n, over)).join('/'),
        people,
        initiative_client: ctx.initClients.has(s(base.client).toLowerCase())
    };
}

const changeVersions = list => [...new Set(list.map(c => s(c.version)).filter(Boolean))].sort();

function deriveProject(p, tasks, changes, ctx) {
    const pstatus = s(p.status).toLowerCase();
    const live = tasks.filter(t => s(t.status).toLowerCase() !== 'cancelled');
    const st = live.map(t => s(t.status).toLowerCase());
    const activeChanges = changes.filter(c => ACTIVE_CHANGE.has(s(c.status).toLowerCase()));

    let lastEnd = maxDate([...live.map(t => toDate(t.end_date)), ...changes.filter(c => s(c.status).toLowerCase() === 'completed').map(c => toDate(c.end_date))]);
    const hint = [];
    let status;
    if (pstatus === 'cancelled') status = 'Cancelled';
    else if (live.length && st.every(x => x === 'completed') && !activeChanges.length) status = 'Completed';
    else if (!live.length && pstatus === 'completed') { status = 'Completed'; lastEnd = lastEnd || toDate(p.completed_at); }
    else if (activeChanges.length) {
        status = 'Ongoing';
        const vers = changeVersions(activeChanges);
        hint.push('Changes open' + (vers.length ? ` (${vers.join(', ')})` : ''));
    } else if (st.some(x => x === 'in_progress' || x === 'completed') ||
        live.some((t, i) => st[i] === 'accepted' && (toDate(t.start_date) || '9999-12-31') <= ctx.we)) status = 'Ongoing';
    else status = 'Upcoming';

    // Project Start / End Date as the admin Projects export computes them (all non-deleted tasks)
    const projectStart = minDate(tasks.map(t => toDate(t.start_date)));
    const projectEnd = maxDate([...tasks.map(t => toDate(t.end_date)), ...changes.map(c => toDate(c.end_date))]);
    const start = projectStart || minDate(live.map(t => toDate(t.start_date)));
    const deadlines = live.map(t => toDate(t.deadline)).filter(Boolean);
    let plannedEnd = projectEnd;
    if (deadlines.length && (!plannedEnd || maxDate(deadlines) > plannedEnd)) plannedEnd = maxDate(deadlines);

    const activity = [toDate(p.requested_at)];
    tasks.forEach(t => activity.push(toDate(t.requested_at), toDate(t.start_date), toDate(t.end_date)));
    changes.forEach(c => activity.push(toDate(c.requested_at), toDate(c.start_date), toDate(c.end_date)));

    const row = finish({
        id: String(p.id),
        kind: 'project',
        name: s(p.project_name),
        project: s(p.project_name),
        division: s(p.client_division),
        type: s(p.project_type),
        client: s(p.client),
        dmap_status: pstatus,
        start,
        hint,
        tasks_done: st.filter(x => x === 'completed').length,
        tasks_total: live.length,
        count_auto: '1',
        request_date: fmtDate(toDate(p.requested_at))
    }, { status, lastEnd, plannedEnd, deadlines, activity, live, activeChanges, ctx });
    return row;
}

function deriveTask(p, t, changes, ctx) {
    const tstatus = s(t.status).toLowerCase();
    const activeChanges = changes.filter(c => ACTIVE_CHANGE.has(s(c.status).toLowerCase()));
    const doneChanges = changes.filter(c => s(c.status).toLowerCase() === 'completed');
    const lastEnd = maxDate([toDate(t.end_date), ...doneChanges.map(c => toDate(c.end_date))]);
    const start = toDate(t.start_date);

    const hint = [];
    let status;
    if (tstatus === 'cancelled' || tstatus === 'rejected' || s(p.status).toLowerCase() === 'cancelled') status = 'Cancelled';
    else if (tstatus === 'completed' && !activeChanges.length) status = 'Completed';
    else if (activeChanges.length) {
        status = 'Ongoing';
        const vers = changeVersions(activeChanges);
        hint.push('Changes open' + (vers.length ? ` (${vers.join(', ')})` : ''));
    } else if (tstatus === 'in_progress' || (tstatus === 'accepted' && (start || '9999-12-31') <= ctx.we)) status = 'Ongoing';
    else status = 'Upcoming';

    const deadline = toDate(t.deadline);
    const activity = [toDate(t.requested_at), start, toDate(t.end_date)];
    changes.forEach(c => activity.push(toDate(c.requested_at), toDate(c.start_date), toDate(c.end_date)));
    const pages = parseInt(t.task_count, 10);

    return finish({
        id: 'T' + t.id,
        kind: 'task',
        task_id: t.id,
        project_id: String(p.id),
        name: s(t.task_name),
        project: s(p.project_name),
        division: s(p.client_division),
        type: s(t.task_type),
        client: s(p.client),
        dmap_status: tstatus,
        start,
        hint,
        tasks_done: doneChanges.length,
        tasks_total: changes.length,
        count_auto: pages > 0 ? String(pages) : '1',
        request_date: fmtDate(toDate(p.requested_at))
    }, { status, lastEnd, plannedEnd: deadline, deadlines: deadline ? [deadline] : [], activity, live: [t], activeChanges, ctx });
}

module.exports = {
    reportWeek,
    fmtDate,
    addDays,
    initials,
    defaultRequestedVerticals,
    requestedVerticalsOf,
    buildModel
};
