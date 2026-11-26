const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('05-completion-and-reopen', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const artA = ctx.user('artistA');

    const projectName = `TEST_WF5_REOPEN_${Date.now()}`;
    let wrId = null;

    try {
        // 1. Setup project with 2 tasks -> complete both -> project becomes completed
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Reopen',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Test completion guard and re-open after completion',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'medium'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup reopen project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        const mkTask = async (name) => {
            const r = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
                work_request_id: wrId, task_name: name, description: name,
                request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(7)
            });
            return r.body?.data?.id;
        };

        const t1Id = await mkTask('Task 1');
        const t2Id = await mkTask('Task 2');
        ctx.check('Created T1 and T2', !!t1Id && !!t2Id, `T1=${t1Id} T2=${t2Id}`);

        // Complete & share both T1 and T2
        for (const tid of [t1Id, t2Id]) {
            await ctx.api('artistA', 'PUT', `users/tasks/${tid}/accept`, { start_date: todayIst() });
            await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: tid, work_request_id: wrId, task_count: 2 }, { documents: `t${tid}.txt` }));
            await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: tid, action: 'approved' });
        }
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id, t2Id] });

        // Approve T1 -> project MUST NOT complete yet
        const appT1 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check('Project stays non-completed while T2 is pending approval', appT1.ok && appT1.body?.work_request_completed === false, `completed=${appT1.body?.work_request_completed}`);

        // Approve T2 -> project auto-completes!
        const appT2 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t2Id });
        ctx.check('Project auto-completes once T1 and T2 are both approved', appT2.ok && appT2.body?.work_request_completed === true, `completed=${appT2.body?.work_request_completed}`);

        // 2. RE-OPEN BY CREATING A NEW TASK AFTER PROJECT COMPLETED
        // User requirement: "but if after project completed if koi manager fir se task banata hai to project in_progress ho jayega fir se"
        const t3Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Task 3 After Completion', description: 'Additional work after completion',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(10)
        });
        const t3Id = t3Res.body?.data?.id;
        ctx.check('Manager creates T3 on completed project', t3Res.ok && !!t3Id, `HTTP ${t3Res.status} T3=${t3Id}`);

        const linkedAfterT3 = await ctx.getLinkedProject('cmA', wrId);
        const statusAfterT3Create = linkedAfterT3.body?.data?.project?.status;
        ctx.check('Completed project is no longer completed after creating T3', statusAfterT3Create !== 'completed', `status=${statusAfterT3Create}`);
        ctx.check(
            'Completed project becomes in_progress when manager creates a new task (user business rule)',
            statusAfterT3Create === 'in_progress',
            `status=${statusAfterT3Create}`,
            {
                severity: 'High',
                area: 'Project Re-open Status (completed -> in_progress)',
                expected: 'When a manager creates a new task after a project is completed, the project status should become "in_progress" again.',
                actual: `createTask set work_requests.status to "${statusAfterT3Create}" instead of "in_progress".`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (createTask line 1968) updates WorkRequests to { status: "accepted" } instead of "in_progress" (and acceptTask does not move it to in_progress either).'
            }
        );

        // Artist accepts & starts T3 -> check work_requests status!
        await ctx.api('artistA', 'PUT', `users/tasks/${t3Id}/accept`, { start_date: todayIst() });
        const linkedAfterT3Start = await ctx.getLinkedProject('cmA', wrId);
        const statusAfterT3Start = linkedAfterT3Start.body?.data?.project?.status;
        ctx.check(
            'Project status is in_progress after reopened task T3 is accepted/started by artist',
            statusAfterT3Start === 'in_progress',
            `status=${statusAfterT3Start}`,
            {
                severity: 'Medium',
                area: 'Project Re-open Status',
                expected: 'Once the reopened task starts (task status = in_progress), the work request status should be in_progress.',
                actual: `work_requests.status stayed "${statusAfterT3Start}" after T3 started.`,
                rootCause: 'controller/userController/userController.js (acceptTask) does not transition WorkRequests from accepted to in_progress when a task starts immediately.'
            }
        );

        // Cannot force project completed in admin while T3 is open!
        const adminEditGet = await ctx.api('cmA', 'GET', `datatable/admin/edit/project/${wrId}`);
        const projEditBase = adminEditGet.body?.record || {};
        const forceCompleteFail = await ctx.api('cmA', 'PUT', `datatable/admin/edit/project/${wrId}`, {
            ...projEditBase, status: 'completed'
        });
        ctx.check('Admin edit blocks marking project completed while T3 is open (400)', forceCompleteFail.status === 400, `HTTP ${forceCompleteFail.status}`);

        // Finish T3 -> project auto-completes again!
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t3Id, work_request_id: wrId, task_count: 1 }, { documents: 't3.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t3Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t3Id] });
        const appT3 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t3Id });
        ctx.check('Project auto-completes again after T3 is approved', appT3.ok && appT3.body?.work_request_completed === true, `completed=${appT3.body?.work_request_completed}`);

        // 3. RE-OPEN BY RAISING A CHANGE AFTER PROJECT COMPLETED
        // 3a. Via POST /issue-register/assignment
        const irReopen = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t3Id, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
            description: 'Change raised after completion', issue_register_ids: [meta.issueRegisterId]
        });
        const v2Id = irReopen.body?.data?.id;
        const linkedAfterIr = await ctx.getLinkedProject('cmA', wrId);
        const statusAfterIr = linkedAfterIr.body?.data?.project?.status;
        ctx.check('Raising change via issue-register/assignment reopens completed project', irReopen.status === 201 && statusAfterIr !== 'completed', `status=${statusAfterIr}`);

        // Finish V2 -> project completes again
        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', { issue_assignment_id: v2Id, user_id: artA.id });
        await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm({ task_count: 1 }, { documents: 'v2_reopen.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { issue_id: v2Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, issue_ids: [v2Id] });
        const appV2 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { issue_id: v2Id });
        ctx.check('Project completes again after post-completion change V2 is approved', appV2.ok && appV2.body?.data?.workRequestCompleted === true, `completed=${appV2.body?.data?.workRequestCompleted}`);

        // 3b. What if PMT calls POST /work-requests/pm-reject on a task of a COMPLETED project (T1 still has intimate_client=1)?
        const pmRejCompleted = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id, comments: 'Reject after project completed', issue_register_ids: [meta.issueRegisterId]
        });
        const linkedAfterPmRej = await ctx.getLinkedProject('cmA', wrId);
        const statusAfterPmRej = linkedAfterPmRej.body?.data?.project?.status;
        const t1AfterPmRej = (linkedAfterPmRej.body?.data?.tasks || []).find(t => t.id === t1Id);
        ctx.check(
            'If pm-reject runs on a completed project, project must reopen (not remain completed with open task/change)',
            !pmRejCompleted.ok || statusAfterPmRej !== 'completed',
            `pmReject HTTP=${pmRejCompleted.status} projectStatus=${statusAfterPmRej} taskStatus=${t1AfterPmRej?.status}`,
            {
                severity: 'High',
                area: 'Project Re-open / Data Integrity',
                expected: 'Either pm-reject is disallowed on an already final_approved/completed project, OR it reopens work_requests out of completed status so a completed project never holds open tasks/changes.',
                actual: `pm-reject succeeded (HTTP ${pmRejCompleted.status}), set task #${t1Id} back to "in_progress" and created an m_pending change, while work_requests.status stayed "completed".`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmRejectTask lines 2379-2472) checks only intimate_client === 1 and neither rejects final_approved items nor reopens a completed WorkRequest.'
            }
        );

        // Verify reopened history count
        const wrHist = await ctx.api('pmt', 'GET', `work-requests/history/${wrId}`);
        const reopenedCount = (wrHist.body?.data || []).filter(h => h.action === 'reopened').length;
        ctx.check('Work request history recorded reopened events', reopenedCount >= 2, `reopenedCount=${reopenedCount}`);
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
