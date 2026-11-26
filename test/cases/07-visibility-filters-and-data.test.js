const { TestContext, loadE2eConfig, discoverMetadata, makeForm, todayIst, plusDays } = require('../lib/client');

async function run() {
    const cfg = loadE2eConfig();
    const ctx = new TestContext('07-visibility-filters-and-data', cfg);
    await ctx.loginAll();
    const meta = await discoverMetadata(ctx);
    const pmt = ctx.user('pmt');
    const cmA = ctx.user('cmA');
    const artA = ctx.user('artistA');
    const cmB = ctx.user('cmB');
    const artB = ctx.user('artistB');

    const uniq = Date.now();
    const projectName = `TEST_WF7_VIS_${uniq}`;
    let wrId = null;

    try {
        // 1. Setup project & tasks covering every state + user + manager-self + delegated-self
        const wrRes = await ctx.api('pmt', 'POST', 'work-requests', makeForm({
            project_name: projectName,
            brand: 'UAT-Visibility',
            request_type_id: meta.rtA,
            project_id: meta.ptAId,
            description: 'Visibility, filters, manager self+team tasks, and data completeness tests',
            about_project: { output_devices: ['Desktop'], target_audience: ['Doctors'] },
            priority: 'high'
        }, { documents: 'wf7_brief.txt' }));
        wrId = wrRes.body?.data?.workRequest?.id;
        ctx.trackWorkRequest(wrId, 'cmA');
        if (!wrId) {
            ctx.check('Setup visibility test project created', false, `HTTP ${wrRes.status}`);
            return ctx.summary();
        }

        await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/${wrId}/accept`, {});

        const mkTask = async (actor, payload) => {
            const r = await ctx.api(actor, 'POST', 'manager/assigned-work-requests/tasks', {
                work_request_id: wrId,
                request_type_id: meta.rtA,
                task_type_id: meta.ttAId,
                ...payload
            });
            return { res: r, id: r.body?.data?.id };
        };

        // Artist A tasks across all states
        const tPend = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_A_PEND`, description: 'Pending task',
            assigned_to_ids: [artA.id], deadline: plusDays(7)
        })).id;

        const tProg = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_A_PROG`, description: 'In-progress task',
            assigned_to_ids: [artA.id], deadline: plusDays(5)
        })).id;

        const tMgrRev = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_A_MGRREV`, description: 'Submitted waiting manager review',
            assigned_to_ids: [artA.id], deadline: plusDays(6)
        })).id;

        const tPmRev = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_A_PMREV`, description: 'Shared waiting PM review',
            assigned_to_ids: [artA.id], deadline: plusDays(8)
        })).id;

        const tOverdue = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_A_OVERDUE`, description: 'Past deadline task',
            assigned_to_ids: [artA.id], deadline: plusDays(-2)
        })).id;

        // Manager CM A self-assigned tasks (pending + in_progress + completed)
        const tCmASelfPend = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_CMA_SELF_PEND`, description: 'CM A self pending',
            assigned_to_ids: [cmA.id], deadline: plusDays(7)
        })).id;

        const tCmASelfProg = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_CMA_SELF_PROG`, description: 'CM A self in_progress',
            assigned_to_ids: [cmA.id], deadline: plusDays(7)
        })).id;

        // Delegated tasks to CM B: one kept by CM B (delegated self), one reassigned to Artist B
        const tCmBDelegSelf = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_CMB_DELEG_SELF`, description: 'Delegated directly to CM B',
            request_type_id: meta.rtB, task_type_id: meta.ttBId,
            assigned_to_ids: [cmB.id], deadline: plusDays(7)
        })).id;

        const tArtBDeleg = (await mkTask('cmA', {
            task_name: `WF7_${uniq}_ART_B_DELEG`, description: 'Delegated to CM B -> Artist B',
            request_type_id: meta.rtB, task_type_id: meta.ttBId,
            assigned_to_ids: [cmB.id], deadline: plusDays(7)
        })).id;

        ctx.check('Setup created all visibility test tasks',
            !!(tPend && tProg && tMgrRev && tPmRev && tOverdue && tCmASelfPend && tCmASelfProg && tCmBDelegSelf && tArtBDeleg),
            JSON.stringify({ tPend, tProg, tMgrRev, tPmRev, tOverdue, tCmASelfPend, tCmASelfProg, tCmBDelegSelf, tArtBDeleg }));

        // Advance task states
        await ctx.api('artistA', 'PUT', `users/tasks/${tProg}/accept`, { start_date: todayIst() });

        await ctx.api('artistA', 'PUT', `users/tasks/${tMgrRev}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: tMgrRev, work_request_id: wrId, task_count: 2 }, { documents: 'mgrrev.txt' }));

        await ctx.api('artistA', 'PUT', `users/tasks/${tPmRev}/accept`, { start_date: todayIst() });
        await ctx.api('artistA', 'POST', 'users/tasks/submit', makeForm({ task_id: tPmRev, work_request_id: wrId, task_count: 3 }, { documents: 'pmrev.txt' }));
        await ctx.api('cmA', 'PUT', 'manager/assigned-work-requests/review', { task_id: tPmRev, action: 'approved' });
        await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/share-for-client-review', { work_request_id: wrId, task_ids: [tPmRev] });

        await ctx.api('cmA', 'PUT', `users/tasks/${tCmASelfProg}/accept`, { start_date: todayIst() });

        await ctx.api('cmB', 'POST', 'users/assign-task', { task_id: tArtBDeleg, user_id: artB.id, work_request_id: wrId, deadline: plusDays(7) });
        await ctx.api('artistB', 'PUT', `users/tasks/${tArtBDeleg}/accept`, { start_date: todayIst() });

        // Create 3 Change / Issue states for Artist A: u_pending, in_progress, completed
        const mkIssueForArtA = async (desc, acceptUser, submitUser) => {
            const ir = await ctx.api('pmt', 'POST', 'issue-register/assignment', {
                task_id: tPmRev, requested_by_user_id: pmt.id, assignment_type: 'mod', version: 'V2',
                description: desc, intimate_client: 1, issue_register_ids: [meta.issueRegisterId]
            });
            const iid = ir.body?.data?.id;
            if (!iid) return null;
            await ctx.api('cmA', 'PUT', `manager/assigned-work-requests/issue/${iid}/accept`, {});
            await ctx.api('cmA', 'POST', 'manager/assigned-work-requests/assign-issue-to-user', {
                issue_assignment_id: iid, user_id: artA.id, deadline: plusDays(9)
            });
            if (acceptUser) {
                await ctx.api('artistA', 'PUT', `users/issues/${iid}/accept`, { start_date: todayIst() });
            }
            if (submitUser) {
                await ctx.api('artistA', 'PUT', `users/issues/${iid}/submit`, makeForm({ task_count: 2, description: `${desc} done` }, { documents: `issue_${iid}.txt` }));
            }
            return iid;
        };

        const iPend = await mkIssueForArtA(`WF7_${uniq}_ISS_PEND`, false, false);
        const iProg = await mkIssueForArtA(`WF7_${uniq}_ISS_PROG`, true, false);
        const iDone = await mkIssueForArtA(`WF7_${uniq}_ISS_DONE`, true, true);
        ctx.check('Setup created 3 issue states (u_pending, in_progress, completed)', !!(iPend && iProg && iDone), JSON.stringify({ iPend, iProg, iDone }));

        // =========================================================================
        // A. USER OWN TASK & ISSUE VISIBILITY + ROLE ISOLATION
        // =========================================================================
        const artATasks = await ctx.api('artistA', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const artATaskIds = (artATasks.body?.data || []).map(t => t.id);
        ctx.check('Artist A sees all 5 own tasks across statuses and does NOT see Artist B or CM A self tasks',
            [tPend, tProg, tMgrRev, tPmRev, tOverdue].every(id => artATaskIds.includes(id))
            && !artATaskIds.includes(tArtBDeleg) && !artATaskIds.includes(tCmASelfPend),
            `ids=${artATaskIds.join(',')}`);

        const artBTasks = await ctx.api('artistB', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const artBTaskIds = (artBTasks.body?.data || []).map(t => t.id);
        ctx.check('Artist B sees only delegated Artist B task and not Artist A tasks',
            artBTaskIds.includes(tArtBDeleg) && !artBTaskIds.includes(tPend),
            `ids=${artBTaskIds.join(',')}`);

        const pmtTasks = await ctx.api('pmt', 'GET', 'users/tasks');
        ctx.check('PMT cannot call GET /users/tasks (403)', pmtTasks.status === 403, `HTTP ${pmtTasks.status}`);

        // Artist A GET /users/issues default (NO status query)
        const extractIssueIds = (body) => (body?.data || []).map(x => x?.issue?.id ?? x?.id).filter(Boolean);
        const artAIssDefault = await ctx.api('artistA', 'GET', 'users/issues');
        const artAIssDefaultIds = extractIssueIds(artAIssDefault.body);
        ctx.check(
            'Artist A default GET /users/issues (no status filter) returns active/completed issues too (not hardcoded to u_pending only)',
            artAIssDefaultIds.includes(iProg) && artAIssDefaultIds.includes(iDone),
            `found u_pending=${artAIssDefaultIds.includes(iPend)}, in_progress=${artAIssDefaultIds.includes(iProg)}, completed=${artAIssDefaultIds.includes(iDone)}, total=${artAIssDefaultIds.length}`,
            {
                severity: 'High',
                area: 'User Issue Visibility / Default Filter',
                expected: 'Calling GET /users/issues without a ?status= filter should return the user’s assigned issues across active/completed statuses, not silently hide accepted/in_progress/completed items.',
                actual: `Default GET /users/issues returned u_pending=${artAIssDefaultIds.includes(iPend)}, in_progress=${artAIssDefaultIds.includes(iProg)}, completed=${artAIssDefaultIds.includes(iDone)} (total=${artAIssDefaultIds.length}) because it forces status="u_pending" when status is omitted.`,
                rootCause: 'controller/userController/userController.js (getAssignedIssues line 2121): `else { whereCondition.status = "u_pending"; }` hides u_accepted, in_progress, and completed issues unless status is passed explicitly.'
            }
        );

        const artAMyTeam = await ctx.api('artistA', 'GET', 'users/my-team');
        ctx.check('Artist A sees own/team in-progress work in GET /users/my-team',
            artAMyTeam.ok && Array.isArray(artAMyTeam.body?.data),
            `HTTP ${artAMyTeam.status} count=${artAMyTeam.body?.data?.length}`);

        // =========================================================================
        // B. MANAGER SEES BOTH TEAM TASKS AND OWN SELF-ASSIGNED TASKS
        // =========================================================================
        const cmATasks = await ctx.api('cmA', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const cmATaskIds = (cmATasks.body?.data || []).map(t => t.id);
        ctx.check('CM A sees BOTH team tasks (Artist A) and own self-assigned tasks in GET /users/tasks',
            [tPend, tProg, tMgrRev, tPmRev, tOverdue, tCmASelfPend, tCmASelfProg].every(id => cmATaskIds.includes(id)),
            `found=${cmATaskIds.length} ids=${cmATaskIds.join(',')}`);

        const cmASelfOnly = await ctx.api('cmA', 'GET', `users/tasks?assigned_to=self&search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const cmASelfIds = (cmASelfOnly.body?.data || []).map(t => t.id);
        ctx.check('CM A GET /users/tasks?assigned_to=self returns ONLY CM A self-assigned tasks (excludes Artist A team tasks)',
            cmASelfIds.includes(tCmASelfPend) && cmASelfIds.includes(tCmASelfProg) && !cmASelfIds.includes(tPend) && !cmASelfIds.includes(tProg),
            `selfIds=${cmASelfIds.join(',')}`);

        // Manager dedicated self-tasks endpoint: GET /manager/assigned-work-requests/my-tasks
        const myTasksDefault = await ctx.api('cmA', 'GET', 'manager/assigned-work-requests/my-tasks');
        const myTasksProg = await ctx.api('cmA', 'GET', 'manager/assigned-work-requests/my-tasks?status=in_progress');
        const hasSelfPend = (myTasksDefault.body?.data || []).some(t => t.id === tCmASelfPend);
        const hasSelfProg = (myTasksProg.body?.data || []).some(t => t.id === tCmASelfProg);
        ctx.check('CM A sees self-assigned tasks in GET /manager/assigned-work-requests/my-tasks (pending default & status=in_progress)',
            hasSelfPend && hasSelfProg,
            `hasSelfPend=${hasSelfPend} hasSelfProg=${hasSelfProg}`);

        // Delegated manager CM B self-assigned task under ?assigned_to=self!
        const cmBAll = await ctx.api('cmB', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const cmBSelf = await ctx.api('cmB', 'GET', `users/tasks?assigned_to=self&search=${encodeURIComponent(`WF7_${uniq}`)}&searchFields=task_name&limit=50`);
        const cmBAllIds = (cmBAll.body?.data || []).map(t => t.id);
        const cmBSelfIds = (cmBSelf.body?.data || []).map(t => t.id);
        ctx.check(
            'Delegated manager (CM B) sees delegated self-assigned task in GET /users/tasks?assigned_to=self',
            cmBAllIds.includes(tCmBDelegSelf) && cmBSelfIds.includes(tCmBDelegSelf),
            `allHasDeleg=${cmBAllIds.includes(tCmBDelegSelf)} selfFilterHasDeleg=${cmBSelfIds.includes(tCmBDelegSelf)}`,
            {
                severity: 'High',
                area: 'Manager Self Tasks / Delegated Task Filter',
                expected: 'When CM B is directly assigned a delegated task on CM A’s project, ?assigned_to=self should still return that task alongside CM B’s own projects.',
                actual: `allHasDeleg=${cmBAllIds.includes(tCmBDelegSelf)}, selfFilterHasDeleg=${cmBSelfIds.includes(tCmBDelegSelf)}.`,
                rootCause: 'controller/userController/userController.js (getAssignedTasks lines 53-63, 224-226): assigned_to=self queries WorkRequestManagers and applies work_request_id IN selfWorkRequestIds, filtering out delegated tasks on projects managed by another manager.'
            }
        );

        // Also check GET /manager/assigned-work-requests/my-tasks for CM B delegated self-task
        const cmBMyTasks = await ctx.api('cmB', 'GET', 'manager/assigned-work-requests/my-tasks');
        const cmBHasMyTask = (cmBMyTasks.body?.data || []).some(t => t.id === tCmBDelegSelf);
        ctx.check('CM B sees delegated self-assigned task in GET /manager/assigned-work-requests/my-tasks',
            cmBHasMyTask,
            `HTTP ${cmBMyTasks.status} found=${cmBHasMyTask}`);

        // Manager Team Tasks & Team List checks
        const cmAMyTeam = await ctx.api('cmA', 'GET', 'manager/assigned-work-requests/my-team?page=1&limit=1');
        const myTeamGroups = cmAMyTeam.body?.data || [];
        const myTeamUsers = myTeamGroups.flatMap(g => g.teamMembers || []);
        const containsManagerSelf = myTeamUsers.some(u => u.id === cmA.id);
        const respectsLimit1 = myTeamUsers.length <= 1;
        ctx.check(
            'GET /manager/assigned-work-requests/my-team returns only creative subordinates (not self) and respects pagination limit=1',
            cmAMyTeam.ok && !containsManagerSelf && respectsLimit1 && !!cmAMyTeam.body?.pagination,
            `returnedMembers=${myTeamUsers.length} containsSelf=${containsManagerSelf} hasPagination=${!!cmAMyTeam.body?.pagination} roles=${[...new Set(myTeamUsers.map(u => u.jobRole))].join(',')}`,
            {
                severity: 'Low',
                area: 'Manager My-Team Endpoint / Pagination & Role Filtering',
                expected: 'my-team should exclude the manager themselves, list creative subordinates only (roles 3/4), and honor paginationMiddleware limit/page.',
                actual: `Returned ${myTeamUsers.length} members for limit=1; containsManagerSelf=${containsManagerSelf}; pagination=${JSON.stringify(cmAMyTeam.body?.pagination)}.`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (getMyTeam lines 2504-2508) has id != manager_id and job_role_id IN [3,4] commented out, and the handler never applies req.pagination.'
            }
        );

        const cmAArtATasks = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/user/${artA.id}/tasks?status=in_progress`);
        const artATaskList = cmAArtATasks.body?.data?.tasks || [];
        const firstArtATask = artATaskList.find(t => t.id === tProg) || artATaskList[0];
        ctx.check(
            'GET /manager/assigned-work-requests/user/:user_id/tasks populates workRequest object on each task',
            cmAArtATasks.ok && !!firstArtATask && firstArtATask.workRequest !== null && !!firstArtATask.workRequest?.project_name,
            `HTTP ${cmAArtATasks.status} tasks=${artATaskList.length} workRequest=${JSON.stringify(firstArtATask?.workRequest)}`,
            {
                severity: 'Medium',
                area: 'Manager Team Member Tasks / Broken Association Mapping',
                expected: 'getUserTask should include workRequest project metadata (id, project_name, brand, status) on every task.',
                actual: `workRequest is null on returned task(s) (${artATaskList.length} tasks checked).`,
                rootCause: 'controller/managerAssignedController/managerAssignedController.js (getUserTask lines 3261-3275, 3369-3374) reads taskData.WorkRequests (plural) instead of Sequelize’s taskData.WorkRequest (singular).'
            }
        );

        // =========================================================================
        // C. COMPREHENSIVE FILTER, SEARCH & PAGINATION TESTS
        // =========================================================================
        const prefixSearch = `WF7_${uniq}`;

        // C1. GET /users/tasks individual filters
        const fPend = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&status=pending&limit=50`);
        const fPendList = fPend.body?.data || [];
        ctx.check('Filter GET /users/tasks?status=pending returns only pending tasks',
            fPendList.some(t => t.id === tPend) && fPendList.every(t => t.status === 'pending'),
            `count=${fPendList.length} statuses=${[...new Set(fPendList.map(t => t.status))].join(',')}`);

        const fProg = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&status=in_progress&limit=50`);
        const fProgList = fProg.body?.data || [];
        ctx.check('Filter GET /users/tasks?status=in_progress returns only in_progress tasks',
            fProgList.some(t => t.id === tProg) && fProgList.every(t => t.status === 'in_progress'),
            `count=${fProgList.length} statuses=${[...new Set(fProgList.map(t => t.status))].join(',')}`);

        const fComp = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&status=completed&limit=50`);
        const fCompList = fComp.body?.data || [];
        ctx.check('Filter GET /users/tasks?status=completed returns only completed tasks (T_MgrRev & T_PmRev)',
            fCompList.some(t => t.id === tMgrRev) && fCompList.some(t => t.id === tPmRev) && fCompList.every(t => t.status === 'completed'),
            `count=${fCompList.length}`);

        const fMgrRev = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&review_stages=manager_review&limit=50`);
        const fMgrRevList = fMgrRev.body?.data || [];
        ctx.check('Filter GET /users/tasks?review_stages=manager_review returns T_MgrRev and excludes T_PmRev',
            fMgrRevList.some(t => t.id === tMgrRev) && !fMgrRevList.some(t => t.id === tPmRev),
            `ids=${fMgrRevList.map(t => t.id).join(',')}`);

        const fPmRev = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&review_stages=pm_review&limit=50`);
        const fPmRevList = fPmRev.body?.data || [];
        ctx.check('Filter GET /users/tasks?review_stages=pm_review returns T_PmRev and excludes T_MgrRev',
            fPmRevList.some(t => t.id === tPmRev) && !fPmRevList.some(t => t.id === tMgrRev),
            `ids=${fPmRevList.map(t => t.id).join(',')}`);

        // C2. Combined search + status=overdue bug!
        const fOverdueSearch = await ctx.api('artistA', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}_ART_A_OVERDUE`)}&searchFields=task_name&status=overdue&limit=50`);
        const fOverdueList = fOverdueSearch.body?.data || [];
        const everyMatchesUnique = fOverdueList.length > 0 && fOverdueList.every(t => String(t.task_name || '').includes(`WF7_${uniq}_ART_A_OVERDUE`));
        ctx.check(
            'Combined filter GET /users/tasks?search=...&status=overdue preserves the search query (does not clobber Op.or)',
            fOverdueSearch.ok && everyMatchesUnique,
            `returned=${fOverdueList.length} allMatchSearch=${everyMatchesUnique} names=${fOverdueList.slice(0, 3).map(t => t.task_name).join(' | ')}`,
            {
                severity: 'High',
                area: 'Task Filters / Search + Overdue Clobber',
                expected: 'Passing ?search=... together with ?status=overdue should AND both conditions (overdue tasks matching the search term).',
                actual: `Returned ${fOverdueList.length} tasks and allMatchSearch=${everyMatchesUnique} because status=overdue overwrites whereCondition[Op.or] created by searchMiddleware.`,
                rootCause: 'controller/userController/userController.js (getAssignedTasks lines 124-177, 210-219) sets whereCondition[Op.or] for search, then status==="overdue" reassigns whereCondition[Op.or] instead of pushing into Op.and.'
            }
        );

        // C3. GET /users/tasks?limit=1&page=1 when task has 3 IssueAssignments (hasMany join bug)
        const fLimitOne = await ctx.api('artistA', 'GET', `users/tasks?search=${encodeURIComponent(`WF7_${uniq}_ART_A_PMREV`)}&searchFields=task_name&page=1&limit=1`);
        const fLimitAll = await ctx.api('artistA', 'GET', `users/tasks?search=${prefixSearch}&searchFields=task_name&page=1&limit=1`);
        ctx.check('GET /users/tasks?page=1&limit=1 returns at most 1 task row cleanly',
            fLimitOne.ok && (fLimitOne.body?.data || []).length <= 1 && (fLimitAll.body?.data || []).length <= 1,
            `len1=${fLimitOne.body?.data?.length} lenAll=${fLimitAll.body?.data?.length} totalItems=${fLimitAll.body?.pagination?.totalItems}`);

        // C4. GET /users/issues filter + pagination + search checks
        const issPend = await ctx.api('artistA', 'GET', 'users/issues?status=u_pending');
        const issProg = await ctx.api('artistA', 'GET', 'users/issues?status=in_progress');
        const issDone = await ctx.api('artistA', 'GET', 'users/issues?status=completed');
        const issPendIds = extractIssueIds(issPend.body);
        const issProgIds = extractIssueIds(issProg.body);
        const issDoneIds = extractIssueIds(issDone.body);
        ctx.check('Filter GET /users/issues?status=u_pending/in_progress/completed separates Artist A issues cleanly',
            issPendIds.includes(iPend) && !issPendIds.includes(iProg)
            && issProgIds.includes(iProg) && !issProgIds.includes(iDone)
            && issDoneIds.includes(iDone),
            `u_pending=${issPendIds.length}(has=${issPendIds.includes(iPend)}) in_progress=${issProgIds.length}(has=${issProgIds.includes(iProg)}) completed=${issDoneIds.length}(has=${issDoneIds.includes(iDone)})`);

        const issPage1 = await ctx.api('artistA', 'GET', 'users/issues?status=u_pending&page=1&limit=1');
        const issAllStatus = await ctx.api('artistA', 'GET', 'users/issues?status=in_progress&page=1&limit=1');
        ctx.check(
            'GET /users/issues supports pagination metadata (limit/page)',
            !!issPage1.body?.pagination && (issPage1.body?.data || []).length <= 1 && (issAllStatus.body?.data || []).length <= 1,
            `hasPagination=${!!issPage1.body?.pagination} lenPend=${issPage1.body?.data?.length} lenProg=${issAllStatus.body?.data?.length}`,
            {
                severity: 'Low',
                area: 'User Issues Pagination & Search',
                expected: 'GET /users/issues mounts paginationMiddleware, so it should slice by limit/offset and return pagination metadata (plus support search).',
                actual: `pagination field is ${JSON.stringify(issPage1.body?.pagination)} and IssueAssignments.findAll ignores req.pagination (returned ${issAllStatus.body?.data?.length} rows for limit=1); searchMiddleware is also not mounted.`,
                rootCause: 'controller/userController/userController.js (getAssignedIssues lines 2125, 2313-2318) ignores req.pagination and never returns pagination; routes/userRoutes/userRoutes.js line 39 omits filterMiddleware and searchMiddleware.'
            }
        );

        // C5. GET /work-requests/my-requests filters (status, search, artist_id, sort_by, limit)
        const wrSearch = await ctx.api('pmt', 'GET', `work-requests/my-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name&status=accepted`);
        ctx.check('PMT GET /work-requests/my-requests filters by search + status=accepted',
            wrSearch.ok && (wrSearch.body?.data || []).some(w => w.id === wrId),
            `HTTP ${wrSearch.status} count=${wrSearch.body?.data?.length}`);

        const wrWrongStatus = await ctx.api('pmt', 'GET', `work-requests/my-requests?search=${encodeURIComponent(projectName)}&searchFields=project_name&status=completed`);
        ctx.check('PMT GET /work-requests/my-requests?status=completed excludes open accepted project',
            wrWrongStatus.ok && !(wrWrongStatus.body?.data || []).some(w => w.id === wrId),
            `HTTP ${wrWrongStatus.status} count=${wrWrongStatus.body?.data?.length}`);

        const wrByArtist = await ctx.api('pmt', 'GET', `work-requests/my-requests?artist_id=${artA.id}&search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        ctx.check('PMT GET /work-requests/my-requests?artist_id=... finds project assigned to Artist A',
            wrByArtist.ok && (wrByArtist.body?.data || []).some(w => w.id === wrId),
            `HTTP ${wrByArtist.status} count=${wrByArtist.body?.data?.length}`);

        const wrByOtherArtist = await ctx.api('pmt', 'GET', `work-requests/my-requests?artist_id=999999&search=${encodeURIComponent(projectName)}&searchFields=project_name`);
        ctx.check('PMT GET /work-requests/my-requests?artist_id=999999 returns 0 projects cleanly (no 500)',
            wrByOtherArtist.ok && (wrByOtherArtist.body?.data || []).length === 0,
            `HTTP ${wrByOtherArtist.status} count=${wrByOtherArtist.body?.data?.length}`);

        // C6. Manager filters: /manager/assigned-work-requests, /requests, /issue-assignments, /issue-register/assignments
        const mgrAccFilter = await ctx.api('cmA', 'GET', `manager/assigned-work-requests?status=accepted&search=${encodeURIComponent(projectName)}&searchFields=project_name&sort_by=deadline&order=asc`);
        ctx.check('CM A GET /manager/assigned-work-requests?status=accepted&search=... returns WR cleanly',
            mgrAccFilter.ok && (mgrAccFilter.body?.data || []).some(w => w.id === wrId),
            `HTTP ${mgrAccFilter.status} count=${mgrAccFilter.body?.data?.length}`);

        const mgrRequests = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/requests?status=accepted&limit=20`);
        ctx.check('CM A GET /manager/assigned-work-requests/requests?status=accepted works cleanly',
            mgrRequests.ok && Array.isArray(mgrRequests.body?.data),
            `HTTP ${mgrRequests.status} count=${mgrRequests.body?.data?.length}`);

        const mgrIssFilter = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/issue-assignments?status=in_progress&limit=50`);
        ctx.check('CM A GET /manager/assigned-work-requests/issue-assignments?status=in_progress finds I_Prog and excludes I_Pend/I_Done',
            mgrIssFilter.ok && (mgrIssFilter.body?.data || []).some(i => i.id === iProg)
            && !(mgrIssFilter.body?.data || []).some(i => i.id === iPend || i.id === iDone),
            `HTTP ${mgrIssFilter.status} count=${mgrIssFilter.body?.data?.length}`);

        const irList = await ctx.api('pmt', 'GET', `issue-register/assignments?task_id=${tPmRev}&limit=20`);
        const irIssueIds = (irList.body?.data || []).flatMap(g => (g.issues || []).map(i => i.id));
        ctx.check('PMT GET /issue-register/assignments?task_id=... returns all 3 V2 issues for task',
            irList.ok && [iPend, iProg, iDone].every(id => irIssueIds.includes(id)),
            `HTTP ${irList.status} groups=${irList.body?.data?.length} issueIds=${irIssueIds.join(',')}`);

        // =========================================================================
        // D. DATA COMPLETENESS CHECK ACROSS APIs & ADMIN GRIDS
        // =========================================================================
        const linked = await ctx.getLinkedProject('cmA', wrId);
        const linkedProj = linked.body?.data?.project;
        const linkedTasks = linked.body?.data?.tasks || [];
        const tPmLinked = linkedTasks.find(t => t.id === tPmRev);
        const badLinkedRows = [];
        for (const t of linkedTasks) {
            if (!t.task_name || !t.status) badLinkedRows.push(`task#${t.id} missing core`);
            if (t.status === 'completed' && (!t.start_date || !t.end_date || !(Number(t.task_count) > 0))) {
                badLinkedRows.push(`task#${t.id} completed missing dates/count`);
            }
            for (const c of (t.changes || [])) {
                if (!c.version || !c.status) badLinkedRows.push(`change#${c.id} missing core`);
                if (c.assignees && String(c.assignees).toLowerCase().includes(pmt.name.trim().toLowerCase())) {
                    badLinkedRows.push(`change#${c.id} leaked PMT in assignees`);
                }
            }
        }
        ctx.check('Linked project API returns complete, well-formed project/task/issue data',
            linked.ok && !!linkedProj && linkedTasks.length === 9 && badLinkedRows.length === 0 && (tPmLinked?.changes || []).length === 3,
            `tasks=${linkedTasks.length} changesOnPmRev=${tPmLinked?.changes?.length} bad=${JSON.stringify(badLinkedRows)}`);

        // Admin grid data completeness checks
        const adminProj = await ctx.getAdminRow('cmA', 'projectsdetails', projectName);
        const projRow = (adminProj.body?.data || []).find(r => r.work_request_id === wrId);
        // Expected project page counts: completed task tMgrRev(2) + tPmRev(3) + completed issue iDone(2) = 5 task pages + 2 issue pages (unless tOverdue/etc.)
        ctx.check('Admin projectsdetails grid shows accurate aggregated counts & non-null metadata for WR',
            adminProj.ok && !!projRow && Number(projRow.task_count) === 9 && Number(projRow.task_no_of_work_pages) === 5 && Number(projRow.issue_no_of_work_pages) === 2,
            JSON.stringify({
                http: adminProj.status,
                tasks: projRow?.task_count,
                taskPages: projRow?.task_no_of_work_pages,
                issuePages: projRow?.issue_no_of_work_pages,
                pmtName: projRow?.pmt_name,
                cmName: projRow?.creative_manager_name
            }));

        const adminTasks = await ctx.getAdminRow('cmA', 'taskdetails', `WF7_${uniq}`);
        if (adminTasks.status === 403) {
            ctx.check('Admin taskdetails grid skipped (requires Super Admin role)', true, 'HTTP 403 adminOnly');
        } else {
            const taskRows = adminTasks.body?.data || [];
            const pmRevAdminRow = taskRows.find(r => r.task_id === tPmRev);
            const delegAdminRow = taskRows.find(r => r.task_id === tArtBDeleg);
            ctx.check('Admin taskdetails grid returns WF7 tasks with manager, creative user, count, and dates',
                adminTasks.ok && taskRows.length >= 9 && !!pmRevAdminRow?.assigned_creative_user && Number(pmRevAdminRow?.task_no_of_work_pages) === 3 && !!delegAdminRow?.task_manager,
                JSON.stringify({ http: adminTasks.status, rows: taskRows.length, pmRevUser: pmRevAdminRow?.assigned_creative_user, pmRevPages: pmRevAdminRow?.task_no_of_work_pages, delegMgr: delegAdminRow?.task_manager }));
        }

        const adminIssues = await ctx.getAdminRow('cmA', 'issuedetails', `WF7_${uniq}_ART_A_PMREV`);
        if (adminIssues.status === 403) {
            ctx.check('Admin issuedetails grid skipped (requires Super Admin role)', true, 'HTTP 403 adminOnly');
        } else {
            const issRows = adminIssues.body?.data || [];
            const doneIssRow = issRows.find(r => r.issue_id === iDone);
            ctx.check('Admin issuedetails grid returns WF7 issues with non-null task_manager, version, task_count, and dates',
                adminIssues.ok && issRows.length >= 3 && !!doneIssRow && Number(doneIssRow.issue_no_of_work_pages) === 2 && !!doneIssRow.issue_start_date && !!doneIssRow.issue_end_date && doneIssRow.change_version === 'V2' && !!doneIssRow.task_manager && doneIssRow.task_manager !== 'N/A',
                JSON.stringify({ http: adminIssues.status, rows: issRows.length, donePages: doneIssRow?.issue_no_of_work_pages, start: doneIssRow?.issue_start_date, end: doneIssRow?.issue_end_date, ver: doneIssRow?.change_version, mgr: doneIssRow?.task_manager, cu: doneIssRow?.assigned_creative_user }),
                {
                    severity: 'Medium',
                    area: 'Admin Dashboard / Issue Details Data',
                    expected: 'Admin issuedetails grid should return completed changes with issue_no_of_work_pages, issue_start_date, issue_end_date, and assigned user/manager.',
                    actual: `rows=${issRows.length}, doneIssRow=${JSON.stringify(doneIssRow)}.`,
                    rootCause: 'controller/adminController.js (getIssueDetailsData lines 4429-5050).'
                });
        }

        const overviewRes = await ctx.api('cmA', 'GET', `datatable/admin/overview/data?fresh=${Date.now()}`);
        ctx.check('Admin overview dashboard data loads without 500 or missing KPI object',
            overviewRes.ok && !!overviewRes.body?.data,
            `HTTP ${overviewRes.status} keys=${Object.keys(overviewRes.body?.data || {}).slice(0, 6).join(',')}`);
    } finally {
        await ctx.cleanup();
    }

    return ctx.summary();
}

module.exports = { run };
if (require.main === module) {
    run().then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.failed ? 1 : 0); });
}
