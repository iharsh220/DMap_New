// S3 cancel project, S4 cancel a change, S5 delete task / project, S6 defer.
const { api, users, check, must, scenario, today, plus } = require('../lib');
const F = require('../flow');

// S3: project with a started task, a not-started task and a submitted task waiting for the PMT
async function cancelProject() {
    const ARTA = users.ARTIST_A;
    const T = today();
    const p = await F.createProject('S3 cancel project', 'A');
    must('CM A accepts', await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {}));
    const mk = async (n) => { const r = await F.createTask('CM_A', p.id, n, ARTA.id); must(`CM A creates ${n}`, r); return r.body.data.id; };
    const tStarted = await mk('S3 started'), tNotStarted = await mk('S3 not started'), tSubmitted = await mk('S3 submitted');
    must('artist accepts "started"', await api('ARTIST_A', 'PUT', `users/tasks/${tStarted}/accept`, { start_date: T }));
    must('artist accepts "submitted"', await api('ARTIST_A', 'PUT', `users/tasks/${tSubmitted}/accept`, { start_date: T }));
    must('artist submits "submitted"', await F.submitTask('ARTIST_A', p.id, tSubmitted, 2));
    must('CM A approves "submitted"', await api('CM_A', 'PUT', `${F.MA}/review`, { task_id: tSubmitted, action: 'approved' }));
    must('CM A shares "submitted"', await api('CM_A', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, task_ids: [tSubmitted] }));

    // preview
    let r = await api('CM_A', 'GET', `${F.MA}/${p.id}/cancel-preview`);
    const sum = r.body && r.body.data && r.body.data.summary;
    check('cancel preview: 1 started, 1 not started, 1 waiting for approval', r.status === 200 && sum && sum.tasks.in_progress === 1 && sum.tasks.not_started === 1 && sum.tasks.pending_approval === 1, `${r.status} ${JSON.stringify(sum)}`, { res: r });
    r = await api('CM_C', 'PUT', `${F.MA}/${p.id}/cancel`, { reason: 'UAT e2e: not my project' });
    check('another manager cannot cancel (404)', r.status === 404, r.status, { res: r, expected: '404' });
    r = await api('CM_A', 'PUT', `${F.MA}/${p.id}/cancel`, {});
    check('cancel without a reason is refused (400)', r.status === 400, `${r.status} ${r.body.error}`, { res: r, expected: '400' });
    must('CM A cancels the project with a reason', await api('CM_A', 'PUT', `${F.MA}/${p.id}/cancel`, { reason: 'UAT e2e: client stopped the campaign' }));

    const s = await F.state(p.id);
    const a = s.task(tStarted), b = s.task(tNotStarted), c = s.task(tSubmitted);
    check('project status cancelled', s.project.status === 'cancelled', s.project.status);
    check('started task: cancelled, start kept, end = today', a.status === 'cancelled' && a.start_date === T && a.end_date === T, JSON.stringify({ status: a.status, start: a.start_date, end: a.end_date }));
    check('not started task: cancelled, no dates', b.status === 'cancelled' && !b.start_date && !b.end_date, JSON.stringify({ status: b.status, start: b.start_date, end: b.end_date }));
    check('submitted task: unchanged (completed, pm_review)', c.status === 'completed' && c.review_stage === 'pm_review', JSON.stringify({ status: c.status, stage: c.review_stage }));

    // read-only
    for (const [name, call] of [
        ['artist submits a task', () => F.submitTask('ARTIST_A', p.id, tStarted, 2)],
        ['manager creates a task', () => F.createTask('CM_A', p.id, 'S3 after cancel', ARTA.id)],
        ['manager edits a task', () => api('CM_A', 'PUT', `${F.MA}/tasks/${tSubmitted}`, { task_name: 'x' })],
        ['PMT gives changes', async () => api('PMT', 'POST', 'work-requests/pm-reject', { task_id: tSubmitted, comments: 'x', issue_description: 'x', issue_register_ids: [await F.changeTypeFor(tSubmitted)] })]
    ]) {
        r = await call();
        check(`after cancel: ${name} is refused (400 read-only)`, r.status === 400 && /cancel/i.test(String(r.body.error)), `${r.status} ${r.body.error}`, { res: r, expected: '400 "This project is cancelled and read-only"' });
    }
    must('PMT can still approve the submitted task', await api('PMT', 'POST', 'work-requests/pm-approve', { task_id: tSubmitted }));
    const pr = await F.projectRow(p.id);
    check('project stays cancelled after that approval', pr.data && pr.data.status === 'cancelled', pr.data && pr.data.status);

    const tl = await F.buildTimeline('S3 cancel project', p.id, [tStarted, tNotStarted, tSubmitted], []);
    check('history: project cancelled with the reason', tl.some(e => e.record === `Project #${p.id}` && e.action === 'cancelled' && /client stopped/.test(e.raw.comments || '')), '', { expected: 'cancelled row with reason' });
    check('history: every changed task has a cancelled_with_project row', [tStarted, tNotStarted].every(id => tl.some(e => e.record === `Task #${id}` && e.action === 'cancelled_with_project')), '');
    check('history: submitted task flagged', tl.some(e => e.record === `Task #${tSubmitted}` && e.action === 'flagged_on_cancellation'), '');
}

// S4: the manager cancels a change; the task goes back to the PMT; the PMT approves; project completes
async function cancelChange() {
    const ARTA = users.ARTIST_A;
    const T = today();
    const p = await F.createProject('S4 cancel change', 'A');
    must('CM A accepts', await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {}));
    let r = await F.createTask('CM_A', p.id, 'S4 T', ARTA.id); must('CM A creates task', r);
    const t = r.body.data.id;
    must('artist accepts', await api('ARTIST_A', 'PUT', `users/tasks/${t}/accept`, { start_date: T }));
    must('artist submits', await F.submitTask('ARTIST_A', p.id, t, 2));
    must('CM A approves', await api('CM_A', 'PUT', `${F.MA}/review`, { task_id: t, action: 'approved' }));
    must('CM A shares', await api('CM_A', 'POST', `${F.MA}/share-for-client-review`, { work_request_id: p.id, task_ids: [t] }));
    must('PMT gives changes (V2)', await api('PMT', 'POST', 'work-requests/pm-reject', { task_id: t, comments: 'UAT e2e change', issue_description: 'UAT e2e', issue_register_ids: [await F.changeTypeFor(t)], deadline: plus(4) }));
    let s = await F.state(p.id);
    const v2 = s.task(t).changes.slice(-1)[0];
    check('V2 created', v2 && v2.status === 'm_pending', v2 && JSON.stringify(v2));
    if (!v2) throw new Error('Stopped: no V2');
    r = await api('CM_C', 'PUT', `${F.MA}/issue/${v2.id}/cancel`, {});
    check('uninvolved manager cannot cancel V2', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM A cancels V2', await api('CM_A', 'PUT', `${F.MA}/issue/${v2.id}/cancel`, { reason: 'UAT e2e: not needed' }));
    s = await F.state(p.id);
    check('V2 disappears from the live list (cancelled + deleted)', !s.change(v2.id), JSON.stringify(s.task(t).changes));
    check('task goes back to the PMT (pm_review)', s.task(t).review_stage === 'pm_review', s.task(t).review_stage);
    must('PMT approves the task', await api('PMT', 'POST', 'work-requests/pm-approve', { task_id: t }));
    const pr = await F.projectRow(p.id);
    check('project completed', pr.data && pr.data.status === 'completed', pr.data && pr.data.status);
    await F.buildTimeline('S4 cancel change', p.id, [t], [v2.id]);
}

// S5: delete a task, then delete the project
async function deleteFlow() {
    const p = await F.createProject('S5 delete', 'A');
    must('CM A accepts', await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {}));
    let r = await F.createTask('CM_A', p.id, 'S5 T keep', users.ARTIST_A.id); must('CM A creates task 1', r);
    const keep = r.body.data.id;
    r = await F.createTask('CM_A', p.id, 'S5 T delete', users.ARTIST_A.id); must('CM A creates task 2', r);
    const del = r.body.data.id;
    r = await api('CM_C', 'DELETE', `${F.MA}/tasks/${del}`);
    check('uninvolved manager cannot delete a task', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM A deletes task 2', await api('CM_A', 'DELETE', `${F.MA}/tasks/${del}`));
    let s = await F.state(p.id);
    check('deleted task is gone, the other stays', !s.task(del) && !!s.task(keep), JSON.stringify(s.tasks.map(t => t.id)));
    r = await api('ARTIST_A', 'GET', `users/tasks/${del}`);
    check('artist no longer sees the deleted task', [403, 404].includes(r.status), r.status, { res: r, expected: '404' });
    r = await api('CM_C', 'DELETE', `${F.MA}/${p.id}`);
    check('uninvolved manager cannot delete the project', [403, 404].includes(r.status), r.status, { res: r, expected: '403/404' });
    must('CM A deletes the project', await api('CM_A', 'DELETE', `${F.MA}/${p.id}`));
    r = await api('PMT', 'GET', `work-requests/${p.id}`);
    check('PMT no longer sees the deleted project', [403, 404].includes(r.status) || (r.body && r.body.data && r.body.data.is_deleted), r.status, { res: r, expected: '404' });
    const mine = await api('PMT', 'GET', 'work-requests/my-requests?limit=-1');
    check('deleted project is not in the PMT list', !JSON.stringify(mine.body).includes(`"id":${p.id},`), mine.status, { res: mine, expected: 'not listed' });
    r = await api('ARTIST_A', 'GET', `users/tasks/${keep}`);
    check('tasks of a deleted project are not visible to the artist', [403, 404].includes(r.status), r.status, { res: r, expected: '404' });
    const ph = await F.historyOf('project', p.id, 'PMT');
    check('history keeps a "deleted" row', ph.rows.some(h => h.action === 'deleted') || ph.status === 404, `${ph.status} ${ph.rows.map(h => h.action).join(',')}`, { severity: 'info' });
}

// S6: defer (insufficient details), the PMT edits, the manager accepts
async function deferFlow() {
    const p = await F.createProject('S6 defer', 'A');
    let r = await api('CM_A', 'PUT', `${F.MA}/${p.id}/defer`, { reason: 'insufficient_details', message: 'UAT e2e: please add the brief' });
    must('CM A defers the project (insufficient details)', r);
    let pr = await F.projectRow(p.id);
    // by design: "insufficient details" keeps the project pending (status 'deferred' is commented out in
    // deferWorkRequest); the deferral and the message are stored and the PMT is emailed
    check('project stays pending (insufficient details = ask the PMT, by design)', pr.data && pr.data.status === 'pending', pr.data && pr.data.status, { severity: 'info' });
    r = await api('CM_A', 'PUT', `${F.MA}/${p.id}/accept`, {});
    check('a deferred project can be accepted after the details are added', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`, { res: r, severity: 'info' });
    const tl = await F.buildTimeline('S6 defer', p.id, [], []);
    check('history: deferred with the message', tl.some(e => /defer/.test(e.action)), tl.map(e => e.action).join(','));
}

module.exports = { cancelProject, cancelChange, deleteFlow, deferFlow };
