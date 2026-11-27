# D-Map live production test: BACKEND errors

API `https://alembicdigilabs.in/digilabs/dmap/api` + production DB. Found on 2026-11-27 (steps in [TEST.md](TEST.md)).

| ID | Endpoint / area | Sev | What happens | Expected | Where in code | Step |
|---|---|---|---|---|---|---|
| B-01 | `POST /auth/login` | Low | The response `user` contains `latest_verification_token` (set for Artist A2, 153 chars); the app saves it in localStorage | Leave it out of the login / profile response | `controller/authController/login.js` (user object sent as is) | 0.2 |
| B-02 | `POST /work-requests` history | Low | `work_request_history` row `created` has `previous_status` / `new_status` = null | `new_status = 'pending'` | `workRequestController.createWorkRequest` (recordWorkRequestHistory call) | 1.4 |
| B-03 | `GET /work-requests/:id` | Medium | Returns 404 "Work request not found" to the project's own manager (CM A on #3015); confirmed live, same as yesterday's suite | Manager of the request gets 200 | `workRequestController.getWorkRequestById` ~line 1039: the second `findOne` uses `where: { id, user_id }` (creator only) | 1.6 |
| B-04 | Project status when work starts | Medium | Artist accepts the first task (task `in_progress`), but `work_requests.status` stays `accepted` until the 00:01 cron | Project → `in_progress` when its first task/change starts (owner to confirm) | `userController.acceptTask` / `acceptIssue` do not touch the work request | 1.14 |
| B-05 | `PUT /manager/assigned-work-requests/review` (rework) history | Low | `task_history.new_review = 'pending'` while `changes.review = 'change_request'`; the task row keeps `review = 'pending'` | One consistent value | `managerAssignedController.reviewTask` change_request branch | 1.19 |
| B-06 | `GET /users/issues?search=` | Medium | The `search` text is ignored; artist search "TEST_LIVE_2711TEST_LIVE_2711" still returns the unrelated change "Frontend - World Diabetes Day Doctor Video" | Filter by task / project name | `userController.getAssignedIssues` (no search handling) | 1.15 |
| B-07 | `POST /issue-register/assignment` task history | Low | Task history `change_request_created` logs stage `final_approved → change_requested`, but the task was `pm_review` and stays `pm_review` in the DB | Log the real previous stage, and the stage the task really gets | `issueRegisterController.createIssueAssignment` (hard-coded previous stage) | 1.24 |
| B-08 | `/uploads/*` | Medium | Uploaded files (briefs, outputs, PMT attachments) are downloadable without login by anyone who has the URL | Serve through a token check, or signed URLs | `routes/indexRoute.js` static `/uploads` | 1.25 |
| B-09 | Change assignment keeps the PMT file on the artist's row | High | When the manager assigns a change, the `issue_user_assignments` row that holds the PMT attachment is given to the artist (`user_id` 68 → 66). From then on every API returns the PMT file as the artist's document: listed twice for the artist, shown as an OUTPUT to the manager, offered (and pre-ticked) in Share, and sent back to the PMT as the output | Keep client attachments apart from artist outputs (e.g. leave the PMT row as is and create a new row for the artist, or filter `uploaded_by = 'pmt'` out of outputs/share) | `managerAssignedController.assignIssueToUser` (row reuse); `utils/issueAssignees.js` only hides rows whose `user_id` is the requester | 1.32–1.36 |
| B-11 | Delegated manager's project views | High | CM B (task delegated to him on #3017) does not get the project in `GET /manager/assigned-work-requests`, and `GET /manager/assigned-work-requests/work-request/3017/tasks` returns 404 | Include projects where the caller is a task manager (`isTaskManager` / `taskManagerSql`) | `managerAssignedController.getAssignedWorkRequests` and `getTasksByWorkRequestId` check only `work_request_managers` | 2.5 |
| B-12 | `GET /users/tasks` for the delegating manager | Medium | After delegation CM A (owner rule: may view) no longer finds the task in her task list; she sees it only in the project's task list | List delegated tasks read-only for the creator | `userController.getAssignedTasks` | 2.7 |
| B-13 | `POST /work-requests/pm-approve` history | Medium | `task_history` `pm_approved` has `previous_review = new_review = approved` and `previous_review_stage = new_review_stage = final_approved` (task #3769) | Before = `pending` / `pm_review` | `workRequestController.pmApproveTask`: `task.update()` runs before `recordTaskHistory` | 2.10 |
| B-14 | Status-less history rows | Low | `work_request_history` rows `created`, `manager_deferred`, `manager_deferred_reassigned`, `resubmitted` and `task_history` `deleted` store `previous_status` / `new_status` = null | Store the status before / after | `historyService` callers in createWorkRequest, deferWorkRequest, updateWorkRequest, deleteTask | 1.4, 3.2, 4.6 |
| B-15 | `POST /manager/assigned-work-requests/tasks` | Medium | A deadline in the past (2026-11-20) is accepted (task 3774) | 400 for deadlines before today (the UI calendar already blocks them) | `managerAssignedController.createTask` validates only the format | 4.3 |
| B-16 | `GET /manager/assigned-work-requests/:id/assignable-users` `activeTasks` | Medium | Counts soft-deleted tasks and tasks of deleted projects (Kiran: 8 shown, 6 of them `is_deleted = 1`), so managers see wrong workload | Count only `tasks.is_deleted = 0` on live projects | `managerAssignedController.getAssignableUsers` (TaskAssignments → Tasks include has no `is_deleted` filter) | 5.8 |
| B-18 | `POST /auth/refresh-token` after logout | Medium | The refresh token still returns 200 after `POST /auth/logout` | Blacklist / revoke the refresh token on logout | `controller/authController/logout.js` blacklists only the access token; `refreshToken.js` does not check a blacklist | 7.5 |
| B-19 | `GET /users/tasks?search=…&status=overdue` | High | For managers the search is dropped when `status=overdue`: a search that matches nothing returns 12 (CM A) / 21 (CM B) unrelated overdue tasks | Combine search and overdue with `Op.and` | `userController.getAssignedTasks` overwrites `whereCondition[Op.or]` | 8.1 |
| B-20 | `GET /manager/assigned-work-requests?limit=-1` | Medium | 500 "Something went wrong" | `limit=-1` = all rows, as in the other lists | `managerAssignedController.getAssignedWorkRequests` (Sequelize `LIMIT -1`) | 8.2 |
| B-21 | `GET /users/issues` pagination | Low | `limit=1` returns 6 rows, no `pagination` object | Honour `page`/`limit` and add `pagination` | `userController.getAssignedIssues` | 8.3 |
| B-22 | `GET /manager/assigned-work-requests/user/:user_id/tasks` | Medium | `workRequest` is null on every task (25/25 for user 20) | Project data on each task | `managerAssignedController.getUserTask` reads `WorkRequests` instead of `WorkRequest` | 8.4 |
| B-23 | Production data | Medium | 83 change requests without change types (ids 1577–1676), 39 changes with the PMT file on the artist's row, 35 PMT files already shared back as output, 32 projects `accepted` with work in progress, 11 open tasks without deadline | Data-fix migration after the code fixes (B-04, B-09) | audit in TEST.md section 9 | 9 |

## Fix status (2026-11-27, in code, verified on the local dump copy, NOT deployed yet)
| ID | Status | Fix |
|---|---|---|
| B-01 | Fixed | `latest_verification_token` removed from login, refresh and profile (and from the token payload) |
| B-02 | Fixed | `created` history row has `new_status` pending / draft |
| B-03 | Fixed | `GET /work-requests/:id` loads by id after the access check (managers 200) |
| B-04 | Fixed | Task / change accepted with start today → project `accepted/assigned → in_progress` at once, history `work_started` (cron stays as fallback) |
| B-05 | Fixed | Rework history `changes` = real before/after + `manager_action` (tasks and changes) |
| B-06 | Fixed | `GET /users/issues?search=` filters on change description, task name, project name |
| B-07 | Fixed | Change-created history logs the real review / stage; change history always has `task_id` |
| B-08 | Open (owner: later, with the frontend) | — |
| B-09 | Fixed | Assigning a change creates the artist's own row; the PMT row and files stay the PMT's; share and rework never include / delete PMT files |
| B-11 | Fixed | Manager list + project task list include projects with a task delegated to the caller (`managerProjectIdsSql`) |
| B-12 | Fixed | Manager team view of `/users/tasks` also lists tasks of projects they manage (delegated ones) |
| B-13 | Fixed | pm-approve history keeps the values before approval; a repeated approval writes nothing |
| B-14 | Fixed | Status before/after on created, defer, transfer, resubmit, delete, update history; deleting a task writes a `deleted_with_task` row per live change |
| B-15 | Fixed | createTask: 400 "Deadline cannot be before today" |
| B-16 | Fixed | `activeTasks` counts only live tasks of live projects |
| B-18 | Fixed | Logout revokes the user's refresh tokens (Redis `refresh-revoked-before:<id>`, tokens now carry `iat`) |
| B-19 | Fixed | Overdue filter AND-ed with the search (`/users/tasks` and `/users/issues`) |
| B-20 | Fixed | `limit=-1` = all rows on the manager list and `/users/tasks` |
| B-21 | Fixed | `/users/issues` honours page/limit (newest first) and returns `pagination`; alert count over all matches |
| B-22 | Fixed | `workRequest` filled on `user/:id/tasks` |
| B-23 | Migration written, not run | `migrations/fix_live_test_2026_11_27.sql` (re-runnable): PMT files back to the PMT row and not shared, projects stuck in accepted → in_progress, open tasks without end date; all with history rows. The 83 changes without types cannot be recovered |
| Extra | Fixed | Task accept without start_date always starts today (was NULL with a past deadline); manager task list adds status / pages / dates |

Verification: `node scripts/e2e/fixes-2711.e2e.js` 57/57; workflow 89, data-rules 30, date-rules 31, project-cancel 43, pmt-list 15, master-data 73 all pass; old vs new JSON on 21 calls identical except the intended changes; migration run twice on the local copy (2 / 5 / 40 / 3 rows fixed, second run no change, no document lost).
