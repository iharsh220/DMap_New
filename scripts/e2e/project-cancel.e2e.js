// End-to-end test of project cancellation (owner's requirement, 2026-11-06), local dump copy only.
// Sets one open project's tasks / changes to every state (started, not started, future start,
// submitted waiting for approval, completed + approved, already cancelled), then checks the preview,
// access, reason, the result in the DB, the audit history, the email, the read-only guards and that
// submitted work can still be approved. Every row it touches is saved first and restored at the end;
// history rows it creates are removed again.
// Run against the local API (CLAUDE.md "Local testing"):
//   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD= DB_NAME=dmap REDIS_HOST=127.0.0.1 REDIS_PORT=16379 node scripts/e2e/project-cancel.e2e.js
const { sql, api, check, done, form, today, plus } = require('./lib');

const ADMIN = 1;
const M = 'manager/assigned-work-requests/';
const A = 'datatable/admin/';

(async () => {
    const maxIds = (await sql(`SELECT (SELECT MAX(id) FROM task_history) th, (SELECT MAX(id) FROM issue_history) ih, (SELECT MAX(id) FROM work_request_history) wh,
                                      (SELECT MAX(id) FROM task_review_history) trh`))[0];
    const saved = { tasks: [], issues: [], wrs: [] };
    const T = today();

    // an open project with 5-8 live tasks, >= 2 changes, an active manager and requester
    const [w] = await sql(`SELECT w.id, w.user_id,
            (SELECT m.manager_id FROM work_request_managers m JOIN users u ON u.id = m.manager_id AND u.account_status = 'active' WHERE m.work_request_id = w.id LIMIT 1) AS manager_id
        FROM work_requests w JOIN users ru ON ru.id = w.user_id AND ru.account_status = 'active'
        WHERE w.is_deleted = 0 AND w.status IN ('in_progress', 'accepted', 'assigned')
          AND (SELECT COUNT(*) FROM tasks t WHERE t.work_request_id = w.id AND t.is_deleted = 0) BETWEEN 5 AND 8
          AND (SELECT COUNT(*) FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0 WHERE t.work_request_id = w.id AND ia.is_deleted = 0) >= 2
        HAVING manager_id IS NOT NULL ORDER BY w.id DESC LIMIT 1`);
    check('found a test project', !!w, JSON.stringify(w));
    if (!w) return done();
    saved.wrs.push((await sql('SELECT * FROM work_requests WHERE id = ?', [w.id]))[0]);
    const tasks = await sql('SELECT * FROM tasks WHERE work_request_id = ? AND is_deleted = 0 ORDER BY id', [w.id]);
    const changes = await sql(`SELECT ia.* FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
                               WHERE t.work_request_id = ? AND ia.is_deleted = 0 ORDER BY ia.id`, [w.id]);
    saved.tasks.push(...(await sql('SELECT * FROM tasks WHERE work_request_id = ?', [w.id])));
    saved.issues.push(...(await sql('SELECT ia.* FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id WHERE t.work_request_id = ?', [w.id])));

    // the task of the first change is the "submitted, waiting for approval" one
    const tPending = tasks.find(t => t.id === changes[0].task_id);
    const others = tasks.filter(t => t !== tPending);
    const [tStarted, tPendingStatus, tFuture, tDone, ...tClosed] = others;
    const [cStarted, cOpen, ...cDone] = changes;
    const setTask = (t, v) => sql(`UPDATE tasks SET status = ?, start_date = ?, end_date = ?, review = ?, review_stage = ?, task_count = ? WHERE id = ?`, [v[0], v[1], v[2], v[3], v[4], v[5], t.id]);
    const setChange = (c, v) => sql(`UPDATE issue_assignments SET status = ?, start_date = ?, end_date = ?, review = ?, review_stage = ?, task_count = ? WHERE id = ?`, [v[0], v[1], v[2], v[3], v[4], v[5], c.id]);
    // users of the tasks (for the CU actions)
    // a creative user (role 4) for the CU actions: the started task's own artist when it is one
    const userOf = async t => ((await sql(`SELECT u.id AS user_id FROM users u WHERE u.account_status = 'active' AND u.job_role_id = 4
        ORDER BY (u.id IN (SELECT ta.user_id FROM task_assignments ta WHERE ta.task_id = ?)) DESC, u.id LIMIT 1`, [t.id]))[0] || {}).user_id;

    try {
        await sql(`UPDATE work_requests SET status = 'in_progress' WHERE id = ?`, [w.id]);
        await setTask(tStarted, ['in_progress', plus(-5), null, 'pending', 'not_started', 2]);
        await setTask(tPendingStatus, ['pending', null, null, 'pending', 'not_started', 0]);
        await setTask(tFuture, ['accepted', plus(3), null, 'pending', 'not_started', 0]);
        await setTask(tPending, ['completed', plus(-10), plus(-2), 'pending', 'pm_review', 3]);
        await setTask(tDone, ['completed', plus(-20), plus(-15), 'approved', 'final_approved', 4]);
        for (const t of tClosed) await setTask(t, ['cancelled', null, null, 'pending', 'not_started', 0]);
        await setChange(cStarted, ['in_progress', plus(-1), null, 'pending', 'not_started', 1]);
        await setChange(cOpen, ['m_pending', null, null, 'pending', 'not_started', 0]);
        for (const c of cDone) await setChange(c, ['completed', plus(-8), plus(-7), 'approved', 'final_approved', 1]);

        // ---------- preview
        let r = await api(w.manager_id, 'GET', `${M}${w.id}/cancel-preview`);
        const pv = r.body.data || {};
        const st = pv.summary || {};
        check('preview (request manager) 200, can cancel, date = today', r.status === 200 && pv.can_cancel === true && pv.cancel_date === T, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
        check('preview task counts: 1 started, 2 not started, 1 waiting approval, 1 completed', st.tasks && st.tasks.in_progress === 1 && st.tasks.not_started === 2 && st.tasks.pending_approval === 1 && st.tasks.completed === 1 && st.tasks.closed === tClosed.length, JSON.stringify(st.tasks));
        check('preview change counts: 1 started, 1 not started, rest completed', st.changes && st.changes.in_progress === 1 && st.changes.not_started === 1 && st.changes.completed === cDone.length, JSON.stringify(st.changes));
        check('preview lists who is notified (requester + manager)', (pv.notify || []).some(x => x.kind === 'requester' && x.id === w.user_id) && (pv.notify || []).some(x => x.kind === 'manager'), JSON.stringify(pv.notify));

        // ---------- access and reason
        const [other] = await sql(`SELECT u.id FROM users u WHERE u.job_role_id = 2 AND u.account_status = 'active'
                                     AND u.id NOT IN (SELECT manager_id FROM work_request_managers WHERE work_request_id = ?) LIMIT 1`, [w.id]);
        r = await api(other.id, 'PUT', `${M}${w.id}/cancel`, { reason: 'Not my project at all' });
        check('another manager cannot cancel (404)', r.status === 404, r.status);
        const cu = await userOf(tStarted);
        if (cu) { r = await api(cu, 'PUT', `${M}${w.id}/cancel`, { reason: 'I am a creative user' }); check('creative user cannot cancel (403)', r.status === 403, r.status); }
        r = await api(w.manager_id, 'PUT', `${M}${w.id}/cancel`, {});
        check('cancel without a reason -> 400', r.status === 400 && /reason/i.test(r.body.error), r.status + ' ' + r.body.error);
        r = await api(w.manager_id, 'PUT', `${M}${w.id}/cancel`, { reason: 'no' });
        check('cancel with a too short reason -> 400', r.status === 400, r.status);
        check('nothing changed after refused cancels', (await sql('SELECT status FROM work_requests WHERE id = ?', [w.id]))[0].status === 'in_progress');

        // ---------- cancel
        const reason = 'Client stopped the campaign (e2e test)';
        r = await api(w.manager_id, 'PUT', `${M}${w.id}/cancel`, { reason });
        check('cancel by the request manager -> 200, old message kept', r.status === 200 && r.body.success === true && r.body.message === 'Work request and all related tasks/issues cancelled successfully', r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
        check('response has the summary and email queued', r.body.data && r.body.data.summary && r.body.data.email_status === 'queued', r.body.data && r.body.data.email_status);

        const row = id => sql('SELECT status, start_date, end_date, review, review_stage, task_count FROM tasks WHERE id = ?', [id]).then(x => x[0]);
        const crow = id => sql('SELECT status, start_date, end_date, review, review_stage FROM issue_assignments WHERE id = ?', [id]).then(x => x[0]);
        check('project is cancelled', (await sql('SELECT status FROM work_requests WHERE id = ?', [w.id]))[0].status === 'cancelled');
        let x = await row(tStarted.id);
        check('started task: cancelled, start kept, end = cancellation date', x.status === 'cancelled' && x.start_date === plus(-5) && x.end_date === T, JSON.stringify(x));
        x = await row(tPendingStatus.id);
        check('pending task: cancelled, no dates', x.status === 'cancelled' && !x.start_date && !x.end_date, JSON.stringify(x));
        x = await row(tFuture.id);
        check('accepted task with a future start: cancelled, no dates', x.status === 'cancelled' && !x.start_date && !x.end_date, JSON.stringify(x));
        x = await row(tPending.id);
        check('submitted task waiting for approval: unchanged', x.status === 'completed' && x.review_stage === 'pm_review' && x.end_date === plus(-2), JSON.stringify(x));
        x = await row(tDone.id);
        check('completed + approved task: unchanged', x.status === 'completed' && x.review_stage === 'final_approved' && x.start_date === plus(-20) && x.end_date === plus(-15), JSON.stringify(x));
        x = await crow(cStarted.id);
        check('started change: cancelled, end = cancellation date', x.status === 'cancelled' && x.start_date === plus(-1) && x.end_date === T, JSON.stringify(x));
        x = await crow(cOpen.id);
        check('open change (m_pending): cancelled, no dates', x.status === 'cancelled' && !x.start_date && !x.end_date, JSON.stringify(x));

        // ---------- audit
        const [wh] = await sql(`SELECT * FROM work_request_history WHERE work_request_id = ? AND action = 'cancelled' AND id > ?`, [w.id, maxIds.wh || 0]);
        const ch = wh && (typeof wh.changes === 'string' ? JSON.parse(wh.changes) : wh.changes);
        check('project history: who, reason, date, every changed / flagged item', wh && wh.actor_id === w.manager_id && wh.comments === reason && ch.cancelled_on === T && ch.items.length === 6, wh && JSON.stringify({ actor: wh.actor_id, n: ch.items.length }));
        const th = await sql(`SELECT task_id, action FROM task_history WHERE id > ? AND task_id IN (?)`, [maxIds.th || 0, tasks.map(t => t.id)]);
        check('task history: 3 cancelled_with_project + 1 flagged_on_cancellation', th.filter(h => h.action === 'cancelled_with_project').length === 3 && th.filter(h => h.action === 'flagged_on_cancellation' && h.task_id === tPending.id).length === 1, JSON.stringify(th));
        const ih = await sql(`SELECT issue_assignment_id, action, previous_data FROM issue_history WHERE id > ? AND issue_assignment_id IN (?)`, [maxIds.ih || 0, [cStarted.id, cOpen.id]]);
        check('change history keeps the old status and dates', ih.length === 2 && ih.every(h => h.action === 'cancelled_with_project') && ih.some(h => JSON.stringify(h.previous_data).includes('in_progress')), JSON.stringify(ih));

        // ---------- read-only
        r = await api(w.manager_id, 'PUT', `${M}${w.id}/cancel`, { reason: 'Cancel it again please' });
        check('second cancel -> 400 (already cancelled)', r.status === 400, r.status + ' ' + r.body.error);
        r = await api(ADMIN, 'GET', `${A}projects/${w.id}/cancel-preview`);
        check('admin preview of a cancelled project: cannot cancel', r.status === 200 && r.body.data.can_cancel === false, r.status);
        const ro = (name, res) => check(`read-only: ${name} -> 400`, res.status === 400 && /cancelled/i.test(String(res.body.error)), res.status + ' ' + res.body.error);
        ro('update task', await api(w.manager_id, 'PUT', `${M}tasks/${tPending.id}`, { task_name: 'x' }));
        ro('delete task', await api(w.manager_id, 'DELETE', `${M}tasks/${tDone.id}`));
        ro('manager review "change_request"', await api(w.manager_id, 'PUT', `${M}review`, { task_id: tPending.id, action: 'change_request', comments: 'x' }));
        ro('assign change to a user', await api(w.manager_id, 'POST', `${M}assign-issue-to-user`, { issue_assignment_id: cOpen.id, user_id: cu || 1 }));
        ro('complete all', await api(w.manager_id, 'PUT', `${M}complete`, { work_request_id: w.id }));
        ro('reassign task', await api(w.manager_id, 'POST', 'users/assign-task', { task_id: tPendingStatus.id, user_id: cu || 1, work_request_id: w.id }));
        if (cu) {
            ro('CU accept task', await api(cu, 'PUT', `users/tasks/${tStarted.id}/accept`, {}));
            ro('CU submit task', await api(cu, 'POST', 'users/tasks/submit', form({ task_id: tStarted.id, task_count: '2', link: 'https://example.com' })));
        }
        ro('requester raises a change (pm-reject)', await api(w.user_id, 'POST', 'work-requests/pm-reject', { task_id: tPending.id, comments: 'x', issue_register_ids: [1] }));
        ro('requester edits the project', await api(w.user_id, 'PUT', `work-requests/${w.id}`, { project_name: 'x' }));
        ro('admin edits the project', await api(ADMIN, 'PUT', `${A}edit/project/${w.id}`, { project_name: 'x', status: 'in_progress' }));
        ro('admin edits a task', await api(ADMIN, 'PUT', `${A}edit/task/${tDone.id}`, { task_name: 'x' }));
        ro('requester raises a new change', await api(w.user_id, 'POST', 'issue-register/assignment', { task_id: tDone.id, requested_by_user_id: w.user_id, assignment_type: 'mod', version: 'V2', description: 'x', issue_register_ids: [1] }));
        ro('manager creates a new task', await api(w.manager_id, 'POST', `${M}tasks`, { work_request_id: w.id, task_name: 'x', task_type_id: tDone.task_type_id, request_type_id: tDone.request_type_id, assigned_to_ids: [cu || 1], deadline: plus(5) }));
        x = await row(tPending.id);
        check('read-only attempts changed nothing', x.status === 'completed' && x.review_stage === 'pm_review', JSON.stringify(x));

        // ---------- submitted work can still be approved (normal flow), the project stays cancelled
        r = await api(w.user_id, 'POST', 'work-requests/pm-approve', { task_id: tPending.id });
        x = await row(tPending.id);
        check('PMT approves the submitted task -> final approved', r.status === 200 && x.review_stage === 'final_approved', r.status + ' ' + JSON.stringify(x));
        check('project stays cancelled after the approval', (await sql('SELECT status FROM work_requests WHERE id = ?', [w.id]))[0].status === 'cancelled');

        // ---------- admin grid shows it at once (cache cleared by the cancel)
        r = await api(ADMIN, 'GET', `${A}projectsdetails/data?page=1&limit=5&col_exact=${encodeURIComponent(JSON.stringify({ work_request_id: [String(w.id)] }))}`);
        check('Projects grid shows the project as cancelled', r.status === 200 && r.body.data[0] && r.body.data[0].project_request_status === 'cancelled', r.status + ' ' + (r.body.data && r.body.data[0] && r.body.data[0].project_request_status));
    } finally {
        // ---------- restore everything this test touched
        const restore = async (table, rows) => {
            for (const rowData of rows) {
                const cols = Object.keys(rowData).filter(k => k !== 'id');
                await sql(`UPDATE ${table} SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => rowData[c]), rowData.id]);
            }
        };
        await restore('tasks', saved.tasks);
        await restore('issue_assignments', saved.issues);
        await restore('work_requests', saved.wrs);
        await sql('DELETE FROM task_history WHERE id > ?', [maxIds.th || 0]);
        await sql('DELETE FROM issue_history WHERE id > ?', [maxIds.ih || 0]);
        await sql('DELETE FROM work_request_history WHERE id > ?', [maxIds.wh || 0]);
        await sql('DELETE FROM task_review_history WHERE id > ?', [maxIds.trh || 0]);
        console.log(`restored project ${w.id}: ${saved.tasks.length} tasks, ${saved.issues.length} changes; removed new history rows`);
    }
    await done();
})().catch(err => { console.error(err); process.exit(1); });
