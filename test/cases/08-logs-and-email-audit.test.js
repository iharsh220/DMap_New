const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('08-logs-and-email-audit', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const cmA = ctx.user('cmA');
    const artA = ctx.user('artistA');

    const uniq = Date.now();
    const projectName = `TEST_WF8_LOGS_${uniq}`;
    let wrId = null;

    try {
        // 1. Create WR -> Update WR while pending -> Accept WR -> inspect work_request_history
        const initialDesc = `Initial description ${uniq}`;
        const updatedDesc = `Updated description ${uniq}`;
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-LogsMail',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: initialDesc,
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'low'
        }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup logs/mail project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        const updRes = await ctx.api('pmt', 'PUT', `work-requests/${wrId}`, makeForm({
            description: updatedDesc,
            priority: 'high'
        }));
        ctx.check('PMT updates pending work request', updRes.ok, `HTTP ${updRes.status}`);

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        // Check work_request_history after create + update + manager_accepted
        const parseMaybeJson = (v) => {
            if (typeof v !== 'string') return v;
            try { return JSON.parse(v); } catch { return v; }
        };
        const wrHist1 = await ctx.api('pmt', 'GET', `work-requests/history/${wrId}`);
        const wrHistRows1 = wrHist1.body?.data || [];
        const updHistEntry = wrHistRows1.find(h => h.action === 'resubmitted' || h.action === 'updated');
        const prevDataObj = parseMaybeJson(updHistEntry?.previous_data);
        ctx.check(
            'Work request "resubmitted/updated" history entry preserves old description & priority in previous_data (not post-update value)',
            !!updHistEntry && prevDataObj?.description === initialDesc && prevDataObj?.priority === 'low',
            `action=${updHistEntry?.action} prevDesc="${prevDataObj?.description}" prevPrio="${prevDataObj?.priority}"`,
            {
                severity: 'Low',
                area: 'Audit Log Integrity / Work Request Update History',
                expected: 'When a PMT updates a work request, work_request_history.previous_data should capture description & priority BEFORE update.',
                actual: `previous_data captured "${prevDataObj?.description}" / priority="${prevDataObj?.priority}" (already mutated to new values).`,
                rootCause: 'controller/workRequestController/workRequestController.js (updateWorkRequest line 495 calls await workRequest.update(updateData) before line 661 recordWorkRequestHistory({ previousData: workRequest })).'
            }
        );

        // 2. Create Task T1 -> accept -> submit -> manager rework -> resubmit -> manager approve -> share -> pm-reject -> V2
        const t1Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: `WF8_${uniq}_T1`, description: 'Audit log flow T1',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(7)
        });
        const t1Id = t1Res.body?.data?.id;

        const t2Res = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: `WF8_${uniq}_T2`, description: 'Audit log pm-approve T2',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(7)
        });
        const t2Id = t2Res.body?.data?.id;

        const tDelRes = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/tasks', {
            work_request_id: wrId, task_name: `WF8_${uniq}_TDEL`, description: 'Delete log check',
            request_type_id: meta.rtA, task_type_id: meta.ttAId, assigned_to_ids: [artA.id], deadline: plusDays(7)
        });
        const tDelId = tDelRes.body?.data?.id;

        if (!t1Id || !t2Id || !tDelId) {
            ctx.check('Setup tasks T1, T2, TDel created', false, JSON.stringify({ t1Id, t2Id, tDelId }));
            return ctx.summary();
        }

        // Delete TDel -> check whether work_request_history / task_history record accurate status & task history
        await ctx.api('cmA', 'DELETE', `manager/assigned-work-requests/tasks/${tDelId}`);
        const tDelHist = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/history/task/${tDelId}`);
        const tDelHistRows = tDelHist.body?.data || [];
        const tDelEntry = tDelHistRows.find(h => h.action === 'deleted');
        ctx.check(
            'Deleted task retains accessible task_history with action=deleted and previous_status -> new_status transition',
            tDelHist.ok && !!tDelEntry && !!tDelEntry.new_status,
            `HTTP ${tDelHist.status} rows=${tDelHistRows.length} delEntry=${JSON.stringify({ action: tDelEntry?.action, prev: tDelEntry?.previous_status, next: tDelEntry?.new_status })}`,
            {
                severity: 'Low',
                area: 'Audit Log Completeness / Task Delete History',
                expected: 'Soft-deleting a task should preserve/record task_history with previousStatus, newStatus ("deleted" or previous), and child issue delete logs.',
                actual: `HTTP ${tDelHist.status}, deletedEntry=${JSON.stringify(tDelEntry)}.`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (deleteTask lines 2905-2920) logs task_history without nextData/newStatus and does not write any issue_history entries for soft-deleted child issues.'
            }
        );

        // Full cycle on T1 + rework
        await ctx.api('artistA', 'PUT', `users/tasks/${t1Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t1Id, work_request_id: wrId, task_count: 2 }, { documents: 'wf8_t1_a.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'change_request', comments: 'Rework needed' });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t1Id, work_request_id: wrId, task_count: 3 }, { documents: 'wf8_t1_b.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t1Id, action: 'approved', comments: 'Approved after rework' });
        const shareT1 = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t1Id] });

        // Also complete & share T2, then pm-approve T2
        await ctx.api('artistA', 'PUT', `users/tasks/${t2Id}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: t2Id, work_request_id: wrId, task_count: 1 }, { documents: 'wf8_t2.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: t2Id, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [t2Id] });
        const pmAppT2 = await ctx.api('pmt', 'POST', 'work-requests/pm-approve', { task_id: t2Id });

        // Inspect T2 task_history on pm_approved -> check previous_review & previous_review_stage!
        const t2HistRes = await ctx.api('artistA', 'GET', `users/tasks/${t2Id}/history`);
        const t2HistRows = t2HistRes.body?.data || [];
        const t2PmAppEntry = t2HistRows.find(h => String(h.action || '').includes('pm_approved'));
        ctx.check(
            'Task history on pm-approve logs accurate previous_review_stage="pm_review" (not overwritten with "final_approved")',
            t2HistRes.ok && !!t2PmAppEntry && t2PmAppEntry.previous_review_stage === 'pm_review' && t2PmAppEntry.previous_review === 'approved' || (!!t2PmAppEntry && t2PmAppEntry.previous_review_stage === 'pm_review'),
            `action=${t2PmAppEntry?.action} prevReview=${t2PmAppEntry?.previous_review} -> newReview=${t2PmAppEntry?.new_review} | prevStage=${t2PmAppEntry?.previous_review_stage} -> newStage=${t2PmAppEntry?.new_review_stage}`,
            {
                severity: 'Medium',
                area: 'Audit Log Integrity / PM Approve History',
                expected: 'When PMT approves a task, task_history should record previous_review_stage="pm_review" and new_review_stage="final_approved".',
                actual: `previous_review_stage was logged as "${t2PmAppEntry?.previous_review_stage}" (same as new_review_stage="${t2PmAppEntry?.new_review_stage}").`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmApproveTask lines 1934 vs 1965-1985) calls await task.update(...) BEFORE recordTaskHistory, mutating task.review and task.review_stage in place first.'
            }
        );

        // PMT rejects T1 -> creates V2 -> check T1 task_history on pm-reject!
        const pmRejT1 = await ctx.api('pmt', 'POST', 'work-requests/pm-reject', {
            task_id: t1Id, comments: 'Please revise headline', issue_description: 'Headline tweak V2',
            issue_register_ids: [meta.issueRegisterId], deadline: plusDays(10)
        });
        const v2Id = pmRejT1.body?.data?.change_request_issue?.id;

        const t1HistUser = await ctx.api('artistA', 'GET', `users/tasks/${t1Id}/history`);
        const t1HistMgr = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/history/task/${t1Id}`);
        const t1Actions = (t1HistUser.body?.data || []).map(h => h.action);
        const reworkEntry = (t1HistUser.body?.data || []).find(h => h.action === 'manager_change_requested');
        const pmRejTaskEntry = (t1HistUser.body?.data || []).find(h => h.action === 'pm_rejected');

        ctx.check('Both user and manager task history endpoints return full lifecycle actions on T1',
            t1HistUser.ok && t1HistMgr.ok && (t1HistUser.body?.data || []).length >= 5 && (t1HistMgr.body?.data || []).length >= 5,
            `userRows=${t1HistUser.body?.data?.length} mgrRows=${t1HistMgr.body?.data?.length} actions=${t1Actions.join(',')}`);

        const reworkChanges = parseMaybeJson(reworkEntry?.changes);
        ctx.check(
            'Manager rework task_history entry has consistent new_review vs changes.review (no contradictory state)',
            !reworkEntry || !(reworkEntry.new_review === 'pending' && reworkChanges?.review === 'change_request'),
            `new_review=${reworkEntry?.new_review} changes=${JSON.stringify(reworkChanges)}`,
            {
                severity: 'Low',
                area: 'Audit Log Consistency / Manager Rework',
                expected: 'Task history and TaskReviewHistory should agree on whether review state became "change_request" or "pending".',
                actual: `task_history logged new_review="${reworkEntry?.new_review}" while changes.review="${reworkChanges?.review}" (and TaskReviewHistory logs action="change_request").`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (reviewTask lines 4027, 4062, 4121) updates task.review to "pending" while logging changes.review="change_request".'
            }
        );

        ctx.check(
            'Task history on pm-reject logs previous_status="completed" and previous_review_stage="pm_review" (not post-update values)',
            !!pmRejTaskEntry && pmRejTaskEntry.previous_status === 'completed' && pmRejTaskEntry.previous_review_stage === 'pm_review',
            `action=${pmRejTaskEntry?.action} prevStatus=${pmRejTaskEntry?.previous_status} newStatus=${pmRejTaskEntry?.new_status} prevStage=${pmRejTaskEntry?.previous_review_stage} newStage=${pmRejTaskEntry?.new_review_stage}`,
            {
                severity: 'Medium',
                area: 'Audit Log Integrity / PM Reject History',
                expected: 'When pm-reject moves a task from completed/pm_review to in_progress/change_requested, task_history should record previous_status="completed" and previous_review_stage="pm_review".',
                actual: `previous_status was logged as "${pmRejTaskEntry?.previous_status}" and previous_review_stage as "${pmRejTaskEntry?.previous_review_stage}".`,
                rootCause: 'controller/workRequestController/workRequestController.js (pmRejectTask lines 2415 vs 2429-2471) calls await task.update(nextTaskData) BEFORE recordTaskHistory, mutating task properties before logging previous values.'
            }
        );

        // 3. Test V2 issue flow + chained V3 via POST /issue-register/assignment passing ONLY issue_id (without task_id!)
        if (v2Id) {
            await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${v2Id}/accept`, {});
            const assignIss = await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', {
                issue_assignment_id: v2Id, user_id: artA.id, deadline: plusDays(10)
            });
            await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/accept`, { start_date: todayIst() });
            await ctx.api('artistA', 'PUT', `users/issues/${v2Id}/submit`, makeForm({ task_count: 2 }, { documents: 'wf8_v2.txt' }));
            await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { issue_id: v2Id, action: 'approved' });
            await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, issue_ids: [v2Id] });

            // Check V2 issue history (both user & manager endpoints)
            const v2HistUser = await ctx.api('artistA', 'GET', `users/issues/${v2Id}/history`);
            const v2HistMgr = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/history/issue/${v2Id}`);
            ctx.check('Both user and manager issue history endpoints record V2 lifecycle steps',
                v2HistUser.ok && v2HistMgr.ok && (v2HistUser.body?.data || []).length >= 5,
                `userRows=${v2HistUser.body?.data?.length} mgrRows=${v2HistMgr.body?.data?.length}`);

            // Chained V3 via issue-register/assignment passing ONLY issue_id (omitting task_id)
            const irV3 = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
                issue_id: v2Id,
                requested_by_user_id: pmt.id,
                assignment_type: 'mod',
                version: 'V3',
                description: 'Chained issue created with issue_id only',
                issue_register_ids: [meta.issueRegisterId]
            });
            const v3Id = irV3.body?.data?.id;
            const v3Hist = v3Id ? await ctx.api('cmA', 'GET', `manager/assigned-work-requests/history/issue/${v3Id}`) : null;
            const v3CreateEntry = (v3Hist?.body?.data || []).find(h => h.action === 'created');
            ctx.check(
                'issue-register/assignment with issue_id only logs non-null task_id in issue_history (derived from rootTaskId)',
                !!v3CreateEntry && v3CreateEntry.task_id === t1Id,
                `v3Id=${v3Id} task_id=${v3CreateEntry?.task_id} expectedTaskId=${t1Id} prevStage=${v3CreateEntry?.previous_review_stage}`,
                {
                    severity: 'Medium',
                    area: 'Audit Log Integrity / Issue Register Chained History',
                    expected: 'When creating V3 with only issue_id (no task_id in body), issue_history.task_id and work_request_history.related_task_id should log the resolved rootTaskId.',
                    actual: `issue_history.task_id=${v3CreateEntry?.task_id} (expected ${t1Id}) and previous_review_stage="${v3CreateEntry?.previous_review_stage}".`,
                    rootCause: 'controller/issueRegisterController/issueRegisterController.js (createIssueAssignment lines 263, 278, 294-297) reads req.body.task_id || null instead of rootTaskId and hardcodes previousReview="pending" / previousReviewStage="final_approved".'
                }
            );

            // Email check on shareForClientReview / assignIssueToUser / cancelWorkRequest
            ctx.check('POST /manager/assigned-work-requests/share-for-client-review exposes email_sent status cleanly',
                shareT1.ok && typeof shareT1.body?.data?.email_sent === 'boolean',
                `HTTP ${shareT1.status} email_sent=${shareT1.body?.data?.email_sent} email_error=${shareT1.body?.data?.email_error}`);

            ctx.check('POST /manager/assigned-work-requests/assign-issue-to-user returns delivery result (or non-error email metadata)',
                assignIss.ok,
                `HTTP ${assignIss.status} email_sent=${assignIss.body?.email_sent ?? assignIss.body?.data?.email_sent ?? 'not-reported'}`);
        }

        // Check Cancel Project + cancellation history + email_sent visibility
        const cancelRes = await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/cancel`, {
            reason: 'Verify cancellation logs and notification metadata'
        });
        const wrHistAfterCancel = await ctx.api('pmt', 'GET', `work-requests/history/${wrId}`);
        const cancelHistRow = (wrHistAfterCancel.body?.data || []).find(h => h.action === 'cancelled' || h.action === 'project_cancelled');
        const hasCancelNotifMeta = cancelRes.body?.data?.email_status !== undefined || cancelRes.body?.data?.email_sent !== undefined;
        ctx.check('Project cancellation writes cancelled audit history row and reports email_status',
            cancelRes.ok && !!cancelHistRow && hasCancelNotifMeta,
            `cancelHTTP=${cancelRes.status} histAction=${cancelHistRow?.action} email_status=${cancelRes.body?.data?.email_status}`);

        // Check whether ANY mail delivery audit / tracking endpoint or tracking metadata exists across workflow steps
        const mailAuditProbe = await ctx.api('cmA', 'GET', 'notifications/mail-logs');
        const hasMailTracking = mailAuditProbe.ok || (pmAppT2.body?.email_sent !== undefined);
        ctx.check(
            'System tracks email delivery status / audit logs (who received mail & when) across workflow steps including pm-approve/pm-reject',
            hasMailTracking,
            `mailLogsHTTP=${mailAuditProbe.status} pmApproveEmailField=${pmAppT2.body?.email_sent} pmRejectEmailField=${pmRejT1.body?.email_sent} assignEmailField=${t1Res.body?.email_sent} cancelEmailStatus=${cancelRes.body?.data?.email_status}`,
            {
                severity: 'High',
                area: 'Email Tracking & Workflow Mail Gaps',
                expected: 'Workflow steps (pm-approve, pm-reject, project auto-complete, issue-register creation) should trigger notifications to the right recipients AND record an email audit log (recipient, template, status, timestamp).',
                actual: `No mail audit endpoint/table exists (console-only BullMQ logs), and pm-approve, pm-reject, updateWorkRequest, createIssueAssignment, and workRequestCompletionService auto-completion send zero emails.`,
                rootCause: 'services/mailService.js logs only to console with zero DB persistence; pmApproveTask, handleIssuePmApproval, pmRejectTask, createIssueAssignment, and workRequestCompletionService never call sendMail (and submitIssue sends manager template to PMT while submitTask emails only WorkRequestManagers[0]).'
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
