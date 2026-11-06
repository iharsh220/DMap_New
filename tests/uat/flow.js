// Workflow steps and read-back helpers shared by the UAT scenarios.
const { api, form, today, plus, rows, ok, check, must, timeline, log } = require('./lib');

const MA = 'manager/assigned-work-requests';

// ids on UAT (read from master data on 2026-11-06; override in .env.e2e.local if they change)
const TYPES = {
    A: { request_type_id: 4, project_type_id: 27 },   // Web & Digital Solutions / Static Website -> Web Application (CM A)
    B: { request_type_id: 1, project_type_id: 1 }     // Design & Graphics / Pharma/Medical Artwork -> Graphic (CM B)
};

const stamp = () => new Date(Date.now() + 330 * 60000).toISOString().slice(5, 16).replace('T', ' ');

// ---- steps -----------------------------------------------------------------------------------
const createProject = async (label, vertical = 'A', extra = {}) => {
    const name = `E2E UAT ${label} ${stamp()} - please ignore`;
    const t = TYPES[vertical];
    const r = await api('PMT', 'POST', 'work-requests', form(Object.assign({
        project_name: name, brand: 'E2E', request_type_id: t.request_type_id, project_id: t.project_type_id,
        description: 'Automatic UAT end-to-end test. Please ignore.', priority: 'medium',
        about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] }
    }, extra), { documents: 'brief.txt' }));
    must(`PMT creates project "${label}" (${vertical === 'A' ? 'Web & Digital Solutions' : 'Design & Graphics'})`, r, b => 'id ' + (b.data && b.data.workRequest && b.data.workRequest.id));
    const id = r.body.data.workRequest.id;
    log.created.push(`project #${id}`);
    return { id, name };
};

let taskTypeCache = {};
const taskTypeFor = async (role, projectTypeId) => {
    if (taskTypeCache[projectTypeId]) return taskTypeCache[projectTypeId];
    const r = await api(role, 'GET', `${MA}/id/task-types?project_id=${projectTypeId}`);
    const list = rows(r.body);
    if (!list.length) throw new Error(`No task types for project type ${projectTypeId}: ${r.status}`);
    taskTypeCache[projectTypeId] = list[0].id;
    return list[0].id;
};

const createTask = async (role, projectId, name, assigneeId, vertical = 'A', extra = {}) => {
    const t = TYPES[vertical];
    const body = Object.assign({
        work_request_id: projectId, task_name: name, description: 'UAT e2e task', request_type_id: t.request_type_id,
        task_type_id: await taskTypeFor(role, t.project_type_id), assigned_to_ids: [assigneeId], deadline: plus(7), task_count: 2
    }, extra);
    return api(role, 'POST', `${MA}/tasks`, body);
};

const changeTypeFor = async (taskId) => {
    const r = await api('PMT', 'GET', `issue-register/task/${taskId}`);
    const list = (r.body && r.body.data && r.body.data.issue_registers) || [];
    return list.length ? list[0].id : null;
};

const submitTask = (role, projectId, taskId, pages = 2) =>
    api(role, 'POST', 'users/tasks/submit', form({ task_id: taskId, work_request_id: projectId, task_count: pages, link: 'https://example.com/e2e' }, { documents: `task-${taskId}.txt` }));

const submitChange = (role, changeId, pages = 1) =>
    api(role, 'PUT', `users/issues/${changeId}/submit`, form({ task_count: pages, link: 'https://example.com/e2e', description: 'UAT e2e change done' }, { documents: `change-${changeId}.txt` }));

// ---- read back -------------------------------------------------------------------------------
// project + tasks + changes with status / dates (admin "linked work" API, any logged-in user)
const state = async (projectId, role = 'PMT') => {
    // a unique query string skips the 60 s admin cache (the cache key includes the query)
    const r = await api(role, 'GET', `datatable/admin/linked/project/${projectId}?fresh=${Date.now()}`);
    if (!ok(r)) return { error: r.status, tasks: [], project: {} };
    const d = r.body.data;
    const task = id => d.tasks.find(t => Number(t.id) === Number(id)) || null;
    const change = id => { for (const t of d.tasks) { const c = (t.changes || []).find(x => Number(x.id) === Number(id)); if (c) return c; } return null; };
    return Object.assign(d, { task, change });
};

const projectRow = async (projectId, role = 'PMT') => {
    const r = await api(role, 'GET', `work-requests/${projectId}`);
    const d = r.body && r.body.data;
    return { status: r.status, data: (d && (d.workRequest || d)) || null };
};

const historyOf = async (kind, id, role) => {
    const url = kind === 'project' ? `work-requests/history/${id}` : kind === 'task' ? `users/tasks/${id}/history` : `users/issues/${id}/history`;
    const r = await api(role, 'GET', url);
    return { status: r.status, rows: rows(r.body) };
};

// one merged, time-ordered timeline of a project, its tasks and changes
const buildTimeline = async (title, projectId, taskIds, changeIds, role = 'CM_A') => {
    const all = [];
    const add = (record, list) => list.forEach(h => all.push({
        at: h.created_at, when: String(h.created_at || '').replace('T', ' ').slice(0, 19), record, action: h.action,
        status: h.previous_status || h.new_status ? `${h.previous_status || '-'} → ${h.new_status || '-'}` : '',
        review: h.previous_review_stage || h.new_review_stage ? `${h.previous_review_stage || '-'} → ${h.new_review_stage || '-'}` : '',
        by: [h.actor_name, h.actor_type].filter(Boolean).join(' / '), raw: h
    }));
    add(`Project #${projectId}`, (await historyOf('project', projectId, 'PMT')).rows);
    for (const t of taskIds) add(`Task #${t}`, (await historyOf('task', t, role)).rows);
    for (const c of changeIds) add(`Change #${c}`, (await historyOf('change', c, role)).rows);
    all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    timeline(title, all);
    return all;
};

// does the timeline of `record` have a row matching fn?
const has = (tl, record, fn) => tl.some(e => e.record === record && fn(e.raw));
const to = (field, value) => h => String(h[field] || '') === value;

module.exports = { MA, TYPES, createProject, taskTypeFor, createTask, changeTypeFor, submitTask, submitChange, state, projectRow, historyOf, buildTimeline, has, to, today, plus };
