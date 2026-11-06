// S1: PMT request -> CM accepts -> task to artist -> artist accepts + submits -> CM rework -> resubmit
// -> CM approves -> shares with PMT -> PMT gives changes (V2) -> CM accepts V2, assigns artist ->
// artist submits -> CM approves + shares -> PMT gives changes again (V3) -> same cycle -> PMT approves
// -> task final approved, project completed. Every step's date and history is checked.
const { api, users, check, must, today, plus, ok } = require('../lib');
const F = require('../flow');
// two history rows describing the same step (same record, second, action, change, actor, item, comment)
const sameRow = (a, b) => ['action', 'previous_status', 'new_status', 'previous_review_stage', 'new_review_stage', 'actor_id', 'related_task_id', 'related_issue_id', 'comments'].every(k => String(a.raw[k]) === String(b.raw[k])) && a.record === b.record && a.when === b.when;

module.exports = async function fullFlow() {
    const PMT = users.PMT, CMA = users.CM_A, ARTA = users.ARTIST_A;
    const p = await F.createProject('S1 full flow', 'A');
    const T = today();

    // the project as the PMT sees it
    let pr = await F.projectRow(p.id);
    check('new project is pending, requested_at is set', pr.data && pr.data.status === 'pending' && !!pr.data.requested_at, pr.data && `${pr.data.status} requested_at=${pr.data.requested_at}`, { expected: 'status pending + requested_at' });

    // ---- 1. manager accepts (another vertical's manager cannot)
    let r = await api('CM_C', 'PUT', `${F.MA}/${p.id}/accept`, {});
    check('manager of another vertical (CM C) cannot accept', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM A accepts the project', await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {}));
    r = await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {});
    check('accepting twice is refused (400)', r.status === 400, r.status, { res: r, expected: '400' });

    // ---- 2. task for the artist
    r = await F.createTask('CM_A', p.id, 'S1 T1', ARTA.id);
    must('CM A creates task T1 for artist A', r, b => 'task ' + (b.data && b.data.id));
    const T1 = r.body.data.id;
    r = await F.createTask('CM_A', p.id, 'S1 bad date', ARTA.id, 'A', { deadline: '2026-02-31' });
    check('impossible deadline 2026-02-31 is refused (400)', r.status === 400, `${r.status} ${r.body.error}`, { res: r, expected: '400' });
    r = await F.createTask('CM_A', p.id, 'S1 wrong artist', users.ARTIST_C.id);
    check('CM A cannot give a task directly to another vertical\'s artist (403)', r.status === 403, `${r.status} ${r.body.error}`, { res: r, expected: '403' });

    let s = await F.state(p.id);
    let t1 = s.task(T1);
    check('T1: pending, deadline +7 days, no start / end date yet', t1 && t1.status === 'pending' && t1.deadline === plus(7) && !t1.start_date && !t1.end_date, t1 && JSON.stringify({ status: t1.status, deadline: t1.deadline, start: t1.start_date, end: t1.end_date }));

    // ---- 3. visibility of T1
    for (const [role, exp] of [['ARTIST_A', 200], ['CM_A', 200], ['ARTIST_B', 404], ['CM_C', 404]]) {
        r = await api(role, 'GET', `users/tasks/${T1}`);
        check(`T1 detail as ${role} -> ${exp}`, r.status === exp, r.status, { res: r, expected: String(exp) });
    }

    // ---- 4. artist accepts and submits
    r = await api('ARTIST_B', 'PUT', `users/tasks/${T1}/accept`, { start_date: T });
    check('another artist cannot accept T1', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('artist A accepts T1 (start today)', await api('ARTIST_A', 'PUT', `users/tasks/${T1}/accept`, { start_date: T }));
    s = await F.state(p.id); t1 = s.task(T1);
    check('T1 after accept: in progress, start date = today', t1.status === 'in_progress' && t1.start_date === T, JSON.stringify({ status: t1.status, start: t1.start_date }), { expected: 'in_progress, start today' });
    r = await F.submitTask('ARTIST_A', p.id, T1, 0);
    check('submit with 0 pages is refused (400)', r.status === 400, `${r.status} ${r.body.error}`, { res: r, expected: '400' });
    must('artist A submits T1 (2 pages, link, file)', await F.submitTask('ARTIST_A', p.id, T1, 2));
    s = await F.state(p.id); t1 = s.task(T1);
    check('T1 after submit: completed, end date = today, 2 pages, waiting for manager review', t1.status === 'completed' && t1.end_date === T && Number(t1.task_count) === 2 && t1.review_stage === 'manager_review', JSON.stringify({ status: t1.status, end: t1.end_date, pages: t1.task_count, stage: t1.review_stage }));

    // ---- 5. manager rework, resubmit, approve, share
    must('CM A sends T1 back for rework (change_request)', await api('CM_A', 'PUT', `${F.MA}/review`, { task_id: T1, action: 'change_request', comments: 'UAT e2e: please rework' }));
    s = await F.state(p.id); t1 = s.task(T1);
    check('T1 after rework request: back with the artist (not completed)', t1.status !== 'completed', JSON.stringify({ status: t1.status, stage: t1.review_stage, end: t1.end_date }), { expected: 'status not completed' });
    check('T1 after rework request: end date cleared', !t1.end_date, `end_date=${t1.end_date}`, { expected: 'end date empty while the artist reworks', severity: 'bug' });
    must('artist A resubmits T1', await F.submitTask('ARTIST_A', p.id, T1, 2));
    must('CM A approves T1', await api('CM_A', 'PUT', `${F.MA}/review`, { task_id: T1, action: 'approved' }));
    r = await api('CM_C', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, task_ids: [T1] });
    check('uninvolved manager cannot share T1 (403)', r.status === 403, r.status, { res: r, expected: '403' });
    must('CM A shares T1 with the PMT', await api('CM_A', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, task_ids: [T1] }));
    s = await F.state(p.id); t1 = s.task(T1);
    check('T1 after share: waiting for PMT review (pm_review)', t1.review_stage === 'pm_review', t1.review_stage, { expected: 'pm_review' });

    // ---- 6. PMT gives changes (V2)
    const changeType = await F.changeTypeFor(T1);
    check('PMT gets the change types of T1', !!changeType, changeType);
    r = await api('ARTIST_A', 'POST', 'work-requests/pm-reject', { task_id: T1, comments: 'x', issue_description: 'x', issue_register_ids: [changeType] });
    check('artist cannot give changes (403)', r.status === 403, r.status, { res: r, expected: '403' });
    must('PMT gives changes on T1 (V2)', await api('PMT', 'POST', 'work-requests/pm-reject', { task_id: T1, comments: 'UAT e2e: change the banner', issue_description: 'UAT e2e change V2', issue_register_ids: [changeType], deadline: plus(5) }));
    s = await F.state(p.id); t1 = s.task(T1);
    const V2 = t1 && t1.changes.length ? t1.changes[t1.changes.length - 1].id : null;
    check('V2 created on T1, waiting for the manager (m_pending)', V2 && s.change(V2).status === 'm_pending' && s.change(V2).version === 'V2', V2 && JSON.stringify(s.change(V2)), { expected: 'change V2 m_pending' });
    if (!V2) throw new Error('Stopped: no V2');
    log(`V2 = change #${V2}`);

    // ---- 7. change cycle V2
    r = await api('CM_C', 'PUT', `${F.MA}/issue/${V2}/accept`, {});
    check('uninvolved manager cannot accept V2', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM A accepts V2', await api('CM_A', 'PUT', `${F.MA}/issue/${V2}/accept`, {}));
    must('CM A assigns V2 to artist A', await api('CM_A', 'POST', `${F.MA}/assign-issue-to-user`, { issue_assignment_id: V2, user_id: ARTA.id, deadline: plus(5) }));
    must('artist A accepts V2', await api('ARTIST_A', 'PUT', `users/issues/${V2}/accept`, { start_date: T }));
    s = await F.state(p.id);
    check('V2 after accept: in progress, start today, deadline +5', s.change(V2).status === 'in_progress' && s.change(V2).start_date === T && s.change(V2).deadline === plus(5), JSON.stringify(s.change(V2)));
    must('artist A submits V2 (1 page)', await F.submitChange('ARTIST_A', V2, 1));
    must('CM A approves V2', await api('CM_A', 'PUT', `${F.MA}/review`, { issue_id: V2, action: 'approved' }));
    must('CM A shares V2', await api('CM_A', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, issue_ids: [V2] }));
    s = await F.state(p.id);
    check('V2 after share: completed, end today, pm_review', s.change(V2).status === 'completed' && s.change(V2).end_date === T && s.change(V2).review_stage === 'pm_review', JSON.stringify(s.change(V2)));

    // ---- 8. PMT gives changes again on V2 (V3), full cycle, PMT approves V3
    must('PMT gives changes again (V3 on V2)', await api('PMT', 'POST', 'work-requests/pm-reject', { issue_id: V2, comments: 'UAT e2e: one more change', issue_description: 'UAT e2e change V3', issue_register_ids: [changeType], deadline: plus(6) }));
    s = await F.state(p.id); t1 = s.task(T1);
    const V3 = t1.changes.length ? t1.changes[t1.changes.length - 1].id : null;
    check('V3 created (m_pending)', V3 && V3 !== V2 && s.change(V3).status === 'm_pending' && s.change(V3).version === 'V3', V3 && JSON.stringify(s.change(V3)));
    if (!V3 || V3 === V2) throw new Error('Stopped: no V3');
    must('CM A accepts V3', await api('CM_A', 'PUT', `${F.MA}/issue/${V3}/accept`, {}));
    must('CM A assigns V3 to artist A', await api('CM_A', 'POST', `${F.MA}/assign-issue-to-user`, { issue_assignment_id: V3, user_id: ARTA.id, deadline: plus(6) }));
    must('artist A accepts V3', await api('ARTIST_A', 'PUT', `users/issues/${V3}/accept`, { start_date: T }));
    must('artist A submits V3', await F.submitChange('ARTIST_A', V3, 1));
    must('CM A approves V3', await api('CM_A', 'PUT', `${F.MA}/review`, { issue_id: V3, action: 'approved' }));
    must('CM A shares V3', await api('CM_A', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, issue_ids: [V3] }));
    r = await api('ARTIST_A', 'POST', 'work-requests/pm-approve', { issue_id: V3 });
    check('artist cannot PM-approve (403)', r.status === 403, r.status, { res: r, expected: '403' });
    must('PMT approves V3', await api('PMT', 'POST', 'work-requests/pm-approve', { issue_id: V3 }));

    // ---- 9. final state
    s = await F.state(p.id); t1 = s.task(T1);
    check('V3 final approved', s.change(V3).review_stage === 'final_approved', s.change(V3).review_stage);
    check('T1 final approved and completed, end date kept', t1.status === 'completed' && t1.review_stage === 'final_approved' && !!t1.end_date, JSON.stringify({ status: t1.status, stage: t1.review_stage, end: t1.end_date }));
    check('V2 still completed (it was replaced by V3)', s.change(V2).status === 'completed', JSON.stringify(s.change(V2)));
    pr = await F.projectRow(p.id);
    check('project completed automatically after the last approval', pr.data && pr.data.status === 'completed', pr.data && pr.data.status, { expected: 'completed' });

    // ---- 10. history: every step recorded with time and actor
    const tl = await F.buildTimeline('S1 full flow', p.id, [T1], [V2, V3]);
    const P = `Project #${p.id}`, TT = `Task #${T1}`;
    const steps = [
        ['project: created by PMT', F.has(tl, P, h => /creat/.test(h.action))],
        ['project: manager accepted (with time)', F.has(tl, P, h => h.action === 'manager_accepted' && !!h.created_at)],
        ['project: auto completed', F.has(tl, P, h => /complet/.test(h.action))],
        ['task: created', F.has(tl, TT, h => h.action === 'created')],
        ['task: artist accepted (→ in_progress / accepted)', F.has(tl, TT, h => ['in_progress', 'accepted'].includes(h.new_status) && h.previous_status !== h.new_status)],
        ['task: submitted (→ completed) twice', tl.filter(e => e.record === TT && e.raw.new_status === 'completed' && e.raw.previous_status !== 'completed').length >= 2],
        ['task: manager rework request', F.has(tl, TT, h => /change_request|rework/.test(h.action) || h.new_review === 'change_request')],
        ['task: manager approved', F.has(tl, TT, h => /approv/.test(h.action) && h.actor_id === CMA.id)],
        ['task: shared with PMT', F.has(tl, TT, h => /shared/.test(h.action))],
        ['task: PMT gave changes', F.has(tl, TT, h => /pm_rejected|change_request_created|pm_change/.test(h.action))],
        ['task: final approved', F.has(tl, TT, h => h.new_review_stage === 'final_approved')],
        [`V2: created, accepted, assigned, started, submitted, approved, shared`, ['created', 'accept', 'assign'].every(k => F.has(tl, `Change #${V2}`, h => h.action.includes(k))) && F.has(tl, `Change #${V2}`, h => h.new_status === 'completed')],
        [`V3: PMT approved`, F.has(tl, `Change #${V3}`, h => /pm_approved/.test(h.action) || h.new_review_stage === 'final_approved')]
    ];
    for (const [name, okStep] of steps) check(`history has: ${name}`, okStep, '', { expected: 'a history row for this step' });
    const bare = tl.filter(e => /manager_approved|shared_for_client_review|manager_change_requested/.test(e.action) && !e.raw.new_status && !e.raw.new_review_stage);
    check('manager approve / rework / share rows record the status and review stage change', bare.length === 0, bare.map(e => `${e.record} ${e.action}`).join(', '),
        { severity: 'gap', expected: 'previous/new status and review stage on these rows, like the other history rows (today only the action, actor and time are stored)' });
    const dup = tl.filter((e, i) => tl.some((x, j) => j < i && sameRow(x, e)));
    check('no duplicate history rows', dup.length === 0, dup.map(e => `${e.record} ${e.action} ${e.when}`).join(', '), { expected: 'each step written once' });
    const noActor = tl.filter(e => !e.raw.actor_id && !e.raw.actor_name);
    check('every history row has who did it', noActor.length === 0, noActor.map(e => `${e.record} ${e.action}`).join(', '), { expected: 'actor on every row' });
    const noTime = tl.filter(e => !e.raw.created_at);
    check('every history row has a time', noTime.length === 0, noTime.length);
};

function log(msg) { console.log('     ' + msg); }
