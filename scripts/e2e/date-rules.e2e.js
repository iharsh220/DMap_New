// End-to-end test of the start / end date rules (2026-11-12), local dump copy only:
// accept (task, change): start date is a real date, not before today, an old end date is cleared;
// submit (task, change): optional end_date picked by the user, never in the future, never before
// the start date; new changes (issue-register create, PMT rework): end never before start.
// Every row it touches is saved first and restored at the end; history rows it creates are removed.
// Run against the local API (CLAUDE.md "Local testing"):
//   DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD= DB_NAME=dmap REDIS_HOST=127.0.0.1 REDIS_PORT=16379 node scripts/e2e/date-rules.e2e.js
const { sql, api, check, done, form, today, plus } = require('./lib');

(async () => {
    const maxIds = (await sql(`SELECT (SELECT MAX(id) FROM task_history) th, (SELECT MAX(id) FROM issue_history) ih, (SELECT MAX(id) FROM work_request_history) wh, (SELECT MAX(id) FROM issue_assignments) ia`))[0];
    const saved = { tasks: [], issues: [] };
    const snapTask = async id => { const [r] = await sql('SELECT * FROM tasks WHERE id = ?', [id]); saved.tasks.push(r); return r; };
    const snapIssue = async id => { const [r] = await sql('SELECT * FROM issue_assignments WHERE id = ?', [id]); saved.issues.push(r); return r; };
    const taskRow = async id => (await sql('SELECT status, start_date, end_date, task_count FROM tasks WHERE id = ?', [id]))[0];
    const issueRow = async id => (await sql('SELECT status, start_date, end_date, task_count FROM issue_assignments WHERE id = ?', [id]))[0];
    let r;

    try {
        // ---------- task accept
        const [t] = await sql(`SELECT t.id, ta.user_id FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id
                               JOIN users u ON u.id = ta.user_id AND u.account_status = 'active'
                               JOIN work_requests w ON w.id = t.work_request_id AND w.is_deleted = 0 AND w.status NOT IN ('cancelled', 'rejected', 'completed')
                               WHERE t.is_deleted = 0 AND t.intimate_team = 1 ORDER BY t.id DESC LIMIT 1`);
        await snapTask(t.id);
        await sql(`UPDATE tasks SET status = 'pending', start_date = NULL, end_date = ? WHERE id = ?`, [plus(-30), t.id]);
        for (const [bad, label] of [['abc', 'text'], ['2026-02-31', 'impossible date'], [plus(-1), 'yesterday']]) {
            r = await api(t.user_id, 'PUT', `users/tasks/${t.id}/accept`, { start_date: bad });
            check(`task accept with ${label} start -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        check('refused accepts wrote nothing', (await taskRow(t.id)).status === 'pending');
        r = await api(t.user_id, 'PUT', `users/tasks/${t.id}/accept`, { start_date: plus(2) });
        let tr = await taskRow(t.id);
        check('task accept with a future start -> accepted, old end date cleared', r.status === 200 && tr.status === 'accepted' && tr.start_date === plus(2) && tr.end_date === null, r.status + ' ' + JSON.stringify(tr));

        // ---------- task submit
        r = await api(t.user_id, 'POST', 'users/tasks/submit', form({ task_id: t.id, task_count: '2' }));
        check('task submit today with a future start -> 400', r.status === 400, r.status + ' ' + r.body.error);
        await sql(`UPDATE tasks SET status = 'in_progress', start_date = ? WHERE id = ?`, [plus(-5), t.id]);
        for (const [end, label] of [[plus(1), 'future'], [plus(-6), 'before start'], ['x', 'invalid'], ['2026-13-01', 'impossible']]) {
            r = await api(t.user_id, 'POST', 'users/tasks/submit', form({ task_id: t.id, task_count: '2', end_date: end }));
            check(`task submit with ${label} end_date -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        r = await api(t.user_id, 'POST', 'users/tasks/submit', form({ task_id: t.id, task_count: '2', start_date: plus(-1), end_date: plus(-2) }));
        check('task submit with start_date after end_date -> 400', r.status === 400, r.status + ' ' + r.body.error);
        check('refused submits wrote nothing', (await taskRow(t.id)).status === 'in_progress');
        r = await api(t.user_id, 'POST', 'users/tasks/submit', form({ task_id: t.id, task_count: '2', end_date: plus(-2) }));
        tr = await taskRow(t.id);
        check('task submit with a picked end_date -> saved as picked', r.status === 200 && tr.status === 'completed' && tr.start_date === plus(-5) && tr.end_date === plus(-2), r.status + ' ' + JSON.stringify(tr));
        await sql(`UPDATE tasks SET status = 'in_progress', start_date = ?, end_date = NULL WHERE id = ?`, [plus(-5), t.id]);
        r = await api(t.user_id, 'POST', 'users/tasks/submit', form({ task_id: t.id, task_count: '2' }));
        tr = await taskRow(t.id);
        check('task submit without end_date -> end = today (unchanged behaviour)', r.status === 200 && tr.end_date === today(), r.status + ' ' + JSON.stringify(tr));

        // ---------- change accept
        const [i] = await sql(`SELECT ia.id, iu.user_id FROM issue_assignments ia JOIN issue_user_assignments iu ON iu.issue_assignment_id = ia.id
                               JOIN users u ON u.id = iu.user_id AND u.account_status = 'active'
                               JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
                               JOIN work_requests w ON w.id = t.work_request_id AND w.is_deleted = 0 AND w.status NOT IN ('cancelled', 'rejected')
                               WHERE ia.is_deleted = 0 AND ia.intimate_team = 1 ORDER BY ia.id DESC LIMIT 1`);
        await snapIssue(i.id);
        await sql(`UPDATE issue_assignments SET status = 'u_pending', start_date = NULL, end_date = ? WHERE id = ?`, [plus(-30), i.id]);
        for (const [bad, label] of [['abc', 'text'], ['2026-02-31', 'impossible date'], [plus(-1), 'yesterday']]) {
            r = await api(i.user_id, 'PUT', `users/issues/${i.id}/accept`, { start_date: bad });
            check(`change accept with ${label} start -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        await sql(`UPDATE issue_assignments SET status = 'cancelled' WHERE id = ?`, [i.id]);
        r = await api(i.user_id, 'PUT', `users/issues/${i.id}/accept`, { start_date: today() });
        check('change accept of a cancelled change -> 400', r.status === 400 && (await issueRow(i.id)).status === 'cancelled', r.status + ' ' + r.body.error);
        await sql(`UPDATE issue_assignments SET status = 'u_pending' WHERE id = ?`, [i.id]);
        r = await api(i.user_id, 'PUT', `users/issues/${i.id}/accept`, { start_date: plus(2) });
        let ir = await issueRow(i.id);
        check('change accept with a future start -> u_accepted, old end date cleared', r.status === 200 && ir.status === 'u_accepted' && ir.start_date === plus(2) && ir.end_date === null && r.body.data.start_date === plus(2), r.status + ' ' + JSON.stringify(ir) + ' ' + JSON.stringify(r.body.data));
        await sql(`UPDATE issue_assignments SET status = 'u_pending' WHERE id = ?`, [i.id]);
        r = await api(i.user_id, 'PUT', `users/issues/${i.id}/accept`, {});
        ir = await issueRow(i.id);
        check('change accept without start -> in_progress from today', r.status === 200 && ir.status === 'in_progress' && ir.start_date === today(), r.status + ' ' + JSON.stringify(ir));

        // ---------- change submit
        await sql(`UPDATE issue_assignments SET status = 'in_progress', start_date = ?, end_date = NULL WHERE id = ?`, [plus(-3), i.id]);
        for (const [body, label] of [[{ end_date: plus(1) }, 'future end_date'], [{ end_date: plus(-4) }, 'end_date before the start'], [{ end_date: 'x' }, 'invalid end_date'], [{ start_date: plus(-1), end_date: plus(-2) }, 'start_date after end_date']]) {
            r = await api(i.user_id, 'PUT', `users/issues/${i.id}/submit`, form({ link: 'https://example.com', task_count: '2', ...body }));
            check(`change submit with ${label} -> 400`, r.status === 400, r.status + ' ' + r.body.error);
        }
        check('refused change submits wrote nothing', (await issueRow(i.id)).status === 'in_progress');
        r = await api(i.user_id, 'PUT', `users/issues/${i.id}/submit`, form({ link: 'https://example.com', task_count: '2', end_date: plus(-1) }));
        ir = await issueRow(i.id);
        check('change submit with a picked end_date -> saved as picked', r.status === 200 && ir.status === 'completed' && ir.start_date === plus(-3) && ir.end_date === plus(-1), r.status + ' ' + JSON.stringify(ir));
        await sql(`UPDATE issue_assignments SET status = 'u_accepted', start_date = ?, end_date = NULL WHERE id = ?`, [plus(3), i.id]);
        r = await api(i.user_id, 'PUT', `users/issues/${i.id}/submit`, form({ link: 'https://example.com', task_count: '2' }));
        ir = await issueRow(i.id);
        check('change with a future start finished early -> start = end = today (unchanged behaviour)', r.status === 200 && ir.start_date === today() && ir.end_date === today(), r.status + ' ' + JSON.stringify(ir));

        // ---------- new changes: end never before start
        const [c] = await sql(`SELECT t.id, w.user_id FROM tasks t JOIN work_requests w ON w.id = t.work_request_id AND w.is_deleted = 0 AND w.status NOT IN ('cancelled', 'rejected')
                               JOIN users u ON u.id = w.user_id AND u.account_status = 'active'
                               WHERE t.is_deleted = 0 AND t.status NOT IN ('cancelled', 'rejected') ORDER BY t.id DESC LIMIT 1`);
        const before = (await sql('SELECT COUNT(*) n FROM issue_assignments'))[0].n;
        r = await api(c.user_id, 'POST', 'issue-register/assignment', { task_id: c.id, requested_by_user_id: c.user_id, assignment_type: 'mod', version: 'V9', start_date: plus(5), end_date: plus(2) });
        check('issue-register create with end before start -> 400', r.status === 400, r.status + ' ' + r.body.error);
        r = await api(c.user_id, 'POST', 'issue-register/assignment', { task_id: c.id, requested_by_user_id: c.user_id, assignment_type: 'mod', version: 'V9', start_date: '2026-02-31' });
        check('issue-register create with impossible start -> 400', r.status === 400, r.status + ' ' + r.body.error);
        r = await api(c.user_id, 'POST', 'work-requests/pm-reject', { task_id: c.id, comments: 'test', start_date: plus(5), end_date: plus(2) });
        check('PMT rework with end before start -> 400', r.status === 400, r.status + ' ' + r.body.error);
        check('no change row was created', (await sql('SELECT COUNT(*) n FROM issue_assignments'))[0].n === before);
    } finally {
        const restore = async (table, rows) => {
            for (const row of rows.slice().reverse()) {
                const cols = Object.keys(row).filter(k => k !== 'id');
                await sql(`UPDATE ${table} SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => row[c]), row.id]);
            }
        };
        await restore('tasks', saved.tasks);
        await restore('issue_assignments', saved.issues);
        await sql('DELETE FROM issue_assignments WHERE id > ?', [maxIds.ia || 0]);
        await sql('DELETE FROM task_history WHERE id > ?', [maxIds.th || 0]);
        await sql('DELETE FROM issue_history WHERE id > ?', [maxIds.ih || 0]);
        await sql('DELETE FROM work_request_history WHERE id > ?', [maxIds.wh || 0]);
        console.log(`restored ${saved.tasks.length} tasks, ${saved.issues.length} changes; removed new history rows`);
    }
    await done();
})().catch(e => { console.error(e); process.exit(1); });
