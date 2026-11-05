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

    // ---------- manager scope (Digilabs)
    r = await api(MANAGER, 'GET', M + 'department');
    check('manager sees only own department', r.status === 200 && r.body.data.length === 1 && r.body.data[0].id === 9, JSON.stringify(r.body.data.map(x => x.id)));
    r = await api(MANAGER, 'GET', M + 'department/' + dept);
    check('manager cannot open another department -> 404', r.status === 404, r.status);
    r = await api(MANAGER, 'GET', M + 'request_type/' + req);
    check('manager cannot open a request type of another department -> 404', r.status === 404, r.status);
    r = await api(MANAGER, 'GET', M + 'designation/' + desig);
    check('manager sees only the Digilabs pair of a shared designation', r.status === 200 && r.body.data.row.mapping.length === 1 && r.body.data.row.mapping[0].department_id === 9 && r.body.data.row.mappingHidden === 1, JSON.stringify(r.body.data && r.body.data.row.mapping));
    r = await mk(MANAGER, 'department', { department_name: P + 'Mgr dept' });
    check('manager cannot create a department -> 403', r.status === 403, r.status);
    r = await mk(MANAGER, 'division', { title: P + 'Mgr div', department_id: dept });
    check('manager cannot create a division in another department -> 403', r.status === 403, r.status);
    r = await mk(MANAGER, 'division', { title: P + 'Mgr div', department_id: 9 });
    check('manager creates a division in own department', r.status === 201, r.status + ' ' + (r.body.error || ''));
    const mdiv = r.body.data.row.id;
    r = await mk(MANAGER, 'request_type', { request_type: P + 'Mgr req', links: { divisions: [div] } });
    check('manager cannot link a request type to another department\'s division -> 403', r.status === 403, r.status);
    r = await mk(MANAGER, 'request_type', { request_type: P + 'Mgr req', links: { divisions: [mdiv], project_types: [proj] } });
    check('manager creates request type for own division, reusing an existing project type', r.status === 201, r.status + ' ' + (r.body.error || ''));
    const mreq = r.body.data.row.id;
    r = await api(MANAGER, 'PUT', M + 'designation/' + desig, { mapping: [{ department_id: 9, jobrole_id: 3 }] });
    check('manager edits own pair of a shared designation', r.status === 200, r.status + ' ' + (r.body.error || ''));
    rows = await sql('SELECT department_id, jobrole_id FROM designation_jobroles WHERE designation_id = ? ORDER BY department_id', [desig]);
    check('other department\'s pair kept, own pair replaced', rows.length === 2 && rows.some(x => x.department_id === dept && x.jobrole_id === role) && rows.some(x => x.department_id === 9 && x.jobrole_id === 3), JSON.stringify(rows));
    r = await api(MANAGER, 'PUT', M + 'designation/' + desig, { mapping: [{ department_id: dept, jobrole_id: role }] });
    check('manager cannot map another department -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'DELETE', M + 'designation/' + desig);
    check('manager cannot delete a designation other departments use -> 409', r.status === 409, r.body.error);
    r = await api(MANAGER, 'PUT', M + 'job_role/1', { description: 'x' });
    check('manager cannot edit Super Admin role -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'PUT', M + 'division/' + mdiv, { department_id: dept });
    check('manager cannot move own division to another department -> 403', r.status === 403, r.status);
    r = await api(MANAGER, 'PUT', M + 'request_type/' + mreq, { description: 'updated by manager' });
    check('manager updates own request type', r.status === 200 && r.body.data.row.description === 'updated by manager', r.status);
    r = await api(MANAGER, 'DELETE', M + 'division/' + mdiv);
    check('manager cannot delete own division while it is a request type\'s only division -> 409', r.status === 409, r.body.error);
    r = await api(MANAGER, 'DELETE', M + 'request_type/' + mreq);
    check('manager deletes own unused request type', r.status === 200, r.status + ' ' + (r.body.error || ''));
    const prrLeft = await sql('SELECT COUNT(*) n FROM project_request_reference WHERE request_id = ?', [mreq]);
    check('its links were removed', prrLeft[0].n === 0);
    r = await api(MANAGER, 'DELETE', M + 'division/' + mdiv);
    check('manager deletes own unused division', r.status === 200, r.status + ' ' + (r.body.error || ''));

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
