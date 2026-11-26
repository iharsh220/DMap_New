const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('01-project-and-task-lifecycle', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const cmA = ctx.user('cmA');
    const artA = ctx.user('artistA');

    const projectName = `TEST_WF1_${Date.now()}`;
    let wrId = null;

    try {
        // 1. PMT creates project
        const createWr = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Test',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Automated test: full single-team workflow with rework & completion',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'medium'
        }, { documents: 'brief_v0.txt' }));

        ctx.check('PMT creates work request', createWr.ok && !!createWr.body?.data?.workRequest?.id, `HTTP ${createWr.status}`);
        wrId = createWr.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) return ctx.summary();

        ctx.check('New work request starts in pending status', createWr.body.data.workRequest.status === 'pending', `status=${createWr.body.data.workRequest.status}`);

        // Check CM A sees it, CM B does not
        const cmAList = await ctx.api('cmA', 'GET', `manager/assigned-work-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        const cmBList = await ctx.api('cmB', 'GET', `manager/assigned-work-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        ctx.check('CM A sees new project in assigned-work-requests', (cmAList.body?.data || []).some(w => w.id === wrId), `count=${cmAList.body?.data?.length}`);
        ctx.check('CM B does not see CM A project', !(cmBList.body?.data || []).some(w => w.id === wrId), `count=${cmBList.body?.data?.length}`);

        // 2. Manager accepts project
        const badAcceptB = await ctx.api('cmB', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});
        ctx.check('Non-assigned manager (CM B) cannot accept project', [403, 404].includes(badAcceptB.status), `HTTP ${badAcceptB.status}`);

        const acceptWr = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});
        ctx.check('CM A accepts work request', acceptWr.ok, `HTTP ${acceptWr.status}`);

        const acceptTwice = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});
        ctx.check('Accepting work request twice returns 400', acceptTwice.status === 400, `HTTP ${acceptTwice.status}`);

        // 3. Manager creates task V1 assigned to Artist A
        const createT1 = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId,
            task_name: 'Task 1 Primary Work',
            description: 'Initial V1 task',
            request_type_id: meta.rtA,
            task_type_id: meta.ttAId,
            assigned_to_ids: [artA.id],
            deadline: plusDays(7)
        });
        ctx.check('CM A creates task for Artist A', createT1.ok && !!createT1.body?.data?.id, `HTTP ${createT1.status}`);
        const t1Id = createT1.body?.data?.id;
        if (!t1Id) return ctx.summary();

        ctx.check('New task defaults to version V1', createT1.body.data.version === 'V1', `version=${createT1.body.data.version}`);

        // 4. Artist A accepts task with start_date = today
        const accT1 = await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        ctx.check('Artist A accepts task with start_date=today -> in_progress', accT1.ok && accT1.body?.data?.status === 'in_progress', `HTTP ${accT1.status} status=${accT1.body?.data?.status}`);

        // Check work request status after task starts!
        const linkedAfterStart = await ctx.getLinkedProject('cmA', wrId);
        const wrStatusAfterStart = linkedAfterStart.body?.data?.project?.status;
        ctx.check(
            'Work request status updates to in_progress when task starts (without waiting for midnight cron)',
            wrStatusAfterStart === 'in_progress',
            `work_requests.status=${wrStatusAfterStart}`,
            {
                severity: 'Medium',
                area: 'Work Request Status Transition',
                expected: 'When an artist accepts/starts a task (status becomes in_progress), the parent work request status should reflect in_progress immediately (or on submit).',
                actual: `work_requests.status remained "${wrStatusAfterStart}" even after task became in_progress.`,
                rootCause: 'controller/userController/userController.js (acceptTask / submitTask) never updates WorkRequests.status; only the 00:01 AM cron in services/taskSchedulerService.js moves work_requests from accepted to in_progress.'
            }
        );

        // 5. Artist A submits task with task_count + file
        const subT1 = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
            task_id: t1Id,
            work_request_id: wrId,
            task_count: 3,
            link: 'https://example.com/v1',
            comments: 'First submission'
        }, { documents: 'deliverable_v1.txt' }));
        ctx.check('Artist A submits task with task_count=3 and file', subT1.ok, `HTTP ${subT1.status} ${JSON.stringify(subT1.body?.error || '')}`);

        const linkedAfterSubmit = await ctx.getLinkedProject('cmA', wrId);
        const t1AfterSubmit = (linkedAfterSubmit.body?.data?.tasks || []).find(t => t.id === t1Id);
        ctx.check('Submitted task has status=completed, start_date, end_date, task_count=3',
            t1AfterSubmit?.status === 'completed' && !!t1AfterSubmit.start_date && !!t1AfterSubmit.end_date && Number(t1AfterSubmit.task_count) === 3,
            JSON.stringify({ status: t1AfterSubmit?.status, start_date: t1AfterSubmit?.start_date, end_date: t1AfterSubmit?.end_date, task_count: t1AfterSubmit?.task_count, review_stage: t1AfterSubmit?.review_stage }));

        // 6. Manager asks for rework (change_request) -> back to Artist A -> resubmit -> Manager approves
        const mgrRework = await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', {
            task_id: t1Id,
            action: 'change_request',
            comments: 'Please adjust alignment'
        });
        ctx.check('CM A sends task back for rework', mgrRework.ok, `HTTP ${mgrRework.status}`);

        const linkedAfterRework = await ctx.getLinkedProject('cmA', wrId);
        const t1AfterRework = (linkedAfterRework.body?.data?.tasks || []).find(t => t.id === t1Id);
        ctx.check('Reworked task returns to in_progress and clears end_date',
            t1AfterRework?.status === 'in_progress' && t1AfterRework?.end_date === null,
            JSON.stringify({ status: t1AfterRework?.status, end_date: t1AfterRework?.end_date }));

        // Artist A resubmits with updated task_count
        const resubT1 = await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({
            task_id: t1Id,
            work_request_id: wrId,
            task_count: 4,
            link: 'https://example.com/v1_rework'
        }, { documents: 'deliverable_v1_rework.txt' }));
        ctx.check('Artist A resubmits reworked task with task_count=4', resubT1.ok, `HTTP ${resubT1.status}`);

        // Manager approves
        const mgrApprove = await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', {
            task_id: t1Id,
            action: 'approved',
            comments: 'Looks good'
        });
        ctx.check('CM A approves task -> review_stage=pm_review', mgrApprove.ok && mgrApprove.body?.data?.task?.review_stage === 'pm_review', `HTTP ${mgrApprove.status}`);

        // PMT cannot approve before shared for client review
        const earlyPmApprove = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check('PMT cannot approve task before share-for-client-review (400)', earlyPmApprove.status === 400, `HTTP ${earlyPmApprove.status}`);

        // Manager shares for client review
        const shareRes = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', {
            work_request_id: wrId,
            task_ids: [t1Id]
        });
        ctx.check('CM A shares task for client review', shareRes.ok, `HTTP ${shareRes.status}`);

        // PMT sees project in my-requests with task, assignee, task_count, dates
        const pmtList = await ctx.api('pmt', 'GET', `work-requests/my-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        const pmtWr = (pmtList.body?.data || []).find(w => w.id === wrId);
        const pmtT1 = (pmtWr?.Tasks || []).find(t => t.id === t1Id);
        ctx.check('PMT sees project & task in my-requests with task_count and dates',
            !!pmtWr && !!pmtT1 && Number(pmtT1.task_count) === 4 && !!pmtT1.start_date && !!pmtT1.end_date,
            JSON.stringify({ foundWr: !!pmtWr, task_count: pmtT1?.task_count, start_date: pmtT1?.start_date, end_date: pmtT1?.end_date }));

        // 7. PMT approves -> project auto-completes
        const pmApprove = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check('PMT approves task and auto-completes project',
            pmApprove.ok && pmApprove.body?.work_request_completed === true,
            `HTTP ${pmApprove.status} completed=${pmApprove.body?.work_request_completed}`);

        const linkedDone = await ctx.getLinkedProject('cmA', wrId);
        ctx.check('Linked view confirms project status=completed',
            linkedDone.body?.data?.project?.status === 'completed',
            `status=${linkedDone.body?.data?.project?.status}`);

        // Check admin Projects grid & completion timestamp
        const adminProj = await ctx.getAdminRow('cmA', 'projectsdetails', projectName);
        const projRow = (adminProj.body?.data || []).find(r => r.work_request_id === wrId);
        ctx.check('Admin Projects grid shows completed status & non-zero task_no_of_work_pages',
            projRow?.project_request_status === 'completed' && Number(projRow?.task_no_of_work_pages) === 4 && Number(projRow?.task_count) === 1,
            JSON.stringify({ status: projRow?.project_request_status, pages: projRow?.task_no_of_work_pages, tasks: projRow?.task_count, compTs: projRow?.project_completion_timestamp }));

        ctx.check(
            'Admin Projects grid populates project_completion_timestamp after auto-completion',
            !!projRow?.project_completion_timestamp && projRow.project_completion_timestamp !== 'N/A',
            `project_completion_timestamp=${projRow?.project_completion_timestamp}`,
            {
                severity: 'Low',
                area: 'Admin Dashboard / Reporting',
                expected: 'When a project auto-completes on final PMT approval, project_completion_timestamp / project_marked_completed_timestamp in Projects grid should show the completion timestamp.',
                actual: `project_completion_timestamp is "${projRow?.project_completion_timestamp}".`,
                rootCause: "controller/adminController.js (getAdminData lines 1828, 1844, 1859, 1881, 1900) filters work_request_history by action = 'completed', whereas automatic project completion in services/workRequestCompletionService.js writes action = 'auto_completed'."
            }
        );

        // Check history has expected events
        const wrHist = await ctx.api('pmt', 'GET', `work-requests/history/${wrId}`);
        const actions = (wrHist.body?.data || []).map(h => h.action);
        ctx.check('Work request history contains created, manager_accepted, pm_approved_task, auto_completed',
            ['created', 'manager_accepted', 'pm_approved_task', 'auto_completed'].every(a => actions.includes(a)),
            `actions=${actions.join(',')}`);
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
