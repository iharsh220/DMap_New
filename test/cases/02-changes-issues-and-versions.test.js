const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('02-changes-issues-and-versions', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const artA = ctx.user('artistA');

    const projectName = `TEST_WF2_CHANGES_${Date.now()}`;
    let wrId = null;

    try {
        // Setup project + task V1 -> submitted -> manager approved -> shared with PMT
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Changes',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Test changes V2/V3, pm-reject, issue-register, cancel change',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'high'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});
        const t1Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId,
            task_name: 'Change Cycle Task',
            description: 'Task V1 for change cycles',
            request_type_id: meta.rtA,
            task_type_id: meta.ttAId,
            assigned_to_ids: [artA.id],
            deadline: plusDays(10)
        });
        const t1Id = t1Res.body?.data?.id;
        await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
            task_id: t1Id, work_request_id: wrId, task_count: 5, link: 'https://example.com/t1'
        }, { documents: 't1_v1.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id] });

        // 1. PMT requests changes via pm-reject (without explicit version -> must start at V2!)
        const reject1 = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id,
            comments: 'Change round 1',
            issue_description: 'Update headline and footer',
            issue_register_ids: [meta.issueRegisterId],
            deadline: plusDays(12)
        });
        ctx.check('PMT pm-reject creates change request V2',
            reject1.ok && reject1.body?.data?.change_request_issue?.version === 'V2',
            `HTTP ${reject1.status} version=${reject1.body?.data?.change_request_issue?.version}`);
        const v2Id = reject1.body?.data?.change_request_issue?.id;

        // Check whether pm-reject cleared task end_date when reopening task to in_progress
        const linkedAfterReject1 = await ctx.getLinkedProject('cmA', wrId);
        const taskAfterReject1 = (linkedAfterReject1.body?.data?.tasks || []).find(t => t.id === t1Id);
        ctx.check(
            'Task reopened to in_progress by pm-reject clears end_date (no open task with end_date)',
            taskAfterReject1?.status === 'in_progress' && taskAfterReject1?.end_date === null,
            `status=${taskAfterReject1?.status} end_date=${taskAfterReject1?.end_date}`,
            {
                severity: 'Medium',
                area: 'Task Dates / PM Reject',
                expected: 'When pm-reject puts a completed task back to in_progress (like manager rework does), end_date should be cleared (null) because open items should not hold a stale end_date.',
                actual: `task.status became "in_progress" while task.end_date remained "${taskAfterReject1?.end_date}".`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmRejectTask lines 2407-2413 and 2516-2522) sets status: "in_progress" without resetting end_date: null.'
            }
        );

        // Check PMT is NOT shown as assignee on V2
        const mgrIssuesRes = await ctx.api('cmA', 'GET', 'manager/assigned-work-requests/issue-assignments?limit=50');
        const v2Row = (mgrIssuesRes.body?.data || []).find(i => i.id === v2Id);
        ctx.check('V2 appears in manager issue-assignments and PMT is NOT listed in assignedUsers',
            !!v2Row && !(v2Row.assignedUsers || []).some(u => u.user_id === pmt.id),
            `found=${!!v2Row} assignedUsers=${JSON.stringify((v2Row?.assignedUsers || []).map(u => u.user_id))}`);

        // 2. Manager accepts V2, assigns to Artist A
        const accMgrV2 = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
        ctx.check('CM A accepts V2 (m_pending -> m_accepted)', accMgrV2.ok, `HTTP ${accMgrV2.status}`);

        const assignBadPmt = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', {
            issue_assignment_id: v2Id, user_id: pmt.id
        });
        ctx.check('Manager cannot assign change V2 to PMT (403)', assignBadPmt.status === 403, `HTTP ${assignBadPmt.status}`);

        const assignV2 = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', {
            issue_assignment_id: v2Id, user_id: artA.id, deadline: plusDays(12)
        });
        ctx.check('CM A assigns V2 to Artist A -> u_pending', assignV2.ok && assignV2.body?.data?.status === 'u_pending', `HTTP ${assignV2.status}`);

        // Artist A accepts V2 and submits with task_count=2
        const accUserV2 = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/accept`, { start_date: todayIst() });
        ctx.check('Artist A accepts V2 -> in_progress', accUserV2.ok && accUserV2.body?.data?.status === 'in_progress', `HTTP ${accUserV2.status}`);

        const subV2 = await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm({
            task_count: 2, link: 'https://example.com/v2', description: 'V2 fixes applied'
        }, { documents: 'deliverable_v2.txt' }));
        ctx.check('Artist A submits V2 with task_count=2', subV2.ok, `HTTP ${subV2.status}`);

        // Check response type of task_count on submitIssue vs submitTask
        ctx.check('submitIssue response task_count type/value matches submitted integer (2)',
            subV2.body?.data?.task_count === 2 || String(subV2.body?.data?.task_count) === '2',
            `typeof=${typeof subV2.body?.data?.task_count} val=${subV2.body?.data?.task_count}`);

        // Manager reviews V2 -> approves -> shares V2 for client review
        const revV2 = await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { issue_id: v2Id, action: 'approved' });
        ctx.check('CM A approves V2 -> pm_review', revV2.ok && revV2.body?.data?.issue?.review_stage === 'pm_review', `HTTP ${revV2.status}`);

        const shareV2 = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', {
            work_request_id: wrId, issue_ids: [v2Id]
        });
        ctx.check('CM A shares V2 for client review', shareV2.ok, `HTTP ${shareV2.status}`);

        // 3. PMT rejects V2 -> creates V3 (change on a change!)
        const reject2 = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            issue_id: v2Id,
            comments: 'One more tweak needed -> V3',
            issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check('PMT pm-reject on V2 creates V3 (version=V3, issue_id=V2)',
            reject2.ok && reject2.body?.data?.change_request_issue?.version === 'V3' && reject2.body?.data?.change_request_issue?.issue_id === v2Id,
            `HTTP ${reject2.status} version=${reject2.body?.data?.change_request_issue?.version} parent=${reject2.body?.data?.change_request_issue?.issue_id}`);
        const v3Id = reject2.body?.data?.change_request_issue?.id;

        // Complete V3 cycle
        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v3Id}/accept`, {});
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', { issue_assignment_id: v3Id, user_id: artA.id });
        await ctx.api('artistA', 'PUT', `users/issues/${v3Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'PUT', `users/issues/${v3Id}/submit`, makeForm({ task_count: 1 }, { documents: 'v3.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { issue_id: v3Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, issue_ids: [v3Id] });

        // PMT approves V3 -> must close V2, T1, and auto-complete project!
        const pmAppV3 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { issue_id: v3Id });
        ctx.check('PMT approves V3 and auto-completes project',
            pmAppV3.ok && pmAppV3.body?.data?.workRequestCompleted === true,
            `HTTP ${pmAppV3.status} completed=${pmAppV3.body?.data?.workRequestCompleted}`);

        const linkedAfterV3 = await ctx.getLinkedProject('cmA', wrId);
        const taskDone = (linkedAfterV3.body?.data?.tasks || []).find(t => t.id === t1Id);
        const v2Done = (taskDone?.changes || []).find(c => c.id === v2Id);
        const v3Done = (taskDone?.changes || []).find(c => c.id === v3Id);
        ctx.check('After V3 approval, project=completed, T1=completed+final_approved, V2=completed+final_approved, V3=completed+final_approved',
            linkedAfterV3.body?.data?.project?.status === 'completed'
            && taskDone?.status === 'completed' && taskDone?.review_stage === 'final_approved'
            && v2Done?.status === 'completed' && v2Done?.review_stage === 'final_approved'
            && v3Done?.status === 'completed' && v3Done?.review_stage === 'final_approved',
            JSON.stringify({ wr: linkedAfterV3.body?.data?.project?.status, t1: [taskDone?.status, taskDone?.review_stage], v2: [v2Done?.status, v2Done?.review_stage], v3: [v3Done?.status, v3Done?.review_stage] }));

        // 4. Test issue-register/assignment multipart + version guard + cancel flow
        // First test creating V4 via issue-register/assignment with multipart + file
        const irCreate = await ctx.api('pmt', 'POST', 'issue-register/assignment', makeForm({
            task_id: t1Id,
            issue_id: v3Id,
            requested_by_user_id: pmt.id,
            assignment_type: 'mod',
            version: 'V4',
            description: 'Multipart change V4 to cancel',
            intimate_client: 1,
            issue_register_ids: `[${meta.issueRegisterId}]`
        }, { files: 'pmt_brief_v4.txt' }));
        ctx.check('PMT creates V4 via multipart POST /issue-register/assignment with file',
            irCreate.status === 201 && irCreate.body?.data?.version === 'V4',
            `HTTP ${irCreate.status}`);
        const v4Id = irCreate.body?.data?.id;

        // Check pmt_documents is populated and PMT is hidden from assignedUsers
        const mgrAfterV4 = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/${wrId}`);
        const t1Mgr = (mgrAfterV4.body?.data?.Tasks || []).find(t => t.id === t1Id);
        const v4Mgr = (t1Mgr?.issueAssignments || []).find(i => i.id === v4Id);
        ctx.check('V4 has pmt_documents populated and PMT excluded from assignedUsers',
            !!v4Mgr && (v4Mgr.pmt_documents || []).length >= 1 && !(v4Mgr.assignedUsers || []).some(u => u.user_id === pmt.id),
            `pmt_docs=${v4Mgr?.pmt_documents?.length} assigned=${v4Mgr?.assignedUsers?.length}`);

        // Cancel V4 -> check V3 restored to completed + pm_review -> PMT approves V3 again -> project completes
        const cancelV4 = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v4Id}/cancel`, { reason: 'Duplicate request' });
        ctx.check('Manager cancels V4', cancelV4.ok, `HTTP ${cancelV4.status}`);

        // Test if issue-register/assignment blocks version=V1 (changes must start from V2!)
        const badVerIr = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t1Id,
            requested_by_user_id: pmt.id,
            assignment_type: 'mod',
            version: 'V1',
            description: 'Should not allow V1 on change',
            intimate_client: 1,
            issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check(
            'POST /issue-register/assignment rejects version="V1" (changes must start from V2)',
            badVerIr.status === 400,
            `HTTP ${badVerIr.status} version=${badVerIr.body?.data?.version}`,
            {
                severity: 'Medium',
                area: 'Version Rules (Task = V1, Changes >= V2)',
                expected: 'Task is V1 and change requests must start from V2 (V2, V3, ...); creating a change request with version="V1" should be rejected or auto-normalized to V2+.',
                actual: `POST /issue-register/assignment returned HTTP ${badVerIr.status} and saved a change request with version="V1".`,
                rootCause: 'controller/issueRegisterController/issueRegisterController.js (createIssueAssignment lines 113, 238) accepts any non-empty version string from req.body without enforcing >= V2.'
            }
        );

        // Test if pm-reject blocks version="V1" when passed explicitly
        const badVerReject = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id,
            version: 'V1',
            comments: 'Should not save as V1',
            issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check(
            'POST /work-requests/pm-reject rejects or prevents version="V1" override',
            badVerReject.status === 400 || (badVerReject.body?.data?.change_request_issue?.version !== 'V1'),
            `HTTP ${badVerReject.status} version=${badVerReject.body?.data?.change_request_issue?.version}`,
            {
                severity: 'Medium',
                area: 'Version Rules (Task = V1, Changes >= V2)',
                expected: 'pm-reject should enforce that change versions start from V2 even if the caller passes version="V1".',
                actual: `POST /work-requests/pm-reject returned HTTP ${badVerReject.status} with version="${badVerReject.body?.data?.change_request_issue?.version}".`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmRejectTask line 2353) uses /^V\\d+$/i.test(req.body.version), which allows "V1" (and "V0") to override the auto-incremented V2+ version.'
            }
        );
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
