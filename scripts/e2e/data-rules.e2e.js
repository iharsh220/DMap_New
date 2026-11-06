// End-to-end test of the task / change data rules (owner, 2026-11-05), local dump copy only:
// pages >= 1 on submit, end date never before start date, completed items always have dates and
// pages ("Complete all", admin edit, PM approval), no reassigning finished tasks, no "completed"
// project without work. Every row it touches is saved first and restored at the end; history /
// mail rows it creates are removed again.
// Run against the local API (CLAUDE.md "Local testing"):
//   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD= DB_NAME=dmap REDIS_HOST=127.0.0.1 REDIS_PORT=16379 node scripts/e2e/data-rules.e2e.js
const { sql, api, check, done, form, today, plus } = require('./lib');

const ADMIN = 1;
const A = 'datatable/admin/';

(async () => {
    const maxIds = (await sql(`SELECT (SELECT MAX(id) FROM task_history) th, (SELECT MAX(id) FROM issue_history) ih, (SELECT MAX(id) FROM work_request_history) wh`))[0];
    const saved = { tasks: [], issues: [], wrs: [] };
    const snapTask = async id => { const [r] = await sql('SELECT * FROM tasks WHERE id = ?', [id]); saved.tasks.push(r); return r; };
    const snapIssue = async id => { const [r] = await sql('SELECT * FROM issue_assignments WHERE id = ?', [id]); saved.issues.push(r); return r; };
    const snapWr = async id => { const [r] = await sql('SELECT * FROM work_requests WHERE id = ?', [id]); saved.wrs.push(r); return r; };

    try {
        // ---------- task submit: pages
        const [t1] = await sql(`SELECT t.id, t.work_request_id, ta.user_id FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id JOIN users u ON u.id = ta.user_id AND u.account_status = 'active'
                                WHERE t.is_deleted = 0 AND t.status = 'in_progress' AND t.start_date <= CURDATE() ORDER BY t.id DESC LIMIT 1`);
        await snapTask(t1.id);
        for (const bad of ['0', '-2', '2.5', 'abc']) {
            const r = await api(t1.user_id, 'POST', 'users/tasks/submit', form({ task_id: t1.id, task_count: bad, link: 'https://example.com' }));
            check(`task submit with task_count "${bad}" -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        const still = (await sql('SELECT status FROM tasks WHERE id = ?', [t1.id]))[0];
        check('rejected submit wrote nothing', still.status === 'in_progress', still.status);
        let r = await api(t1.user_id, 'POST', 'users/tasks/submit', form({ task_id: t1.id, task_count: '3', link: 'https://example.com' }));
        const after1 = (await sql('SELECT status, task_count, start_date, end_date FROM tasks WHERE id = ?', [t1.id]))[0];
        check('task submit with 3 pages -> completed with end date', r.status === 200 && after1.status === 'completed' && after1.task_count === 3 && after1.end_date && after1.end_date >= after1.start_date, r.status + ' ' + JSON.stringify(after1));

        // ---------- change submit: pages + future start date
        const [i1] = await sql(`SELECT ia.id, iu.user_id FROM issue_assignments ia JOIN issue_user_assignments iu ON iu.issue_assignment_id = ia.id JOIN users u ON u.id = iu.user_id AND u.account_status = 'active'
                                WHERE ia.is_deleted = 0 AND ia.status IN ('in_progress', 'u_accepted') ORDER BY ia.id DESC LIMIT 1`);
        check('found an open change to test with', !!i1);
        if (i1) {
            await snapIssue(i1.id);
            await sql('UPDATE issue_assignments SET status = ?, start_date = ?, task_count = 0 WHERE id = ?', ['u_accepted', plus(3), i1.id]);
            r = await api(i1.user_id, 'PUT', `users/issues/${i1.id}/submit`, form({ link: 'https://example.com' }));
            check('change submit without pages (change has 0) -> 400', r.status === 400, r.status + ' ' + r.body.error);
            r = await api(i1.user_id, 'PUT', `users/issues/${i1.id}/submit`, form({ link: 'https://example.com', task_count: '0' }));
            check('change submit with 0 pages -> 400', r.status === 400, r.status);
            r = await api(i1.user_id, 'PUT', `users/issues/${i1.id}/submit`, form({ link: 'https://example.com', task_count: '2', start_date: plus(1) }));
            check('change submit with a future start_date -> 400', r.status === 400, r.status + ' ' + r.body.error);
            r = await api(i1.user_id, 'PUT', `users/issues/${i1.id}/submit`, form({ link: 'https://example.com', task_count: '2' }));
            const ai = (await sql('SELECT status, task_count, start_date, end_date FROM issue_assignments WHERE id = ?', [i1.id]))[0];
            check('change accepted for a future start, finished early: start moves to today, end >= start', r.status === 200 && ai.status === 'completed' && ai.task_count === 2 && ai.start_date === today() && ai.end_date >= ai.start_date, r.status + ' ' + JSON.stringify(ai));
        }

        // ---------- "Complete all"
        const [wr] = await sql(`SELECT w.id, m.manager_id FROM work_requests w JOIN work_request_managers m ON m.work_request_id = w.id JOIN users u ON u.id = m.manager_id AND u.account_status = 'active'
                                WHERE w.is_deleted = 0 AND w.status IN ('accepted', 'in_progress', 'assigned')
                                  AND (SELECT COUNT(*) FROM tasks t WHERE t.work_request_id = w.id AND t.is_deleted = 0) BETWEEN 2 AND 6
                                  AND EXISTS (SELECT 1 FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id WHERE t.work_request_id = w.id AND ia.is_deleted = 0)
                                ORDER BY w.id DESC LIMIT 1`);
        await snapWr(wr.id);
        const wrTasks = await sql('SELECT id FROM tasks WHERE work_request_id = ?', [wr.id]);
        for (const t of wrTasks) await snapTask(t.id);
        const wrIssues = await sql('SELECT ia.id FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id WHERE t.work_request_id = ?', [wr.id]);
        for (const i of wrIssues) await snapIssue(i.id);
        // one task without pages, one cancelled task, one change with a future start date
        await sql('UPDATE tasks SET task_count = 0 WHERE id = ?', [wrTasks[0].id]);
        await sql('UPDATE tasks SET status = ?, end_date = NULL WHERE id = ?', ['cancelled', wrTasks[1].id]);
        r = await api(wr.manager_id, 'PUT', 'manager/assigned-work-requests/complete', { work_request_id: wr.id });
        check('complete all with a task without pages -> 400 naming it', r.status === 400 && /pages/.test(r.body.error) && r.body.error.includes('#' + wrTasks[0].id), r.status + ' ' + r.body.error);
        const unchanged = (await sql('SELECT status FROM work_requests WHERE id = ?', [wr.id]))[0];
        check('refused complete all wrote nothing', unchanged.status === saved.wrs[0].status);
        await sql('UPDATE tasks SET task_count = 2 WHERE work_request_id = ? AND task_count < 1', [wr.id]);
        await sql('UPDATE issue_assignments ia JOIN tasks t ON t.id = ia.task_id SET ia.task_count = 1, ia.start_date = ? WHERE t.work_request_id = ? AND ia.task_count < 1', [plus(5), wr.id]);
        await sql('UPDATE issue_assignments ia JOIN tasks t ON t.id = ia.task_id SET ia.start_date = ?, ia.end_date = NULL WHERE t.work_request_id = ? AND ia.id = ?', [plus(5), wr.id, wrIssues[0].id]);
        r = await api(wr.manager_id, 'PUT', 'manager/assigned-work-requests/complete', { work_request_id: wr.id });
        check('complete all -> 200 with the old response fields', r.status === 200 && r.body.success === true && r.body.data && 'tasks_updated' in r.body.data, r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
        const ts = await sql('SELECT id, status, start_date, end_date FROM tasks WHERE work_request_id = ? AND is_deleted = 0', [wr.id]);
        const cancelled = ts.find(x => x.id === wrTasks[1].id);
        check('cancelled task stays cancelled', cancelled.status === 'cancelled', cancelled.status);
        const done1 = ts.filter(x => x.id !== wrTasks[1].id);
        check('every other task completed with start and end date, end >= start', done1.every(x => x.status === 'completed' && x.start_date && x.end_date && x.end_date >= x.start_date), JSON.stringify(done1));
        const is = await sql('SELECT ia.id, ia.status, ia.start_date, ia.end_date FROM issue_assignments ia JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0 AND t.status NOT IN (\'cancelled\', \'rejected\') WHERE t.work_request_id = ? AND ia.is_deleted = 0 AND ia.status NOT IN (\'cancelled\', \'rejected\')', [wr.id]);
        check('every change completed with dates; future start moved to today', is.every(x => x.status === 'completed' && x.start_date <= today() && x.end_date && x.end_date >= x.start_date), JSON.stringify(is));

        // ---------- manager updateTask: no reassigning a completed task
        const [ct] = await sql(`SELECT t.id, ta.user_id, m.manager_id FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id JOIN work_request_managers m ON m.work_request_id = t.work_request_id
                                JOIN users u ON u.id = m.manager_id AND u.account_status = 'active' AND u.job_role_id = 2
                                WHERE t.is_deleted = 0 AND t.status = 'completed' ORDER BY t.id DESC LIMIT 1`);
        await snapTask(ct.id);
        const [other] = await sql(`SELECT ud.user_id FROM user_divisions ud JOIN user_divisions mine ON mine.division_id = ud.division_id AND mine.user_id = ? JOIN users u ON u.id = ud.user_id AND u.account_status = 'active' AND u.job_role_id = 4 WHERE ud.user_id <> ? LIMIT 1`, [ct.manager_id, ct.user_id]);
        r = await api(ct.manager_id, 'PUT', `manager/assigned-work-requests/tasks/${ct.id}`, { user_id: other.user_id, task_name: 'should not be saved' });
        const ctAfter = (await sql('SELECT task_name, status FROM tasks WHERE id = ?', [ct.id]))[0];
        check('reassigning a completed task -> 400 and nothing saved', r.status === 400 && ctAfter.status === 'completed' && ctAfter.task_name === saved.tasks[saved.tasks.length - 1].task_name, r.status + ' ' + r.body.error);

        // ---------- PM approval only of completed work
        const [pt] = await sql(`SELECT t.id, w.user_id FROM tasks t JOIN work_requests w ON w.id = t.work_request_id JOIN users u ON u.id = w.user_id AND u.account_status = 'active'
                                WHERE t.is_deleted = 0 AND t.status = 'in_progress' AND t.id <> ? ORDER BY t.id DESC LIMIT 1`, [t1.id]);
        await snapTask(pt.id);
        await sql('UPDATE tasks SET intimate_client = 1 WHERE id = ?', [pt.id]);
        r = await api(pt.user_id, 'POST', 'work-requests/pm-approve', { task_id: pt.id });
        check('PM approving an in-progress task -> 400', r.status === 400 && /completed/.test(r.body.error), r.status + ' ' + r.body.error);

        // ---------- admin edit
        const [at] = await sql("SELECT * FROM tasks WHERE is_deleted = 0 AND status = 'completed' AND start_date IS NOT NULL AND end_date IS NOT NULL AND task_count > 0 ORDER BY id DESC LIMIT 1");
        await snapTask(at.id);
        const base = { task_name: at.task_name, status: 'completed', review: at.review, review_stage: at.review_stage, deadline: at.deadline, start_date: at.start_date, end_date: at.end_date, task_count: at.task_count };
        for (const [name, patch] of [
            ['completed without end date', { end_date: '' }],
            ['end date before start date', { end_date: '2020-01-01' }],
            ['completed with 0 pages', { task_count: '0' }],
            ['impossible date 2026-02-31', { deadline: '2026-02-31' }],
            ['open task with an end date', { status: 'in_progress' }],
            ['unknown status', { status: 'done' }]
        ]) {
            r = await api(ADMIN, 'PUT', A + 'edit/task/' + at.id, Object.assign({}, base, patch));
            check(`admin edit task: ${name} -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        r = await api(ADMIN, 'PUT', A + 'edit/task/' + at.id, Object.assign({}, base, { comments: 'admin edit e2e' }));
        const hist = await sql("SELECT action FROM task_history WHERE task_id = ? AND action = 'admin_updated' AND id > ?", [at.id, maxIds.th || 0]);
        check('valid admin edit -> 200 and an admin_updated history row', r.status === 200 && hist.length === 1, r.status + ' ' + hist.length);
        const [ai2] = await sql("SELECT * FROM issue_assignments WHERE is_deleted = 0 AND status = 'completed' AND start_date IS NOT NULL AND end_date IS NOT NULL AND task_count > 0 ORDER BY id DESC LIMIT 1");
        await snapIssue(ai2.id);
        r = await api(ADMIN, 'PUT', A + 'edit/issue/' + ai2.id, { status: 'completed', review: ai2.review, review_stage: ai2.review_stage, deadline: ai2.deadline, start_date: ai2.start_date, end_date: null, task_count: ai2.task_count });
        check('admin edit change: completed without end date -> 400', r.status === 400, r.status + ' ' + r.body.error);

        // ---------- admin project status
        const [emptyWr] = await sql("SELECT w.* FROM work_requests w WHERE w.is_deleted = 0 AND w.status = 'pending' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id = w.id) ORDER BY w.id DESC LIMIT 1");
        await snapWr(emptyWr.id);
        r = await api(ADMIN, 'PUT', A + 'edit/project/' + emptyWr.id, { project_name: emptyWr.project_name, brand: emptyWr.brand, priority: emptyWr.priority, status: 'completed', remarks: emptyWr.remarks, description: emptyWr.description });
        check('admin cannot mark a project without tasks completed -> 400', r.status === 400, r.status + ' ' + r.body.error);
        const [openWr] = await sql("SELECT w.* FROM work_requests w WHERE w.is_deleted = 0 AND w.status = 'in_progress' AND EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id = w.id AND t.is_deleted = 0 AND t.status = 'in_progress') ORDER BY w.id DESC LIMIT 1");
        await snapWr(openWr.id);
        r = await api(ADMIN, 'PUT', A + 'edit/project/' + openWr.id, { project_name: openWr.project_name, brand: openWr.brand, priority: openWr.priority, status: 'completed', remarks: openWr.remarks, description: openWr.description });
        check('admin cannot mark a project with open tasks completed -> 400', r.status === 400 && /open work/.test(r.body.error), r.status + ' ' + r.body.error);
        r = await api(ADMIN, 'PUT', A + 'edit/project/' + openWr.id, { project_name: openWr.project_name, brand: openWr.brand, priority: openWr.priority, status: 'accepted', remarks: openWr.remarks, description: openWr.description });
        const wh = await sql("SELECT action FROM work_request_history WHERE work_request_id = ? AND action = 'admin_status_changed' AND id > ?", [openWr.id, maxIds.wh || 0]);
        check('other admin status changes still work and are in the history', r.status === 200 && wh.length === 1, r.status + ' ' + wh.length);
    } finally {
        // ---------- restore everything this test touched
        const restore = async (table, rows) => {
            for (const row of rows.slice().reverse()) {
                const cols = Object.keys(row).filter(k => k !== 'id');
                await sql(`UPDATE ${table} SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => row[c]), row.id]);
            }
        };
        await restore('tasks', saved.tasks);
        await restore('issue_assignments', saved.issues);
        await restore('work_requests', saved.wrs);
        await sql('DELETE FROM task_history WHERE id > ?', [maxIds.th || 0]);
        await sql('DELETE FROM issue_history WHERE id > ?', [maxIds.ih || 0]);
        await sql('DELETE FROM work_request_history WHERE id > ?', [maxIds.wh || 0]);
        console.log(`restored ${saved.tasks.length} tasks, ${saved.issues.length} changes, ${saved.wrs.length} projects; removed new history rows`);
    }
    await done();
})().catch(err => { console.error(err); process.exit(1); });
