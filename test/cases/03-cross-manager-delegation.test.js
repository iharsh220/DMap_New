const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('03-cross-manager-delegation', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const cmA = ctx.user('cmA');
    const artA = ctx.user('artistA');
    const cmB = ctx.user('cmB');
    const artB = ctx.user('artistB');

    const projectName = `TEST_WF3_DELEG_${Date.now()}`;
    let wrId = null;

    try {
        // Video Framer project -> comes to Web Manager (CM A)
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Delegation',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Video Framer project needing Web team + Sister team',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'high'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup delegation project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        // CM A creates T1 (own team: Artist A) and T2 (delegated to CM B)
        const t1Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId,
            task_name: 'Web Framer UI Task',
            description: 'Web task',
            request_type_id: meta.rtA,
            task_type_id: meta.ttAId,
            assigned_to_ids: [artA.id],
            deadline: plusDays(7)
        });
        const t1Id = t1Res.body?.data?.id;

        const t2Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId,
            task_name: 'Sister Team Asset Task',
            description: 'Delegated to sister vertical manager',
            request_type_id: meta.rtB,
            task_type_id: meta.ttBId,
            assigned_to_ids: [cmB.id],
            deadline: plusDays(7)
        });
        ctx.check('CM A creates T1 (Artist A) and T2 (delegated to CM B)', t1Res.ok && t2Res.ok && !!t1Id && !!t2Res.body?.data?.id, `T1=${t1Id} T2=${t2Res.body?.data?.id}`);
        const t2Id = t2Res.body?.data?.id;

        // Negative: CM A cannot bypass CM B and assign directly to Artist B
        const directOtherArt = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId,
            task_name: 'Invalid Direct Cross-Team Assign',
            description: 'Should fail',
            request_type_id: meta.rtB,
            task_type_id: meta.ttBId,
            assigned_to_ids: [artB.id],
            deadline: plusDays(7)
        });
        ctx.check('CM A cannot assign task directly to Artist B (403)', directOtherArt.status === 403, `HTTP ${directOtherArt.status}`);

        // Before CM B assigns to Artist B: check visibility for CM B
        const cmBTaskBefore = await ctx.api('cmB', 'GET', `users/tasks/${t2Id}`);
        ctx.check('CM B can view delegated task T2 before assigning to Artist B', cmBTaskBefore.ok, `HTTP ${cmBTaskBefore.status}`);

        const cmBWrListBefore = await ctx.api('cmB', 'GET', `manager/assigned-work-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        ctx.check(
            'CM B sees project in GET /manager/assigned-work-requests when a task is delegated to CM B',
            (cmBWrListBefore.body?.data || []).some(w => w.id === wrId),
            `found=${(cmBWrListBefore.body?.data || []).some(w => w.id === wrId)}`,
            {
                severity: 'High',
                area: 'Cross-Manager Delegation Visibility',
                expected: 'When Manager A delegates a task to Manager B, Manager B should be able to see the project/task in their manager work-request dashboard list.',
                actual: 'GET /manager/assigned-work-requests returned 0 matching projects for CM B.',
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (getAssignedWorkRequests line 455) enforces an inner join on work_request_managers (where: { manager_id }) and excludes delegated managers who only appear in task_assignments / task_history.'
            }
        );

        // CM B cannot assign T2 to Artist A (outside CM B's team)
        const badAssignBtoA = await ctx.api('cmB', 'POST', 'users/assign-task', {
            task_id: t2Id, user_id: artA.id, work_request_id: wrId
        });
        ctx.check('CM B cannot assign T2 to Artist A (403)', badAssignBtoA.status === 403, `HTTP ${badAssignBtoA.status}`);

        // CM B assigns T2 to Artist B
        const assignB = await ctx.api('cmB', 'POST', 'users/assign-task', {
            task_id: t2Id, user_id: artB.id, work_request_id: wrId, deadline: plusDays(8)
        });
        ctx.check('CM B assigns delegated task T2 to Artist B', assignB.ok, `HTTP ${assignB.status}`);

        // BOTH managers can view T2 after assignment ("2no manager task dekh sakte hai")
        const cmAGetT2 = await ctx.api('cmA', 'GET', `users/tasks/${t2Id}`);
        const cmBGetT2 = await ctx.api('cmB', 'GET', `users/tasks/${t2Id}`);
        ctx.check('Both CM A and CM B can view T2 via GET /users/tasks/:id', cmAGetT2.ok && cmBGetT2.ok, `CM_A=${cmAGetT2.status} CM_B=${cmBGetT2.status}`);

        const cmBGetWrById = await ctx.api('cmB', 'GET', `manager/assigned-work-requests/${wrId}`);
        ctx.check('CM B can view project details via GET /manager/assigned-work-requests/:id', cmBGetWrById.ok, `HTTP ${cmBGetWrById.status}`);

        const cmBGetWrTasks = await ctx.api('cmB', 'GET', `manager/assigned-work-requests/work-request/${wrId}/tasks`);
        ctx.check(
            'CM B can view tasks via GET /manager/assigned-work-requests/work-request/:id/tasks',
            cmBGetWrTasks.ok && (cmBGetWrTasks.body?.data || []).some(t => t.id === t2Id),
            `HTTP ${cmBGetWrTasks.status} error=${cmBGetWrTasks.body?.error}`,
            {
                severity: 'High',
                area: 'Cross-Manager Delegation Visibility',
                expected: 'Delegated manager (CM B) should be able to fetch tasks of the work request where they have delegated tasks.',
                actual: `GET /manager/assigned-work-requests/work-request/${wrId}/tasks returned HTTP ${cmBGetWrTasks.status} (${cmBGetWrTasks.body?.error}).`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (getTasksByWorkRequestId lines 2105-2123) filters solely by WorkRequestManagers where manager_id = req.user.id, blocking delegated managers.'
            }
        );

        const cmAGetTasksList = await ctx.api('cmA', 'GET', `users/tasks?limit=100`);
        const cmASeesT2InUserTasks = (cmAGetTasksList.body?.data || []).some(t => t.id === t2Id);
        ctx.check(
            'CM A sees delegated task T2 in GET /users/tasks list after CM B assigns to Artist B',
            cmASeesT2InUserTasks,
            `CM_A sees T2 in GET /users/tasks = ${cmASeesT2InUserTasks}`,
            {
                severity: 'Medium',
                area: 'Cross-Manager Delegation Visibility',
                expected: 'Both managers (project manager CM A who delegated the task and CM B who received/assigned it) should be able to see the task in their task list.',
                actual: 'Once CM B assigns T2 to Artist B, CM A no longer sees T2 in GET /users/tasks because getAssignedTasks only queries tasks assigned to users in CM A’s own divisions.',
                rootCause: 'controller/userController/userController.js (getAssignedTasks lines 65-91 & 302-314) builds userIds only from manager own UserDivisions rather than also including tasks on WorkRequestManagers.'
            }
        );

        // Isolation checks: CM B and Artist B cannot see T1; Artist A cannot see T2
        const cmBGetT1 = await ctx.api('cmB', 'GET', `users/tasks/${t1Id}`);
        const artAGetT2 = await ctx.api('artistA', 'GET', `users/tasks/${t2Id}`);
        const artBGetT1 = await ctx.api('artistB', 'GET', `users/tasks/${t1Id}`);
        ctx.check('Own-team isolation: CM B & Artist B blocked from T1, Artist A blocked from T2 (404)',
            cmBGetT1.status === 404 && artAGetT2.status === 404 && artBGetT1.status === 404,
            `CM_B_T1=${cmBGetT1.status} ART_A_T2=${artAGetT2.status} ART_B_T1=${artBGetT1.status}`);

        // Artists accept & submit both T1 and T2
        await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistB', 'PUT', `users/tasks/${t2Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t1Id, work_request_id: wrId, task_count: 2 }, { documents: 't1_doc.txt' }));
        const subT2 = await ctx.api('artistB', 'POST', 'users/tasks/submit', makeForm({ task_id: t2Id, work_request_id: wrId, task_count: 3 }, { documents: 't2_doc.txt' }));
        const t2DocId = subT2.body?.data?.documents?.[0]?.id;

        // Check CM B reviewing T2's document!
        if (t2DocId) {
            const revDocB = await ctx.api('cmB', 'PUT', `manager/assigned-work-requests/documents/${t2DocId}/review`, { review: 'approved' });
            ctx.check(
                'Delegated manager (CM B) can review T2 task document',
                revDocB.ok,
                `HTTP ${revDocB.status} ${revDocB.body?.error || ''}`,
                {
                    severity: 'High',
                    area: 'Delegated Manager Document Review',
                    expected: 'CM B (who manages delegated task T2 and Artist B) should be able to approve/review documents submitted on T2.',
                    actual: `PUT /manager/assigned-work-requests/documents/${t2DocId}/review returned HTTP ${revDocB.status} (${revDocB.body?.error}).`,
                    rootCause: 'controller/managerAssignedController/managerAssignedController.js (reviewTaskDocument lines 3715-3720) still requires WorkRequestManagers.manager_id = req.user.id instead of using canActOnTask(req.user, task.id).'
                }
            );
        }

        // CM A cannot review/share T2 (delegated away), CM B can review/share T2
        const cmARevT2 = await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t2Id, action: 'approved' });
        ctx.check('CM A cannot review delegated task T2 (403)', cmARevT2.status === 403, `HTTP ${cmARevT2.status}`);

        const cmBRevT2 = await ctx.api('cmB', 'PUT', 'manager/assigned-work-requests/review', { task_id: t2Id, action: 'approved' });
        ctx.check('CM B approves delegated task T2', cmBRevT2.ok, `HTTP ${cmBRevT2.status}`);

        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id] });

        const cmAShareT2 = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t2Id] });
        ctx.check('CM A cannot share delegated task T2 (403)', cmAShareT2.status === 403, `HTTP ${cmAShareT2.status}`);

        const cmBShareT2 = await ctx.api('cmB', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t2Id] });
        ctx.check('CM B shares delegated task T2 for client review', cmBShareT2.ok, `HTTP ${cmBShareT2.status}`);

        // PMT approves T1 -> project must NOT complete while T2 is pending approval
        const appT1 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check('Approving T1 alone does not complete project while T2 is open',
            appT1.ok && appT1.body?.work_request_completed === false,
            `completed=${appT1.body?.work_request_completed}`);

        // PMT requests change V2 on T2 -> check CM B handles V2 and reviews V2 document!
        const rejT2 = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t2Id, comments: 'Need video tweak', issue_register_ids: [meta.issueRegisterId]
        });
        const v2Id = rejT2.body?.data?.change_request_issue?.id;
        ctx.check('PMT creates change V2 on delegated task T2', rejT2.ok && !!v2Id, `V2=${v2Id}`);

        const cmBAcceptV2 = await ctx.api('cmB', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
        const cmAAcceptV2 = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
        ctx.check('CM B accepts V2 on delegated task T2; CM A gets 403',
            cmBAcceptV2.ok && cmAAcceptV2.status === 403,
            `CM_B=${cmBAcceptV2.status} CM_A=${cmAAcceptV2.status}`);

        // Both CM A and CM B see V2 in issue-assignments list
        const listA = await ctx.api('cmA', 'GET', 'manager/assigned-work-requests/issue-assignments?limit=50');
        const listB = await ctx.api('cmB', 'GET', 'manager/assigned-work-requests/issue-assignments?limit=50');
        ctx.check('Both CM A and CM B see V2 in issue-assignments',
            (listA.body?.data || []).some(i => i.id === v2Id) && (listB.body?.data || []).some(i => i.id === v2Id),
            `inA=${(listA.body?.data || []).some(i => i.id === v2Id)} inB=${(listB.body?.data || []).some(i => i.id === v2Id)}`);

        await ctx.api('cmB', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', { issue_assignment_id: v2Id, user_id: artB.id });
        await ctx.api('artistB', 'PUT', `users/issues/${v2Id}/accept`, { start_date: todayIst() });
        const subV2 = await ctx.api('artistB', 'PUT', `users/issues/${v2Id}/submit`, makeForm({ task_count: 2 }, { documents: 'v2_doc.txt' }));
        const v2DocId = subV2.body?.data?.documents?.[0]?.id;

        if (v2DocId) {
            const revIssDocB = await ctx.api('cmB', 'PUT', `manager/assigned-work-requests/issue-documents/${v2DocId}/review`, { review: 'approved' });
            ctx.check(
                'Delegated manager (CM B) can review V2 issue document',
                revIssDocB.ok,
                `HTTP ${revIssDocB.status} ${revIssDocB.body?.error || ''}`,
                {
                    severity: 'High',
                    area: 'Delegated Manager Document Review',
                    expected: 'CM B (delegated manager) should be able to review issue documents on V2.',
                    actual: `PUT /manager/assigned-work-requests/issue-documents/${v2DocId}/review returned HTTP ${revIssDocB.status} (${revIssDocB.body?.error}).`,
                    rootCause: 'controller/managerAssignedController/managerAssignedController.js (reviewIssueDocument lines 3814-3819) still requires WorkRequestManagers.manager_id = req.user.id instead of canActOnTask(req.user, task.id).'
                }
            );
        }

        await ctx.api('cmB', 'PUT', 'manager/assigned-work-requests/review', { issue_id: v2Id, action: 'approved' });
        await ctx.api('cmB', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, issue_ids: [v2Id] });
        const appV2 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { issue_id: v2Id });
        ctx.check('PMT approves V2 -> project auto-completes once both T1 and T2/V2 are approved',
            appV2.ok && appV2.body?.data?.workRequestCompleted === true,
            `HTTP ${appV2.status} completed=${appV2.body?.data?.workRequestCompleted}`);
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
