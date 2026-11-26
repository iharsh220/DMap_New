const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('06-edge-cases-access-and-data', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const cmA = ctx.user('cmA');
    const artA = ctx.user('artistA');
    const cmB = ctx.user('cmB');
    const artB = ctx.user('artistB');

    const projectName = `TEST_WF6_EDGE_${Date.now()}`;
    let wrId = null;

    try {
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Edge',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Edge cases: duplicate pm-approve, getWorkRequestById as manager, task details fields, multi-assignee wipeout, pm-reject bad deadline, change on pending task',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'low'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup edge-case project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        // 1. Manager calling GET /work-requests/:id
        const mgrGetWr = await ctx.api('cmA', 'GET', `work-requests/${wrId}`);
        ctx.check(
            'Assigned manager can fetch project via GET /work-requests/:id',
            mgrGetWr.ok,
            `HTTP ${mgrGetWr.status} ${mgrGetWr.body?.error || ''}`,
            {
                severity: 'Medium',
                area: 'API Access / Work Request Read',
                expected: 'getWorkRequestById checks isCreator || isManager and should return the work request when an assigned manager calls it.',
                actual: `GET /work-requests/${wrId} returned HTTP ${mgrGetWr.status} (${mgrGetWr.body?.error}).`,
                rootCause: 'controller/workRequestController/workRequestController.js (getWorkRequestById lines 1031-1039) allows isManager past the auth check, then immediately queries workRequestService.getAll({ where: { id, user_id } }) using the caller id instead of omitting user_id.'
            }
        );

        // 2. Create Task 1 (pending)
        const t1Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Edge Pending Task', description: 'Pending task checks',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(7)
        });
        const t1Id = t1Res.body?.data?.id;

        // Check GET /manager/assigned-work-requests/work-request/:id/tasks returns task_count, start_date, end_date, status
        const wrTasksRes = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/work-request/${wrId}/tasks`);
        const t1Summary = (wrTasksRes.body?.data || []).find(t => t.id === t1Id);
        ctx.check(
            'GET /manager/assigned-work-requests/work-request/:id/tasks includes task status, task_count, start_date, end_date',
            !!t1Summary && ('status' in t1Summary) && ('task_count' in t1Summary) && ('start_date' in t1Summary) && ('end_date' in t1Summary),
            `keys=${Object.keys(t1Summary || {}).join(',')}`,
            {
                severity: 'Medium',
                area: 'Missing Task Fields in API Response',
                expected: 'Task list endpoint should include status, task_count, start_date, and end_date on each task.',
                actual: `Returned task keys only: ${Object.keys(t1Summary || {}).join(', ')}.`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (getTasksByWorkRequestId lines 2128, 2194-2207) selects only [id, task_name, deadline] and omits status, task_count, start_date, end_date, version.'
            }
        );

        // 3. Can PMT raise a change request via issue-register/assignment on a PENDING (unsubmitted) task?
        const irOnPending = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
            task_id: t1Id, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
            description: 'Change on unstarted pending task', issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check(
            'POST /issue-register/assignment blocks requesting changes on a task that has not been completed/submitted yet',
            irOnPending.status === 400,
            `HTTP ${irOnPending.status} id=${irOnPending.body?.data?.id}`,
            {
                severity: 'Medium',
                area: 'Workflow Guard (Changes on Unsubmitted Work)',
                expected: 'Changes (V2+) should only be requested after a task has been completed/shared for review, not while still pending/unstarted.',
                actual: `POST /issue-register/assignment succeeded (HTTP ${irOnPending.status}) on a pending task.`,
                rootCause: 'controller/issueRegisterController/issueRegisterController.js (createIssueAssignment lines 174-180) only rejects tasks in [cancelled, rejected].'
            }
        );
        if (irOnPending.body?.data?.id) {
            await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${irOnPending.body.data.id}/cancel`, { reason: 'cleanup' });
        }

        // 4. Create T2 with BOTH Artist A and CM B in assigned_to_ids, then CM B assigns to Artist B -> does it wipe out Artist A?!
        const tMultiRes = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Multi Assignee Task', description: 'Both Artist A and CM B',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id, cmB.id], deadline: plusDays(8)
        });
        const tMultiId = tMultiRes.body?.data?.id;
        ctx.check('Create task with both Artist A and CM B succeeds', tMultiRes.ok && !!tMultiId, `HTTP ${tMultiRes.status}`);
        if (tMultiId) {
            const assignMultiB = await ctx.api('cmB', 'POST', 'users/assign-task', {
                task_id: tMultiId, user_id: artB.id, work_request_id: wrId
            });
            const linkedMulti = await ctx.getLinkedProject('cmA', wrId);
            const tMultiRow = (linkedMulti.body?.data?.tasks || []).find(t => t.id === tMultiId);
            ctx.check(
                'When CM B reassigns their part of a multi-assignee task, Artist A assignment is not silently wiped out',
                !assignMultiB.ok || String(tMultiRow?.assignees || '').includes(artA.name.trim()),
                `assignHTTP=${assignMultiB.status} assigneesAfter="${tMultiRow?.assignees}"`,
                {
                    severity: 'Medium',
                    area: 'Multi-Assignee / Delegation',
                    expected: 'Reassigning by a delegated manager should replace only the delegating manager’s assignment, or multi-assignee delegation should be blocked cleanly.',
                    actual: `POST /users/assign-task deleted ALL TaskAssignments for task #${tMultiId}, silently removing ${artA.name.trim()} and leaving only "${tMultiRow?.assignees}".`,
                    rootCause: 'controller/userController/userController.js (assignTaskToUser lines 735-738) executes TaskAssignments.destroy({ where: { task_id: taskId } }), wiping every existing assignee on the task.'
                }
            );
            await ctx.api('cmB', 'DELETE', `manager/assigned-work-requests/tasks/${tMultiId}`);
            // Also try deleting as CM A if CM B couldn't (deleteTask requires WorkRequestManagers + !isDelegatedAway)
            await ctx.api('cmA', 'DELETE', `manager/assigned-work-requests/tasks/${tMultiId}`);
        }

        // 5. Complete T1, test duplicate pm-approve & pm-reject bad deadline & project_end_date while T_open exists
        const tOpenRes = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: 'Open Second Task', description: 'Keeps project open',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(9)
        });
        const tOpenId = tOpenRes.body?.data?.id;

        await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t1Id, work_request_id: wrId, task_count: 2 }, { documents: 'e1.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id] });

        // Test pm-reject with impossible deadline 2026-02-31
        const badPmRejDeadline = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id, deadline: '2026-02-31', comments: 'Bad deadline test', issue_register_ids: [meta.issueRegisterId]
        });
        ctx.check(
            'POST /work-requests/pm-reject rejects impossible deadline 2026-02-31 with 400 (not 500)',
            badPmRejDeadline.status === 400,
            `HTTP ${badPmRejDeadline.status} ${JSON.stringify(badPmRejDeadline.body)}`,
            {
                severity: 'Medium',
                area: 'Date Validation (pm-reject)',
                expected: 'pm-reject should validate deadline with parseDateOnly and return HTTP 400 for 2026-02-31.',
                actual: `POST /work-requests/pm-reject returned HTTP ${badPmRejDeadline.status} (${JSON.stringify(badPmRejDeadline.body)}).`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmRejectTask line 2355) passes req.body.deadline unvalidated to IssueAssignments.create.'
            }
        );

        // Approve T1 -> check admin projectsdetails project_end_date while T_open is still pending!
        const app1 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check('First pm-approve of T1 succeeds', app1.ok, `HTTP ${app1.status}`);

        // Duplicate pm-approve on already final_approved T1!
        const app2 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t1Id });
        ctx.check(
            'Duplicate pm-approve on already final_approved task is rejected (400/409)',
            app2.status === 400 || app2.status === 409,
            `HTTP ${app2.status}`,
            {
                severity: 'Low',
                area: 'Status Guard / Idempotency (pm-approve)',
                expected: 'Calling pm-approve on a task that is already approved + final_approved should be rejected (or no-op without writing duplicate history).',
                actual: `Second pm-approve returned HTTP ${app2.status} and appended duplicate pm_approved / pm_approved_task history entries.`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmApproveTask lines 1926-1938 and handleIssuePmApproval lines 2067-2073) checks only status === "completed" and not review_stage !== "final_approved".'
            }
        );

        // Check admin Projects grid while T_open is still pending (project is NOT completed!)
        const adminProjOpen = await ctx.getAdminRow('cmA', 'projectsdetails', projectName);
        const projOpenRow = (adminProjOpen.body?.data || []).find(r => r.work_request_id === wrId);
        ctx.check(
            'Open project (with pending T_open) does not show a finished project_end_date in Admin Projects grid',
            projOpenRow?.project_end_date === null || projOpenRow?.project_end_date === 'N/A',
            `status=${projOpenRow?.project_request_status} project_end_date=${projOpenRow?.project_end_date} fy=${projOpenRow?.fy} month=${projOpenRow?.month}`,
            {
                severity: 'Medium',
                area: 'Admin Dashboard / Project End Date',
                expected: 'While a project still has open/uncompleted tasks, project_end_date should be null/empty (just like fy="00" and month="00").',
                actual: `project_end_date showed "${projOpenRow?.project_end_date}" (from T1) even though T_open is still pending and project status is "${projOpenRow?.project_request_status}".`,
                rootCause: 'controller/adminController.js (getAdminData lines 1553-1576) computes project_end_date as MAX(end_date) across tasks/changes without checking if any live task/change has end_date IS NULL (unlike fy and month).'
            }
        );

        // 6. Test Project Cancellation on open project
        if (tOpenId) {
            const preview = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/${wrId}/cancel-preview`);
            ctx.check('Cancel preview returns valid breakdown', preview.ok && preview.body?.data?.can_cancel === true, `HTTP ${preview.status}`);

            const cancelBadReason = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/cancel`, { reason: 'no' });
            ctx.check('Cancel project rejects short reason (<5 chars) -> 400', cancelBadReason.status === 400, `HTTP ${cancelBadReason.status}`);

            const cancelOk = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/cancel`, { reason: 'Automated test cancellation verification' });
            ctx.check('Cancel project succeeds with valid reason', cancelOk.ok && cancelOk.body?.data?.project?.status === 'cancelled', `HTTP ${cancelOk.status}`);

            const writeAfterCancel = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
                work_request_id: wrId, task_name: 'After Cancel', request_type_id: meta.rtA,
                task_type_id: meta.ttAId, assigned_to_ids: [artA.id]
            });
            ctx.check('Cancelled project is read-only (creating task -> 400)', writeAfterCancel.status === 400, `HTTP ${writeAfterCancel.status}`);
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
