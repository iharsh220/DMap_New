const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('04-task-count-and-date-validations', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const artA = ctx.user('artistA');

    const projectName = `TEST_WF4_RULES_${Date.now()}`;
    let wrId = null;

    try {
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Rules',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Validate task_count >= 1, start_date & end_date mandatory, start <= end across tasks & changes',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'medium'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup validation project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        // ---- A. createTask deadline & task_count checks ----
        const badCreateDeadline = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Bad Deadline Task', request_type_id: meta.rtA,
            task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: '2026-02-31'
        });
        ctx.check('createTask rejects impossible deadline 2026-02-31 (400)', badCreateDeadline.status === 400, `HTTP ${badCreateDeadline.status}`);

        // Create Task 1 with PAST deadline to test acceptTask without start_date!
        const tPastRes = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Past Deadline Task', description: 'Test past deadline accept',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(-2)
        });
        const tPastId = tPastRes.body?.data?.id;
        ctx.check('createTask allows creating task with past deadline (or note behavior)', tPastRes.ok, `HTTP ${tPastRes.status}`);

        if (tPastId) {
            // Artist accepts WITHOUT start_date on past-deadline task!
            const accPastNoStart = await ctx.api('artistA', 'PUT', `users/tasks/${tPastId}/accept`, {});
            const linkedPast = await ctx.getLinkedProject('cmA', wrId);
            const tPastRow = (linkedPast.body?.data?.tasks || []).find(t => t.id === tPastId);
            ctx.check(
                'Task accepted without start_date when deadline is in past still gets a start_date (not NULL)',
                accPastNoStart.ok && !!tPastRow?.start_date,
                `HTTP ${accPastNoStart.status} status=${tPastRow?.status} start_date=${tPastRow?.start_date}`,
                {
                    severity: 'High',
                    area: 'Task Start/End Date Validation',
                    expected: 'Every accepted/completed task must have a valid start_date; if acceptTask is called without start_date on a task whose deadline is in the past, start_date must still be populated (e.g. today) or required.',
                    actual: `acceptTask succeeded (HTTP ${accPastNoStart.status}) with start_date=${tPastRow?.start_date} (NULL).`,
                    rootCause: 'controller/userController/userController.js (acceptTask lines 1207-1225): when isDeadlineTodayOrFuture is false and start_date is omitted, neither branch sets updateData.start_date.'
                }
            );

            // Now try submitting that task without start_date -> if start_date was NULL, does submitTask complete it with start_date=NULL?!
            const subPastNoStart = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
                task_id: tPastId, work_request_id: wrId, task_count: 2
            }));
            const linkedPastAfterSub = await ctx.getLinkedProject('cmA', wrId);
            const tPastAfterSub = (linkedPastAfterSub.body?.data?.tasks || []).find(t => t.id === tPastId);
            ctx.check(
                'Completed task must NEVER have start_date=NULL',
                tPastAfterSub?.status !== 'completed' || (!!tPastAfterSub?.start_date && !!tPastAfterSub?.end_date),
                `HTTP ${subPastNoStart.status} status=${tPastAfterSub?.status} start_date=${tPastAfterSub?.start_date} end_date=${tPastAfterSub?.end_date}`,
                {
                    severity: 'High',
                    area: 'Task Start/End Date Validation',
                    expected: 'A task must not be completed without both start_date and end_date.',
                    actual: `submitTask completed task #${tPastId} with start_date=null and end_date=${tPastAfterSub?.end_date}.`,
                    rootCause: 'controller/userController/userController.js (submitTask lines 1442-1453) only checks providedStartDate if truthy, allowing completion when both task.start_date and req.body.start_date are null.'
                }
            );
        }

        // ---- B. Main Task for thorough task_count & date negative tests ----
        const t1Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Validation Task', description: 'Main validation task',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(10)
        });
        const t1Id = t1Res.body?.data?.id;

        // updateTask impossible deadline check (2026-02-31)
        const badUpdateDeadline = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/tasks/${t1Id}`, {
            deadline: '2026-02-31'
        });
        ctx.check(
            'PUT /manager/assigned-work-requests/tasks/:id rejects impossible deadline 2026-02-31 with 400 (not 500)',
            badUpdateDeadline.status === 400,
            `HTTP ${badUpdateDeadline.status} ${JSON.stringify(badUpdateDeadline.body)}`,
            {
                severity: 'Medium',
                area: 'Date Validation (updateTask)',
                expected: 'Invalid calendar dates like 2026-02-31 should be rejected with HTTP 400.',
                actual: `PUT /manager/assigned-work-requests/tasks/${t1Id} returned HTTP ${badUpdateDeadline.status} (${JSON.stringify(badUpdateDeadline.body)}).`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (updateTask lines 3518-3533) checks day <= 31 and new Date("2026-02-31"), which JS silently rolls over to March 3, causing a DB error (500) instead of 400.'
            }
        );

        // acceptTask negative date checks
        for (const [bad, label] of [['abc', 'text'], ['2026-02-31', 'impossible date'], [plusDays(-1), 'yesterday']]) {
            const r = await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: bad });
            ctx.check(`Task accept rejects ${label} start_date -> 400`, r.status === 400, `HTTP ${r.status}`);
        }

        // Accept with future start_date (+2 days) -> accepted; trying to submit today must fail!
        const accFut = await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: plusDays(2) });
        ctx.check('Task accept with future start_date (+2d) -> accepted', accFut.ok && accFut.body?.data?.status === 'accepted', `HTTP ${accFut.status}`);

        const subEarlyFail = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
            task_id: t1Id, work_request_id: wrId, task_count: 2
        }));
        ctx.check('Task submit today when start_date is +2d -> 400 (start > end)', subEarlyFail.status === 400, `HTTP ${subEarlyFail.status} ${subEarlyFail.body?.error}`);

        // Reset task start_date by reassigning to Artist A and accepting with today's start_date
        await ctx.api('cmA', 'POST', 'users/assign-task', { task_id: t1Id, user_id: artA.id, work_request_id: wrId });
        const accToday = await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        ctx.check('Task accept with today start_date -> in_progress', accToday.ok && accToday.body?.data?.status === 'in_progress', `HTTP ${accToday.status}`);

        // task_count negative checks on submitTask
        for (const [badCount, label] of [[undefined, 'missing'], ['', 'empty'], ['0', '"0"'], [0, '0'], ['-2', 'negative'], ['2.5', 'decimal'], ['abc', 'non-numeric'], ['100001', '>100000']]) {
            const payload = { task_id: t1Id, work_request_id: wrId, link: 'https://example.com' };
            if (badCount !== undefined) payload.task_count = badCount;
            const r = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm(payload));
            ctx.check(`Task submit rejects ${label} task_count -> 400`, r.status === 400, `HTTP ${r.status}`);
        }

        // Date negative checks on submitTask
        for (const [body, label] of [
            [{ end_date: plusDays(1) }, 'future end_date'],
            [{ end_date: plusDays(-1) }, 'end_date before stored start_date'],
            [{ start_date: todayIst(), end_date: plusDays(-1) }, 'explicit start_date after end_date'],
            [{ start_date: plusDays(-1), end_date: plusDays(-2) }, 'past start_date after end_date'],
            [{ start_date: '2026-02-31' }, 'impossible start_date'],
            [{ end_date: '2026-02-31' }, 'impossible end_date'],
            [{ end_date: 'not-a-date' }, 'invalid end_date']
        ]) {
            const r = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
                task_id: t1Id, work_request_id: wrId, task_count: 2, ...body
            }));
            ctx.check(`Task submit rejects ${label} -> 400`, r.status === 400, `HTTP ${r.status} ${r.body?.error}`);
        }

        // Complete All negative check: create another pending task T2 (task_count = 0), call complete-all -> must 400!
        const t2Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Zero Pages Task', description: 'For complete-all guard',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(10)
        });
        const t2Id = t2Res.body?.data?.id;
        const completeAllFail = await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/complete', { work_request_id: wrId });
        ctx.check('Complete-all refuses when any task has 0 pages (400)', completeAllFail.status === 400, `HTTP ${completeAllFail.status} ${completeAllFail.body?.error}`);

        // Delete T2 so T1 can proceed cleanly
        if (t2Id) await ctx.api('cmA', 'DELETE', `manager/assigned-work-requests/tasks/${t2Id}`);

        // Valid submit of T1
        const validSubT1 = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
            task_id: t1Id, work_request_id: wrId, task_count: 3, start_date: plusDays(-2), end_date: plusDays(-1)
        }, { documents: 't1_ok.txt' }));
        ctx.check('Task submit succeeds with valid start_date <= end_date <= today and task_count=3', validSubT1.ok, `HTTP ${validSubT1.status}`);

        // Admin edit negative checks on T1 (completed task)
        const editGet = await ctx.api('cmA', 'GET', `datatable/admin/edit/task/${t1Id}`);
        const baseTask = editGet.body?.record || {};
        for (const [patch, label] of [
            [{ end_date: '' }, 'completed without end_date'],
            [{ start_date: '' }, 'completed without start_date'],
            [{ start_date: todayIst(), end_date: plusDays(-2) }, 'start_date after end_date'],
            [{ task_count: 0 }, 'completed with 0 pages'],
            [{ status: 'in_progress' }, 'open task with end_date still set'],
            [{ deadline: '2026-02-31' }, 'impossible deadline']
        ]) {
            const r = await ctx.api('cmA', 'PUT', `datatable/admin/edit/task/${t1Id}`, { ...baseTask, ...patch });
            ctx.check(`Admin edit task rejects ${label} -> 400`, r.status === 400, `HTTP ${r.status} ${r.body?.error}`);
        }

        // Manager approves & shares T1
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id] });

        // ---- C. New Change creation date validations (pm-reject & issue-register) ----
        const badRejDates = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id, start_date: plusDays(5), end_date: plusDays(2), issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check('pm-reject rejects start_date > end_date -> 400', badRejDates.status === 400, `HTTP ${badRejDates.status}`);

        const badIrDates = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t1Id, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
            start_date: plusDays(5), end_date: plusDays(2), issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check('issue-register/assignment rejects start_date > end_date -> 400', badIrDates.status === 400, `HTTP ${badIrDates.status}`);

        const badIrDeadline = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t1Id, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
            deadline: '2026-02-31', issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check(
            'issue-register/assignment rejects impossible deadline 2026-02-31 with 400 (not 500)',
            badIrDeadline.status === 400,
            `HTTP ${badIrDeadline.status} ${JSON.stringify(badIrDeadline.body)}`,
            {
                severity: 'Medium',
                area: 'Date Validation (Changes / Issue Creation)',
                expected: 'Invalid calendar deadline 2026-02-31 should return HTTP 400 with a clear error message.',
                actual: `POST /issue-register/assignment returned HTTP ${badIrDeadline.status} (${JSON.stringify(badIrDeadline.body)}).`,
                rootCause: 'controller/issueRegisterController/issueRegisterController.js (createIssueAssignment lines 133, 240) validates start_date/end_date via parseDateRange but passes deadline straight to IssueAssignments.create without parseDateOnly.'
            }
        );

        // Create valid V2 WITH stored task_count = 3 to prove submitIssue still requires artist to send task_count!
        const createV2 = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t1Id, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
            description: 'Validate issue task_count & dates', task_count: 3, issue_register_ids: [meta.issueRegisterId]
        });
        const v2Id = createV2.body?.data?.id;
        ctx.check('Create V2 for issue validation', createV2.status === 201 && !!v2Id, `HTTP ${createV2.status}`);

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', { issue_assignment_id: v2Id, user_id: artA.id });

        // acceptIssue negative date checks
        for (const [bad, label] of [['abc', 'text'], ['2026-02-31', 'impossible date'], [plusDays(-1), 'yesterday']]) {
            const r = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/accept`, { start_date: bad });
            ctx.check(`Issue accept rejects ${label} start_date -> 400`, r.status === 400, `HTTP ${r.status}`);
        }

        // Accept with future start_date (+3d) -> u_accepted, then test early submit
        const accV2Fut = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/accept`, { start_date: plusDays(3) });
        ctx.check('Issue accept with future start (+3d) -> u_accepted', accV2Fut.ok && accV2Fut.body?.data?.status === 'u_accepted', `HTTP ${accV2Fut.status}`);

        // Test submitIssue with bad task_count (even though stored task_count=3!)
        for (const [badCount, label] of [[undefined, 'missing (despite stored=3)'], ['', 'empty'], ['0', '"0"'], [0, '0'], ['-1', 'negative'], ['1.5', 'decimal'], ['xyz', 'text'], ['100001', '>100000']]) {
            const payload = { link: 'https://example.com' };
            if (badCount !== undefined) payload.task_count = badCount;
            const r = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm(payload));
            ctx.check(`Issue submit rejects ${label} task_count -> 400`, r.status === 400, `HTTP ${r.status}`);
        }

        // Test submitIssue date negative checks
        for (const [body, label] of [
            [{ end_date: plusDays(1) }, 'future end_date'],
            [{ start_date: todayIst(), end_date: plusDays(-1) }, 'explicit start_date > end_date'],
            [{ start_date: plusDays(-1), end_date: plusDays(-2) }, 'past start_date > end_date'],
            [{ start_date: '2026-02-31' }, 'impossible start_date'],
            [{ end_date: '2026-02-31' }, 'impossible end_date']
        ]) {
            const r = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm({ task_count: 2, ...body }));
            ctx.check(`Issue submit rejects ${label} -> 400`, r.status === 400, `HTTP ${r.status} ${r.body?.error}`);
        }

        // Valid early submit on u_accepted issue: future start moves to end_date (today)
        const validSubV2 = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm({
            task_count: 2, link: 'https://example.com/v2'
        }, { documents: 'v2_ok.txt' }));
        ctx.check('Issue submit succeeds with task_count=2', validSubV2.ok, `HTTP ${validSubV2.status}`);

        const linkedV2 = await ctx.getLinkedProject('cmA', wrId);
        const v2Row = (linkedV2.body?.data?.tasks || []).find(t => t.id === t1Id)?.changes?.find(c => c.id === v2Id);
        ctx.check('Completed issue has start_date <= end_date and task_count=2',
            v2Row?.status === 'completed' && !!v2Row.start_date && !!v2Row.end_date && v2Row.start_date <= v2Row.end_date && Number(v2Row.task_count) === 2,
            JSON.stringify({ status: v2Row?.status, start: v2Row?.start_date, end: v2Row?.end_date, count: v2Row?.task_count }));

        // Admin edit negative checks on V2 (completed issue)
        const editIssGet = await ctx.api('cmA', 'GET', `datatable/admin/edit/issue/${v2Id}`);
        const baseIssue = editIssGet.body?.record || {};
        for (const [patch, label] of [
            [{ end_date: '' }, 'completed without end_date'],
            [{ start_date: '' }, 'completed without start_date'],
            [{ start_date: todayIst(), end_date: plusDays(-2) }, 'start_date after end_date'],
            [{ task_count: 0 }, 'completed with 0 pages'],
            [{ status: 'in_progress' }, 'open change with end_date still set']
        ]) {
            const r = await ctx.api('cmA', 'PUT', `datatable/admin/edit/issue/${v2Id}`, { ...baseIssue, ...patch });
            ctx.check(`Admin edit issue rejects ${label} -> 400`, r.status === 400, `HTTP ${r.status} ${r.body?.error}`);
        }
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
