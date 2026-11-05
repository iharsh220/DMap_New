// End-to-end test of the admin "Master data" API (local dump copy only, see lib.js).
// Creates its own rows (prefixed "E2E MD"), checks the link rules, the manager scope and the
// delete guards, then removes everything it created. Existing rows are only read.
// Run: start the API on the local copy (CLAUDE.md "Local testing"), then
//   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD= DB_NAME=dmap REDIS_HOST=127.0.0.1 REDIS_PORT=16379 node scripts/e2e/master-data.e2e.js
const { sql, api, check, done } = require('./lib');

const ADMIN = 1, MANAGER = 24, ARTIST = 50;   // manager 24 is in department Digilabs (9)
const M = 'datatable/admin/master/';
const P = 'E2E MD ' + Date.now().toString(36) + ' ';

(async () => {
    const before = await sql(`SELECT (SELECT COUNT(*) FROM department) d, (SELECT COUNT(*) FROM division) v, (SELECT COUNT(*) FROM designation) g, (SELECT COUNT(*) FROM job_role) j,
        (SELECT COUNT(*) FROM request_type) r, (SELECT COUNT(*) FROM project_type) p, (SELECT COUNT(*) FROM task_type) t, (SELECT COUNT(*) FROM issue_register) c,
        (SELECT COUNT(*) FROM request_division_reference) rdr, (SELECT COUNT(*) FROM project_request_reference) prr, (SELECT COUNT(*) FROM task_project_reference) tpr,
        (SELECT COUNT(*) FROM change_issue_tasktype) cit, (SELECT COUNT(*) FROM designation_jobroles) dj, (SELECT COUNT(*) FROM designation_departments) dd`);
    const created = [];
    const mk = async (uid, entity, body) => {
        const r = await api(uid, 'POST', M + entity, body);
        if (r.status === 201) created.push([entity, r.body.data.row.id]);
        return r;
    };

    // ---------- admin builds a full chain
    let r = await mk(ADMIN, 'department', { department_name: P + 'Dept', description: 'test' });
    check('admin creates department', r.status === 201, r.status + ' ' + JSON.stringify(r.body.error || ''));
    const dept = r.body.data.row.id;
    r = await mk(ADMIN, 'division', { title: P + 'Div', department_id: dept });
    check('admin creates division in it', r.status === 201, r.status);
    const div = r.body.data.row.id;
    r = await api(ADMIN, 'GET', M + 'department/' + dept);
    check('department detail lists the new division', r.body.data.sections.some(s => s.entity === 'division' && s.rows.some(x => x.id === div)));
    r = await mk(ADMIN, 'request_type', { request_type: P + 'Req', links: { divisions: [] } });
    check('request type without division -> 400', r.status === 400, r.status + ' ' + r.body.error);
    r = await mk(ADMIN, 'request_type', { request_type: P + 'Req', links: { divisions: [div] } });
    check('request type with division -> 201', r.status === 201, r.status);
    const req = r.body.data.row.id;
    r = await mk(ADMIN, 'project_type', { project_type: P + 'Proj', links: { request_types: [req] } });
    check('project type linked to request type', r.status === 201, r.status);
    const proj = r.body.data.row.id;
    r = await mk(ADMIN, 'task_type', { task_type: P + 'Task', links: { project_types: [proj] } });
    check('task type linked to project type', r.status === 201, r.status);
    const task = r.body.data.row.id;
    r = await mk(ADMIN, 'change_type', { change_issue_type: P + 'Change', links: { task_types: [task] } });
    check('change type linked to task type', r.status === 201, r.status);
    const change = r.body.data.row.id;
    r = await api(ADMIN, 'GET', M + 'request_type/' + req);
    check('request type shows its project type (link written from the other side)', r.body.data.row.links.project_types.some(x => x.id === proj));
    r = await mk(ADMIN, 'job_role', { role_title: P + 'Role', department_id: dept });
    check('job role in department', r.status === 201, r.status);
    const role = r.body.data.row.id;
    r = await mk(ADMIN, 'designation', { designation_name: P + 'Desig', designation_category: 'Others' });
    check('designation without department/job role -> 400', r.status === 400, r.status + ' ' + r.body.error);
    r = await mk(ADMIN, 'designation', { designation_name: P + 'Desig', designation_category: 'Others', mapping: [{ department_id: dept, jobrole_id: 4 }] });
    check('job role of another department -> 400', r.status === 400, r.status + ' ' + r.body.error);
    r = await mk(ADMIN, 'designation', { designation_name: P + 'Desig', designation_category: 'Others', mapping: [{ department_id: dept, jobrole_id: role }, { department_id: 9, jobrole_id: 4 }] });
    check('designation with 2 department/job role pairs', r.status === 201, r.status + ' ' + (r.body.error || ''));
    const desig = r.body.data.row.id;
    let rows = await sql('SELECT department_id, jobrole_id FROM designation_jobroles WHERE designation_id = ? ORDER BY department_id', [desig]);
    let mirror = await sql('SELECT department_id FROM designation_departments WHERE designation_id = ? ORDER BY department_id', [desig]);
    check('designation_jobroles and designation_departments written together', rows.length === 2 && mirror.length === 2 && mirror.every((m, i) => m.department_id === rows[i].department_id), JSON.stringify(rows));

    // ---------- admin guards
    r = await mk(ADMIN, 'division', { title: (P + 'div').toUpperCase(), department_id: dept });
    check('duplicate name (case-insensitive) -> 409', r.status === 409, r.status);
    r = await api(ADMIN, 'DELETE', M + 'request_type/' + req);
    check('delete request type that is the only one of a project type -> 409', r.status === 409, r.body.error);
    r = await api(ADMIN, 'DELETE', M + 'department/' + dept);
    check('delete department still used -> 409', r.status === 409, r.body.error);
    r = await api(ADMIN, 'PUT', M + 'department/9', { department_name: 'Digilabs X' });
    check('rename protected department Digilabs -> 409', r.status === 409, r.body.error);
    r = await api(ADMIN, 'DELETE', M + 'task_type/1');
    const used = await sql('SELECT COUNT(*) n FROM tasks WHERE task_type_id = 1');
    check('delete a task type with tasks -> 409 (no cascade)', used[0].n === 0 || r.status === 409, r.status + ' ' + r.body.error);
    r = await api(ADMIN, 'PUT', M + 'division/' + div, { state: 'inactive' });
    check('admin sets division inactive', r.status === 200 && r.body.data.row.state === 'inactive', r.status);
    await api(ADMIN, 'PUT', M + 'division/' + div, { state: 'active' });

    // ---------- manager: view-only, Work setup only (owner, 2026-11-05)
    r = await api(MANAGER, 'GET', M + 'meta');
    const mKeys = r.body.data.entities.map(e => e.key);
    check('manager meta: Work setup tables only (no designation / job role)', !mKeys.includes('designation') && !mKeys.includes('job_role') && mKeys.includes('division') && mKeys.includes('change_type'), mKeys.join(','));
    check('manager meta: cannot create anything', r.body.data.entities.every(e => !e.canCreate));
    r = await api(MANAGER, 'GET', M + 'department');
    check('manager sees only own department', r.status === 200 && r.body.data.length === 1 && r.body.data[0].id === 9, JSON.stringify(r.body.data.map(x => x.id)));
    check('manager rows are read-only', r.body.data.every(x => !x.canEdit && !x.canDelete));
    r = await api(MANAGER, 'GET', M + 'department/9');
    check('manager department detail has no job role / designation sections and no add buttons', r.status === 200 && r.body.data.sections.every(s => !['job_role', 'designation'].includes(s.entity) && !s.add), r.body.data.sections.map(s => s.entity).join(','));
    r = await api(MANAGER, 'GET', M + 'designation');
    check('manager cannot list designations -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'GET', M + 'job_role/4');
    check('manager cannot open a job role -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'GET', M + 'department/' + dept);
    check('manager cannot open another department -> 404', r.status === 404, r.status);
    r = await api(MANAGER, 'GET', M + 'division?lite=1&all=1');
    check('manager lite list stays within own department even with all=1', r.status === 200 && r.body.data.length === 5, r.body.data && r.body.data.length);
    for (const [m, u, b] of [['POST', 'division', { title: P + 'Mgr div', department_id: 9 }], ['PUT', 'division/1', { description: 'x' }], ['DELETE', 'division/' + div], ['PUT', 'department/9', { description: 'x' }]]) {
        r = await api(MANAGER, m, M + u, b);
        check(`manager ${m} ${u.replace(/\d+$/, ':id')} -> 403`, r.status === 403, r.status + ' ' + r.body.error);
    }

    // ---------- change requests
    const R = M + 'requests';
    const reqCount0 = (await sql('SELECT COUNT(*) n FROM master_data_requests'))[0].n;
    r = await api(MANAGER, 'POST', R, { entity: 'designation', action: 'add', title: 'x', details: 'y' });
    check('request for a table the manager cannot see -> 400', r.status === 400, r.status);
    r = await api(MANAGER, 'POST', R, { entity: 'division', action: 'change', title: 'x' });
    check('request without details -> 400', r.status === 400, r.body.error);
    r = await api(MANAGER, 'POST', R, { entity: 'division', action: 'change', target_id: div, title: 'x', details: 'y' });
    check('request about another department\'s row -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'POST', R, { entity: 'task_type', action: 'add', title: '' , details: 'y' });
    check('request without title -> 400', r.status === 400, r.body.error);
    r = await api(MANAGER, 'POST', R, { entity: 'task_type', action: 'add', title: P + 'Add task type Reels', details: 'Video needs a "Reels editing" task type under Video & Animation.' });
    check('manager raises an add request', r.status === 201 && r.body.data.status === 'pending', r.status + ' ' + (r.body.error || ''));
    const req1 = r.body.data.id;
    check('request history: created + email step', r.body.data.history.length === 2 && r.body.data.history[0].action === 'created' && /^email_/.test(r.body.data.history[1].action), r.body.data.history.map(h => h.action).join(','));
    r = await api(MANAGER, 'POST', R, { entity: 'division', action: 'change', target_id: 1, title: P + 'Rename Graphic description', details: 'Please update the description.' });
    check('manager raises a change request for own division', r.status === 201 && r.body.data.target_label === 'Graphic', r.status + ' ' + (r.body.error || ''));
    const req2 = r.body.data.id;
    r = await api(MANAGER, 'POST', R, { entity: 'project_type', action: 'remove', title: P + 'Remove an old project type', details: 'Not used any more.' });
    check('remove request without a row is accepted (row is optional)', r.status === 201 && r.body.data.target_id === null, r.status + ' ' + (r.body.error || ''));
    const req3 = r.body.data.id;
    check('email history notes the manager in CC', /cc \S+@/.test(r.body.data.history[1].remark || ''), r.body.data.history[1].remark);
    r = await api(ARTIST, 'POST', R, { entity: 'division', action: 'add', title: 'x', details: 'y' });
    check('creative user cannot raise a request -> 403', r.status === 403, r.status);
    r = await api(ADMIN, 'POST', R, { entity: 'division', action: 'add', title: 'x', details: 'y' });
    check('Super Admin does not raise requests (edits directly) -> 403', r.status === 403, r.status);
    r = await api(31, 'GET', R + '/' + req1);
    check('another manager cannot read someone else\'s request -> 404', r.status === 404, r.status);
    r = await api(MANAGER, 'GET', R);
    check('manager lists own requests with summary', r.status === 200 && r.body.data.rows.some(x => x.id === req1) && r.body.data.summary.pending >= 3, JSON.stringify(r.body.data.summary));
    r = await api(MANAGER, 'PUT', R + '/' + req1, { status: 'done' });
    check('manager cannot update a request -> 403', r.status === 403, r.status);
    // admin alerts (popup) and handling
    const redisSeenReset = await api(ADMIN, 'POST', R + '/alerts/seen', { last_id: 0 });
    r = await api(ADMIN, 'GET', R + '/alerts');
    check('admin alerts list the new requests', r.status === 200 && r.body.data.unseen.some(x => x.id === req1) && r.body.data.unseen.some(x => x.id === req2) && r.body.data.open >= 2, JSON.stringify({ open: r.body.data.open, n: r.body.data.unseen.length }));
    r = await api(ADMIN, 'POST', R + '/alerts/seen', { last_id: req2 });
    r = await api(ADMIN, 'GET', R + '/alerts');
    check('after closing the popup the same requests are not shown again', r.body.data.unseen.every(x => x.id > req2), r.body.data.unseen.map(x => x.id).join(','));
    r = await api(MANAGER, 'GET', R + '/alerts');
    check('manager cannot read admin alerts -> 403', r.status === 403, r.status);
    r = await api(ADMIN, 'PUT', R + '/' + req1, { status: 'in_progress' });
    check('admin starts the request', r.status === 200 && r.body.data.status === 'in_progress', r.status);
    r = await api(ADMIN, 'PUT', R + '/' + req1, { remark: 'Creating it now.' });
    check('admin adds a comment', r.status === 200 && r.body.data.admin_remark === 'Creating it now.', r.status);
    r = await api(ADMIN, 'PUT', R + '/' + req1, { status: 'done', remark: 'Added "Reels editing".' });
    check('admin marks it done (resolved by/at set)', r.status === 200 && r.body.data.status === 'done' && r.body.data.resolved_by === ADMIN && !!r.body.data.resolved_at, r.status);
    r = await api(ADMIN, 'PUT', R + '/' + req1, { status: 'rejected' });
    check('a done request cannot change status again -> 409', r.status === 409, r.body.error);
    r = await api(ADMIN, 'PUT', R + '/' + req2, { status: 'pending' });
    check('setting the same status without a remark -> 400', r.status === 400, r.body.error);
    r = await api(ADMIN, 'PUT', R + '/' + req2, { status: 'rejected', remark: 'Description is fine as is.' });
    check('admin rejects the second request', r.status === 200 && r.body.data.status === 'rejected');
    r = await api(MANAGER, 'GET', R + '/' + req1);
    const acts = r.body.data.history.map(h => h.action + (h.to_status ? ':' + h.to_status : ''));
    check('manager sees the full history of the request', r.status === 200 && acts.join(',') === ['created:pending', acts[1], 'status_changed:in_progress', 'comment:in_progress', 'status_changed:done'].join(','), acts.join(','));
    const emailRows = await sql('SELECT email_status FROM master_data_requests WHERE id IN (?, ?)', [req1, req2]);
    check('email status recorded on each request', emailRows.every(x => ['queued', 'failed'].includes(x.email_status)), JSON.stringify(emailRows));
    await sql('DELETE FROM master_data_requests WHERE id IN (?, ?, ?)', [req1, req2, req3]);
    const reqCount1 = (await sql('SELECT COUNT(*) n FROM master_data_requests'))[0].n;
    check('test requests removed (history cascades)', reqCount1 === reqCount0 && (await sql('SELECT COUNT(*) n FROM master_data_request_history WHERE request_id IN (?, ?)', [req1, req2]))[0].n === 0);

    // ---------- other roles
    for (const [m, u, b] of [['GET', 'meta'], ['GET', 'department'], ['POST', 'division', { title: P + 'x', department_id: 9 }], ['PUT', 'department/9', { description: 'x' }], ['DELETE', 'division/' + div]]) {
        r = await api(ARTIST, m, M + u, b);
        check(`creative user ${m} ${u} -> 403`, r.status === 403, r.status);
    }

    // ---------- cleanup (children first) and compare counts
    for (const [entity, id] of [['change_type', change], ['task_type', task], ['project_type', proj], ['request_type', req], ['designation', desig], ['job_role', role], ['division', div], ['department', dept]]) {
        r = await api(ADMIN, 'DELETE', M + entity + '/' + id);
        check(`cleanup: delete ${entity}`, r.status === 200, r.status + ' ' + (r.body.error || ''));
    }
    const after = await sql(`SELECT (SELECT COUNT(*) FROM department) d, (SELECT COUNT(*) FROM division) v, (SELECT COUNT(*) FROM designation) g, (SELECT COUNT(*) FROM job_role) j,
        (SELECT COUNT(*) FROM request_type) r, (SELECT COUNT(*) FROM project_type) p, (SELECT COUNT(*) FROM task_type) t, (SELECT COUNT(*) FROM issue_register) c,
        (SELECT COUNT(*) FROM request_division_reference) rdr, (SELECT COUNT(*) FROM project_request_reference) prr, (SELECT COUNT(*) FROM task_project_reference) tpr,
        (SELECT COUNT(*) FROM change_issue_tasktype) cit, (SELECT COUNT(*) FROM designation_jobroles) dj, (SELECT COUNT(*) FROM designation_departments) dd`);
    check('all table and link counts back to the start', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(before) + ' vs ' + JSON.stringify(after));
    await done();
})().catch(async err => { console.error(err); process.exit(1); });
