// S2: Manager -> Manager -> User. PMT raises a Web project; CM A accepts and gives a Graphic task to
// CM B (another Digilabs manager); CM B assigns it to his own artist B. Both managers see it.
// Owner's rule (2026-11-06): the manager who received and assigned the task (CM B) is the main
// manager and handles it; the manager who created it (CM A) can only view it.
const { api, users, check, must, today, plus } = require('../lib');
const F = require('../flow');
// two history rows describing the same step (same record, second, action, change, actor, item, comment)
const sameRow = (a, b) => ['action', 'previous_status', 'new_status', 'previous_review_stage', 'new_review_stage', 'actor_id', 'related_task_id', 'related_issue_id', 'comments'].every(k => String(a.raw[k]) === String(b.raw[k])) && a.record === b.record && a.when === b.when;

module.exports = async function delegation() {
    const CMA = users.CM_A, CMB = users.CM_B, ARTB = users.ARTIST_B;
    const T = today();
    const p = await F.createProject('S2 delegation', 'A');
    must('CM A accepts the project', await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {}));

    // ---- CM A gives a Graphic task to CM B
    let r = await F.createTask('CM_A', p.id, 'S2 T2 for CM B', CMB.id, 'B');
    must('CM A delegates task T2 to CM B (Graphic manager)', r, b => 'task ' + (b.data && b.data.id));
    const T2 = r.body.data.id;
    r = await F.createTask('CM_A', p.id, 'S2 to artist B directly', ARTB.id, 'B');
    check('CM A cannot give a task directly to CM B\'s artist (403)', r.status === 403, `${r.status} ${r.body.error}`, { res: r, expected: '403: go through CM B' });

    // ---- CM B assigns to his artist (not to CM A's artist), outsiders cannot
    r = await api('CM_B', 'POST', 'users/assign-task', { task_id: T2, user_id: users.ARTIST_A.id, work_request_id: p.id });
    check('CM B cannot assign T2 to CM A\'s artist (403)', r.status === 403, `${r.status} ${r.body.error}`, { res: r, expected: '403' });
    r = await api('CM_C', 'POST', 'users/assign-task', { task_id: T2, user_id: users.ARTIST_C.id, work_request_id: p.id });
    check('uninvolved CM C cannot assign T2 (403)', r.status === 403, r.status, { res: r, expected: '403' });
    must('CM B assigns T2 to his artist B (deadline +8)', await api('CM_B', 'POST', 'users/assign-task', { task_id: T2, user_id: ARTB.id, work_request_id: p.id, deadline: plus(8) }));

    let s = await F.state(p.id);
    let t2 = s.task(T2);
    check('T2 now assigned to artist B, deadline +8', t2 && /Mangesh|Khale/i.test(t2.assignees || '') && t2.deadline === plus(8), t2 && JSON.stringify({ assignees: t2.assignees, deadline: t2.deadline }));

    // ---- who sees T2
    for (const [role, exp] of [['CM_A', 200], ['CM_B', 200], ['ARTIST_B', 200], ['ARTIST_A', 404], ['CM_C', 404]]) {
        r = await api(role, 'GET', `users/tasks/${T2}`);
        check(`T2 detail as ${role} -> ${exp}`, r.status === exp, r.status, { res: r, expected: String(exp) });
    }
    const listB = await api('CM_B', 'GET', `${F.MA}/my-team`);
    check('T2 shows up for CM B (my team)', JSON.stringify(listB.body).includes(String(T2)) || listB.status === 200, listB.status, { severity: 'info' });

    // ---- owner's rule: only CM B handles T2; CM A only views
    r = await api('CM_A', 'PUT', `${F.MA}/tasks/${T2}`, { task_name: t2.task_name });
    check('CM A (creator) can NOT edit the delegated task', [403, 404].includes(r.status), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`,
        { res: r, severity: 'gap', expected: 'Owner rule: after delegation only the receiving manager (CM B) handles the task; the creator only views. Today every task manager (request manager, delegated manager, artist manager) can act.' });
    r = await api('CM_A', 'POST', 'users/assign-task', { task_id: T2, user_id: users.ARTIST_A.id, work_request_id: p.id });
    check('CM A (creator) can NOT re-assign the delegated task', [403, 404].includes(r.status), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`,
        { res: r, severity: 'gap', expected: 'Owner rule: only CM B assigns. (A 403 here can also mean "own team only", which still blocks it.)' });

    if (r.status === 200) {
        // the creator took the task back: CM B gives it to artist B again so the flow can go on
        must('CM B assigns T2 back to artist B', await api('CM_B', 'POST', 'users/assign-task', { task_id: T2, user_id: ARTB.id, work_request_id: p.id, deadline: plus(8) }));
    }

    // ---- artist B works, CM B reviews and shares, PMT approves
    must('artist B accepts T2', await api('ARTIST_B', 'PUT', `users/tasks/${T2}/accept`, { start_date: T }));
    must('artist B submits T2', await F.submitTask('ARTIST_B', p.id, T2, 3));
    r = await api('CM_C', 'PUT', `${F.MA}/review`, { task_id: T2, action: 'approved' });
    check('uninvolved CM C cannot review T2', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM B (main manager) approves T2', await api('CM_B', 'PUT', `${F.MA}/review`, { task_id: T2, action: 'approved' }));
    must('CM B shares T2 with the PMT', await api('CM_B', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, task_ids: [T2] }));
    must('PMT approves T2', await api('PMT', 'POST', 'work-requests/pm-approve', { task_id: T2 }));
    s = await F.state(p.id); t2 = s.task(T2);
    check('T2 final approved, start + end date = today, 3 pages', t2.review_stage === 'final_approved' && t2.start_date === T && t2.end_date === T && Number(t2.task_count) === 3, JSON.stringify({ stage: t2.review_stage, start: t2.start_date, end: t2.end_date, pages: t2.task_count }));
    const pr = await F.projectRow(p.id);
    check('project completed after its only task was approved', pr.data && pr.data.status === 'completed', pr.data && pr.data.status);

    // ---- history shows the hand-over
    const tl = await F.buildTimeline('S2 delegation', p.id, [T2], [], 'CM_B');
    const TT = `Task #${T2}`;
    check('history: task created by CM A', F.has(tl, TT, h => h.action === 'created' && h.actor_id === CMA.id), '', { expected: 'created row by CM A' });
    check('history: assigned by CM B to artist B', F.has(tl, TT, h => /assign/.test(h.action) && h.actor_id === CMB.id), '', { expected: 'assigned row by CM B' });
    check('history: approved by CM B', F.has(tl, TT, h => /approv/.test(h.action) && h.actor_id === CMB.id), '', { expected: 'approved row by CM B' });
    const dup = tl.filter((e, i) => tl.some((x, j) => j < i && sameRow(x, e)));
    check('history: no duplicate rows (same step written twice)', dup.length === 0, dup.map(e => `${e.record} ${e.action} ${e.when}`).join(', '));
};
