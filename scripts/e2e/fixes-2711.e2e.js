// Fixes of the live production test (2026-11-27, test/backend.md B-01..B-22) on the local dump copy.
// Run: node scripts/e2e/fixes-2711.e2e.js   (API on the local dump copy, see lib.js). It creates one
// 'E2E Fix <time>' project (ids printed at the end) and restores the user rows it touches.
const path = require('path');
const { sql, api, check, done, form, today, plus, repo } = require('./lib');
const PMT = 63, CMA = 24, ARTA = 50, CMB = 31, ARTB = 30, OTHER_ART = 26;
const MA = 'manager/assigned-work-requests';
const ok = (r) => r.status >= 200 && r.status < 300;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || 18080}/digilabs/dmap/api/`;
const hist = async (table, col, id, action) => sql(`select * from ${table} where ${col}=? and action=? order by id`, [id, action]);

(async () => {
    const name = 'E2E Fix ' + Date.now();
    // ---------- project + B-02 (created history status) + B-03 (manager reads /work-requests/:id)
    let r = await api(PMT, 'POST', 'work-requests', form({ project_name: name, brand: 'E2E', request_type_id: 1, project_id: 1, description: 'E2E fixes test project for the live test fixes', about_project: { output_devices: ['Print'], target_audience: ['Doctors'] }, priority: 'medium' }));
    check('PMT creates project', ok(r), r.status);
    const [wr] = await sql('select * from work_requests where project_name=?', [name]);
    const [created] = await hist('work_request_history', 'work_request_id', wr.id, 'created');
    check('B-02 created history has new_status pending', created && created.new_status === 'pending', JSON.stringify({ ps: created?.previous_status, ns: created?.new_status }));
    r = await api(CMA, 'PUT', `${MA}/${wr.id}/accept`, {});
    check('CM A accepts', ok(r), r.status);
    r = await api(CMA, 'GET', `work-requests/${wr.id}`);
    check('B-03 GET /work-requests/:id as the request manager -> 200 with data', r.status === 200 && (r.body.data?.id === wr.id || r.body.data?.[0]?.id === wr.id || JSON.stringify(r.body).includes(`"id":${wr.id}`)), r.status);
    r = await api(PMT, 'GET', `work-requests/${wr.id}`);
    check('B-03 creator still 200', r.status === 200, r.status);
    r = await api(OTHER_ART, 'GET', `work-requests/${wr.id}`);
    check('B-03 outsider still 403', r.status === 403, r.status);

    // ---------- B-15 past deadline
    const taskBody = (n, ids, extra = {}) => ({ work_request_id: wr.id, task_name: n, description: 'e2e', request_type_id: 1, task_type_id: 1, assigned_to_ids: ids, deadline: plus(10), ...extra });
    r = await api(CMA, 'POST', `${MA}/tasks`, taskBody('E2E past', [ARTA], { deadline: plus(-3) }));
    check('B-15 create task with a past deadline -> 400', r.status === 400, `${r.status} ${r.body.error}`);
    r = await api(CMA, 'POST', `${MA}/tasks`, taskBody('E2E today', [ARTA], { deadline: today() }));
    check('B-15 deadline today still allowed', ok(r), r.status);
    const TODAYTASK = r.body.data?.id;
    r = await api(CMA, 'POST', `${MA}/tasks`, taskBody('E2E T1', [ARTA]));
    const T1 = r.body.data?.id;
    r = await api(CMA, 'POST', `${MA}/tasks`, taskBody('E2E T2 delegated', [CMB], { request_type_id: 2 }));
    check('CM A delegates T2 to CM B', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    const T2 = r.body.data?.id;

    // ---------- B-16 activeTasks counts live tasks only
    r = await api(CMA, 'GET', `${MA}/${wr.id}/assignable-users`);
    const a50 = (r.body.data || []).find(u => u.id === ARTA);
    const [live] = await sql(`select count(distinct t.id) n from task_assignments ta join tasks t on t.id=ta.task_id join work_requests w on w.id=t.work_request_id
        where ta.user_id=? and t.status in ('pending','accepted','in_progress') and t.is_deleted=0 and w.is_deleted=0`, [ARTA]);
    check('B-16 activeTasks = live tasks of live projects', a50 && a50.activeTasks === live.n, `api ${a50?.activeTasks} sql ${live.n}`);

    // ---------- B-11 delegated manager sees the project and its task list; B-20 limit=-1
    r = await api(CMB, 'GET', `${MA}?page=1&limit=-1&status=accepted,in_progress,assigned`);
    check('B-20 manager list limit=-1 -> 200', r.status === 200, r.status);
    check('B-11 delegated manager sees the project in his list', (r.body.data || []).some(w => w.id === wr.id), (r.body.data || []).length);
    r = await api(CMB, 'GET', `${MA}/work-request/${wr.id}/tasks`);
    check('B-11 delegated manager gets the project task list', r.status === 200, r.status);
    const t1row = (r.body.data || []).find(t => t.id === T1);
    check('task list adds status / task_count / dates (old keys kept)', t1row && 'status' in t1row && 'task_count' in t1row && 'start_date' in t1row && 'task_name' in t1row && 'deadline' in t1row, Object.keys(t1row || {}).join(','));
    r = await api(OTHER_ART, 'GET', `${MA}/work-request/${wr.id}/tasks`);
    check('artist still refused on the task list', [403, 404].includes(r.status), r.status);
    r = await api(21, 'GET', `${MA}/work-request/${wr.id}/tasks`);
    check('uninvolved manager still 404 on the task list', r.status === 404, r.status);

    // CM B assigns to his artist; B-12 CM A's team view still lists T2
    r = await api(CMB, 'POST', 'users/assign-task', { task_id: T2, user_id: ARTB, work_request_id: wr.id, deadline: plus(12) });
    check('CM B assigns T2 to artist B', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    r = await api(CMA, 'GET', `users/tasks?page=1&limit=-1&search=${encodeURIComponent(name)}&searchFields=task_name`);
    r = await api(CMA, 'GET', 'users/tasks?page=1&limit=-1');
    check('B-12 CM A team view lists the delegated T2', r.status === 200 && (r.body.data || []).some(t => t.id === T2), r.status);

    // ---------- B-04 project in progress when the first task starts (+ accept without start_date)
    r = await api(ARTA, 'PUT', `users/tasks/${T1}/accept`, { start_date: today() });
    check('artist A accepts T1 today', ok(r) && r.body.data?.status === 'in_progress', JSON.stringify(r.body).slice(0, 100));
    let [w] = await sql('select status from work_requests where id=?', [wr.id]);
    check('B-04 project accepted -> in_progress at once', w.status === 'in_progress', w.status);
    const ws = await hist('work_request_history', 'work_request_id', wr.id, 'work_started');
    check('B-04 work_started history row (accepted -> in_progress)', ws.length === 1 && ws[0].previous_status === 'accepted' && ws[0].new_status === 'in_progress', ws.length);
    await sql("update tasks set deadline=? where id=?", [plus(-2), TODAYTASK]); // deadline passed before acceptance
    r = await api(ARTA, 'PUT', `users/tasks/${TODAYTASK}/accept`, {});
    const [tt] = await sql('select status,start_date from tasks where id=?', [TODAYTASK]);
    check('accept without start_date and a past deadline -> start_date today (was NULL)', ok(r) && tt.start_date === today(), JSON.stringify(tt));

    // ---------- submit, B-05 rework history, approve, share
    const submit = async (u, t) => api(u, 'POST', 'users/tasks/submit', form({ task_id: t, task_count: 2, work_request_id: wr.id, link: 'https://example.com' }, { documents: `t${t}.txt` }));
    r = await submit(ARTA, T1); check('artist submits T1', ok(r), r.status);
    r = await api(CMA, 'PUT', `${MA}/review`, { task_id: T1, action: 'change_request', comments: 'rework' });
    check('CM A rework', ok(r), r.status);
    const [rw] = (await hist('task_history', 'task_id', T1, 'manager_change_requested')).slice(-1);
    const ch = typeof rw.changes === 'string' ? JSON.parse(rw.changes) : rw.changes;
    check('B-05 rework history: changes.review.after == new_review', ch && ch.review && ch.review.after === rw.new_review && ch.manager_action === 'change_request', JSON.stringify(ch));
    r = await submit(ARTA, T1); r = await api(CMA, 'PUT', `${MA}/review`, { task_id: T1, action: 'approved' });
    r = await api(CMA, 'POST', `${MA}/share-for-client-review`, { work_request_id: wr.id, task_ids: [T1] });
    check('CM A shares T1', ok(r), r.status);

    // ---------- B-07 change created history, B-09 PMT attachment stays with the PMT
    const [reg] = await sql('select id from issue_register limit 1');
    r = await api(PMT, 'POST', 'issue-register/assignment', form({ task_id: T1, requested_by_user_id: PMT, assignment_type: 'mod', version: 'V2', description: 'e2e change', intimate_client: 1, issue_register_ids: `[${reg.id}]`, deadline: plus(15) }, { files: 'pmt-ref.txt' }));
    check('PMT raises V2 with a file', r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    const V2 = r.body.data?.id;
    const [tc] = (await hist('task_history', 'task_id', T1, 'change_request_created')).slice(-1);
    check('B-07 change_request_created logs the real stage (pm_review -> pm_review)', tc && tc.previous_review_stage === 'pm_review' && tc.new_review_stage === 'pm_review' && tc.previous_review === 'pending', JSON.stringify({ pr: tc?.previous_review, ps: tc?.previous_review_stage, ns: tc?.new_review_stage }));
    const [ic] = await hist('issue_history', 'issue_assignment_id', V2, 'created');
    check('B-07 change created history has task_id', ic && ic.task_id === T1, ic?.task_id);
    r = await api(CMA, 'PUT', `${MA}/issue/${V2}/accept`, {}); check('CM A accepts V2', ok(r), r.status);
    r = await api(CMA, 'POST', `${MA}/assign-issue-to-user`, { issue_assignment_id: V2, user_id: ARTA, deadline: plus(15) });
    check('CM A assigns V2 to artist A', ok(r), r.status);
    let rows = await sql('select id,user_id from issue_user_assignments where issue_assignment_id=? order by id', [V2]);
    check('B-09 PMT row kept + separate artist row', rows.length === 2 && rows[0].user_id === PMT && rows[1].user_id === ARTA, JSON.stringify(rows));
    const [pmtDoc] = await sql("select d.id,u.user_id from issue_documents d join issue_user_assignments u on u.id=d.issue_user_assignment_id where u.issue_assignment_id=? and d.uploaded_by='pmt'", [V2]);
    check('B-09 PMT file stays on the PMT row', pmtDoc && pmtDoc.user_id === PMT, JSON.stringify(pmtDoc));
    r = await api(ARTA, 'GET', 'users/issues?page=1&limit=-1&status=u_pending');
    const mine = (r.body.data || []).find(x => x.issue.id === V2);
    const myDocs = (mine?.assignedUsers?.[0]?.documents || []).map(d => d.id);
    check('B-09 artist sees the PMT file once', myDocs.filter(id => id === pmtDoc.id).length === 1, JSON.stringify(myDocs));
    r = await api(ARTA, 'PUT', `users/issues/${V2}/accept`, { start_date: today() }); check('artist accepts V2', ok(r), r.status);
    r = await api(ARTA, 'PUT', `users/issues/${V2}/submit`, form({ task_count: 1, link: 'https://example.com' }, { documents: 'v2-out.txt' }));
    check('artist submits V2', ok(r), r.status);
    r = await api(CMA, 'PUT', `${MA}/review`, { issue_id: V2, action: 'approved' }); check('CM A approves V2', ok(r), r.status);
    r = await api(CMA, 'POST', `${MA}/share-for-client-review`, { work_request_id: wr.id, issue_ids: [V2] }); check('CM A shares V2 (all files)', ok(r), r.status);
    const shared = await sql('select d.uploaded_by,d.intimate_client from issue_documents d join issue_user_assignments u on u.id=d.issue_user_assignment_id where u.issue_assignment_id=?', [V2]);
    check('B-09 share never marks the PMT file as shared output', shared.filter(d => d.uploaded_by === 'pmt').every(d => d.intimate_client === 0) && shared.some(d => d.uploaded_by !== 'pmt'), JSON.stringify(shared));
    r = await api(CMA, 'GET', `${MA}/issue-assignments?page=1&limit=-1&status=completed`);
    const mv2 = (r.body.data || []).find(x => x.id === V2);
    const mgrOut = (mv2?.assignedUsers || []).flatMap(u => u.documents || []).map(d => d.id);
    check('B-09 manager outputs do not contain the PMT file; pmt_documents does', mv2 && !mgrOut.includes(pmtDoc.id) && (mv2.pmt_documents || []).some(d => d.id === pmtDoc.id), JSON.stringify({ mgrOut, pmt: (mv2?.pmt_documents || []).map(d => d.id) }));

    // ---------- B-13 pm-approve history before values + duplicate writes nothing
    r = await api(PMT, 'POST', 'work-requests/pm-approve', { issue_id: V2 }); check('PMT approves V2', ok(r), r.status);
    r = await api(ARTB, 'PUT', `users/tasks/${T2}/accept`, { start_date: today() });
    r = await submit(ARTB, T2); check('artist B submits T2', ok(r), `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    r = await api(CMB, 'PUT', `${MA}/review`, { task_id: T2, action: 'approved' });
    r = await api(CMB, 'POST', `${MA}/share-for-client-review`, { work_request_id: wr.id, task_ids: [T2] });
    r = await api(PMT, 'POST', 'work-requests/pm-approve', { task_id: T2 }); check('PMT approves T2', ok(r), r.status);
    const pa = await hist('task_history', 'task_id', T2, 'pm_approved');
    check('B-13 pm_approved history: pending/pm_review -> approved/final_approved', pa.length === 1 && pa[0].previous_review === 'pending' && pa[0].previous_review_stage === 'pm_review' && pa[0].new_review_stage === 'final_approved', JSON.stringify(pa.map(x => [x.previous_review, x.previous_review_stage])));
    r = await api(PMT, 'POST', 'work-requests/pm-approve', { task_id: T2 });
    check('B-13 duplicate approve: 200, no second history row', ok(r) && (await hist('task_history', 'task_id', T2, 'pm_approved')).length === 1, r.status);

    // ---------- lists: B-19, B-21/B-06, B-22
    r = await api(CMA, 'GET', 'users/tasks?search=ZZZ_NO_SUCH_TASK&searchFields=task_name&status=overdue&page=1&limit=50');
    check('B-19 search + overdue: nothing unrelated', r.status === 200 && (r.body.data || []).length === 0, (r.body.data || []).length);
    r = await api(ARTA, 'GET', 'users/issues?page=1&limit=1&status=completed');
    check('B-21 /users/issues honours limit and returns pagination', r.status === 200 && (r.body.data || []).length <= 1 && r.body.pagination && typeof r.body.pagination.total === 'number', JSON.stringify(r.body.pagination));
    r = await api(ARTA, 'GET', 'users/issues?page=1&limit=-1&status=completed&search=ZZZ_NO_SUCH_THING');
    check('B-06 /users/issues search filters', r.status === 200 && (r.body.data || []).length === 0, (r.body.data || []).length);
    r = await api(ARTA, 'GET', `users/issues?page=1&limit=-1&status=completed&search=${encodeURIComponent(name)}`);
    check('B-06 search by project name finds the change', (r.body.data || []).some(x => x.issue.id === V2), (r.body.data || []).length);
    r = await api(CMA, 'GET', `${MA}/user/${ARTA}/tasks`);
    const ut = Array.isArray(r.body.data) ? r.body.data : (r.body.data?.tasks || []);
    check('B-22 user tasks carry workRequest', ut.length > 0 && ut.every(t => t.workRequest && t.workRequest.id), `${ut.length} tasks, null ${ut.filter(t => !t.workRequest).length}`);

    // ---------- B-14 defer / delete history statuses
    r = await api(PMT, 'POST', 'work-requests', form({ project_name: name + ' D', brand: 'E2E', request_type_id: 1, project_id: 1, description: 'E2E fixes test project for the defer history check', about_project: { output_devices: ['Print'], target_audience: ['Doctors'] }, priority: 'medium' }));
    const [wd] = await sql('select id from work_requests where project_name=?', [name + ' D']);
    r = await api(CMA, 'PUT', `${MA}/${wd.id}/defer`, { reason: 'insufficient_details', message: 'need more' });
    const [df] = await hist('work_request_history', 'work_request_id', wd.id, 'manager_deferred');
    check('B-14 defer history has status', ok(r) && df && df.previous_status === 'pending' && df.new_status === 'pending', JSON.stringify({ s: r.status, ps: df?.previous_status }));
    r = await api(CMA, 'POST', `${MA}/tasks`, taskBody('E2E del', [ARTA]));
    const TD = r.body.data?.id;
    r = await api(CMA, 'DELETE', `${MA}/tasks/${TD}`);
    const [dl] = await hist('task_history', 'task_id', TD, 'deleted');
    check('B-14 delete history has status', ok(r) && dl && dl.previous_status === 'pending', JSON.stringify({ s: r.status, ps: dl?.previous_status }));

    // ---------- B-01 / B-18 auth
    const { generateRefreshToken, generateAccessToken } = require(path.join(repo, 'middleware/jwtMiddleware'));
    const [u63] = await sql('select latest_verification_token from users where id=?', [PMT]);
    await sql('update users set latest_verification_token=? where id=?', ['e2e-secret-token', PMT]);
    r = await api(PMT, 'GET', 'auth/profile');
    check('B-01 profile does not return latest_verification_token', r.status === 200 && !JSON.stringify(r.body).includes('e2e-secret-token'), r.status);
    const payload = { id: PMT, name: 'e2e', userType: 'user' };
    const refresh = await generateRefreshToken(payload);
    let rr = await fetch(API + 'auth/refresh-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
    let rb = await rr.json();
    check('refresh before logout -> 200, no verification token in user', rr.status === 200 && !JSON.stringify(rb).includes('e2e-secret-token'), rr.status);
    await new Promise(res => setTimeout(res, 1100));
    const access = await generateAccessToken(payload);
    rr = await fetch(API + 'auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + access } });
    check('logout 200', rr.status === 200, rr.status);
    rr = await fetch(API + 'auth/refresh-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
    check('B-18 old refresh token after logout -> 401', rr.status === 401, rr.status);
    await new Promise(res => setTimeout(res, 1100));
    const fresh = await generateRefreshToken(payload);
    rr = await fetch(API + 'auth/refresh-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: fresh }) });
    check('B-18 a new login after logout still refreshes', rr.status === 200, rr.status);
    await sql('update users set latest_verification_token=? where id=?', [u63.latest_verification_token, PMT]);

    console.log(`\nprojects: ${wr.id}, ${wd.id}; tasks ${T1}, ${T2}, ${TODAYTASK}, ${TD}; change ${V2}`);
    await done();
})().catch(async e => { console.error(e); await done(); });
