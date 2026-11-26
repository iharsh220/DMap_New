# D-Map UAT Test Report & Known Issues

**Generated:** 2026-11-26  
**Target Environment:** UAT HTTP API (`E2E_API_TARGET` from `env.e2e.download`)  
**Scope:** End-to-end API testing across 8 suites (`test/cases/01`–`08`) plus static audit of audit-history logging and email triggers/templates. **Zero application source files were modified.**

---

## 1. Executive Summary & Test Scoreboard

**Overall UAT Run (`node test/run.js`):** **166 / 203 checks passed**, **37 failed**, **37 findings logged** -> [`test/results/latest.json`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/results/latest.json)

| Suite | Focus Area | Passed | Failed | Total |
| :--- | :--- | :---: | :---: | :---: |
| [`01-project-and-task-lifecycle.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/01-project-and-task-lifecycle.test.js) | PMT request -> Manager accept & assign -> Artist V1 rework -> PM approve -> Auto-complete | 23 | 2 | 25 |
| [`02-changes-issues-and-versions.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/02-changes-issues-and-versions.test.js) | PM reject -> V2 -> V3 -> Cancel V4, `task_count` on issues, `V1` version guards | 16 | 3 | 19 |
| [`03-cross-manager-delegation.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/03-cross-manager-delegation.test.js) | Cross-team delegation (e.g. Video Framer: Web CM A + Sister CM B -> Artist B) | 17 | 5 | 22 |
| [`04-task-count-and-date-validations.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/04-task-count-and-date-validations.test.js) | Mandatory `task_count >= 1`, `start_date`, `end_date`, `start_date <= end_date`, invalid dates | 58 | 4 | 62 |
| [`05-completion-and-reopen.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/05-completion-and-reopen.test.js) | Auto-completion across multiple items & re-opening `completed` projects | 10 | 3 | 13 |
| [`06-edge-cases-access-and-data.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/06-edge-cases-access-and-data.test.js) | Edge cases, RBAC, duplicate `pm-approve`, multi-assignee overwrite, admin date reporting, cancel | 6 | 7 | 13 |
| [`07-visibility-filters-and-data.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/07-visibility-filters-and-data.test.js) | User/manager task & issue visibility (team + self), filters, pagination, data completeness | 30 | 6 | 36 |
| [`08-logs-and-email-audit.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/08-logs-and-email-audit.test.js) | History audit trails (`work_request_history`, `task_history`, `issue_history`) & mail tracking | 6 | 7 | 13 |
| **TOTAL** | | **166** | **37** | **203** |

---

## 2. Critical & High-Severity Issues Found (Live UAT + Code Root Causes)

### 2.1 Cross-Manager Delegation Visibility & Review 404s (6 Failures — Suites 03 & 07)
When Manager A accepts a project (e.g. Video Framer) and delegates a task to Manager B (another vertical's manager), Manager B and Manager A lose expected visibility and permissions:
1. **CM B cannot see the project in manager dashboard list** (`Suite 03`, FAIL): `GET /manager/assigned-work-requests` returned `found=false`.  
   - **Root Cause:** [`managerAssignedController.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/controller/managerAssignedController/managerAssignedController.js) (`getAssignedWorkRequests` line 455) inner-joins `work_request_managers` (`where: { manager_id }`), excluding delegated managers who are only linked via `task_assignments` / `task_history`.
2. **CM B gets HTTP 404 on project task list** (`Suite 03`, FAIL): `GET /manager/assigned-work-requests/work-request/:id/tasks` returned `HTTP 404 Work request not found or not assigned to you`.  
   - **Root Cause:** `getTasksByWorkRequestId` (line 2128) checks only `WorkRequestManagers` instead of using `accessService`.
3. **CM A loses delegated task from `GET /users/tasks` once CM B assigns it to Artist B** (`Suite 03`, FAIL): Before reassignment CM A sees the task, after CM B calls `/users/assign-task` for Artist B, CM A sees `false` in `GET /users/tasks` (though CM A can still open `/users/tasks/:id` directly).
4. **CM B gets HTTP 404 when reviewing delegated task or change documents** (`Suite 03`, 2 FAILs): `reviewTaskDocument` (`HTTP 404 Document not found or not assigned to you`) and `reviewIssueDocument` (`HTTP 404 Issue document not found or not assigned to you`). Both check `WorkRequestManagers` ownership instead of delegated task/issue ownership.
5. **CM B loses delegated self-assigned task when filtering `GET /users/tasks?assigned_to=self`** (`Suite 07`, FAIL): `allHasDeleg=true`, `selfFilterHasDeleg=false`.  
   - **Root Cause:** [`userController.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/controller/userController/userController.js) (`getAssignedTasks` lines 53–63, 224–226) fetches `WorkRequestManagers` and restricts `work_request_id IN selfWorkRequestIds`, filtering out tasks assigned directly to CM B on projects owned by CM A. (Meanwhile `GET /manager/assigned-work-requests/my-tasks` DOES return it.)

---

### 2.2 Project Status & Re-open Transitions (`accepted` vs `in_progress`) (4 Failures — Suites 01 & 05)
1. **Creating a task on a `completed` project sets status to `accepted` instead of `in_progress`** (`Suite 05`, 2 FAILs):  
   - Creating Task 3 after completion sets `work_requests.status = "accepted"`, and even after the artist accepts Task 3 (`task.status = "in_progress"`), `work_requests.status` remains `"accepted"`.  
   - **Root Cause:** `createTask` (line 1968 in `managerAssignedController.js`) resets completed projects to `'accepted'` instead of `'in_progress'`, and `acceptTask` in `userController.js` never promotes `'accepted'` -> `'in_progress'`.
2. **Starting any V1 task leaves `work_requests.status = 'accepted'` until midnight cron** (`Suite 01`, FAIL): When an artist accepts a task with `start_date = today`, `task.status` becomes `'in_progress'`, but `work_requests.status` stays `'accepted'` until the `00:01` cron in `taskSchedulerService.js`.
3. **`pm-reject` on a `completed` project does NOT reopen the project** (`Suite 05`, FAIL): Calling `POST /work-requests/pm-reject` on a task/issue belonging to a `completed` project reopened the task to `in_progress` and created `V2`, while leaving `work_requests.status = "completed"`.

---

### 2.3 Date & `start_date <= end_date` Validation Bugs (5 Failures — Suites 04 & 06)
1. **Completed task with `start_date = NULL` allowed on past-deadline tasks** (`Suite 04`, 2 FAILs): When a task's `deadline` is in the past and the artist accepts it without sending `start_date`, `acceptTask` leaves `start_date: null` (`status: 'accepted'`), and `submitTask` still lets the task finish with `status: 'completed', start_date: null, end_date: '2026-11-26'`.
2. **Impossible calendar date `'2026-02-31'` throws HTTP 500 instead of HTTP 400** (3 FAILs across `Suite 04` & `Suite 06`):
   - `PUT /manager/assigned-work-requests/tasks/:id` -> **HTTP 500** (`Failed to update task`)
   - `POST /issue-register/assignment` -> **HTTP 500** (`Failed to create issue assignment`)
   - `POST /work-requests/pm-reject` -> **HTTP 500** (`Failed to reject task or issue by PM`)
   - (Contrast: `createTask` and `admin` edit properly validate and return `400`.)

---

### 2.4 Change/Issue Version & Workflow Guards (`V1` Allowed on Changes) (3 Failures — Suites 02 & 06)
1. **`POST /issue-register/assignment` allows `version: "V1"`** (`Suite 02`, FAIL — returned `HTTP 201, version="V1"`). Business rule requires changes/issues to start at `V2+` (`V1` is reserved for the base task).
2. **`POST /work-requests/pm-reject` allows overriding `version: "V1"`** (`Suite 02`, FAIL — returned `HTTP 200, version="V1"`).
3. **`POST /issue-register/assignment` allows raising changes on an unsubmitted `pending` task** (`Suite 06`, FAIL — returned `HTTP 201` on a task not yet completed or shared).

---

### 2.5 User & Manager Visibility, Filters & Broken Fields (6 Failures — Suite 07 + Code Audit)
1. **Default `GET /users/issues` (without `?status=`) hides `in_progress` and `completed` issues** (`Suite 07`, High, FAIL): Observed `u_pending=true, in_progress=false, completed=false (total=2)`.  
   - **Root Cause:** `userController.js` (`getAssignedIssues` line 2121) has `else { whereCondition.status = 'u_pending'; }`, silently hiding accepted, in-progress, and completed issues unless `?status=` is supplied.
2. **Combined `?search=...&status=overdue` on `GET /users/tasks` clobbers the search filter** (`Suite 07`, High, FAIL): Searching `WF7_<ts>_ART_A_OVERDUE` with `status=overdue` returned **13 unrelated overdue tasks** across other projects (`allMatchSearch=false`).  
   - **Root Cause:** `getAssignedTasks` (lines 124–177, 210–219) overwrites `whereCondition[Op.or]` instead of combining with `Op.and`.  
   - **Code-verified companion bugs in `getAssignedTasks`:** `?status=overdue&review=approved` overwrites `review`; `isManager` checks only `jobRole.id === 2` (excludes Role 3 Creative Lead); `Tasks.findAll` joins `hasMany` (`TaskDependencies`, `IssueAssignments`) without `separate: true`; `totalNotificationAlert` counts current page only; task counts omit `is_deleted: 0`.
3. **`GET /manager/assigned-work-requests/user/:user_id/tasks` returns `workRequest: null` on every task** (`Suite 07`, Medium, FAIL): Checked 13 tasks (`tasks=13, workRequest=null`).  
   - **Root Cause:** [`managerAssignedController.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/controller/managerAssignedController/managerAssignedController.js) (`getUserTask` lines 3261–3275, 3369–3374) reads `taskData.WorkRequests` (plural) instead of Sequelize's `taskData.WorkRequest` (singular).
4. **`GET /manager/assigned-work-requests/my-team` includes the manager themselves and ignores pagination** (`Suite 07`, Low, FAIL): With `?page=1&limit=1`, returned all `6` division members including manager CM A (`containsSelf=true, roles=4,2, hasPagination=false`).  
   - **Root Cause:** `getMyTeam` (lines 2504–2508) has `id != manager_id` and `job_role_id IN [3, 4]` commented out and never applies `req.pagination`.
5. **`GET /users/issues` ignores pagination & lacks search/filter middleware** (`Suite 07`, Low, FAIL): Even though `userRoutes.js` line 39 mounts `paginationMiddleware`, `getAssignedIssues` returns `pagination: undefined` and returns >1 rows for `?limit=1` (`lenPend=2, lenProg=2`), `sort` is unused, and `ta.User.id` lacks a null guard.
6. **`GET /manager/assigned-work-requests/my-tasks` lacks standard list middlewares**: Does not mount `filterMiddleware`, `paginationMiddleware`, or `searchMiddleware`; accepts only `['pending','accepted','in_progress','completed']` (no `overdue`/`cancelled`/`rejected`).

---

### 2.6 Other Medium / Low Functional & Data Bugs (Suites 01, 02, 06)
| Finding | Observed Result | Location / Root Cause |
| :--- | :--- | :--- |
| **`pm-reject` leaves stale `end_date` on reopened task** (Medium) | Task `status=in_progress` still holds `end_date="2026-11-26"` (`Suite 02`, FAIL) | `workRequestController.js` (`pmRejectTask` lines 2407–2413, 2516–2522) |
| **`GET /work-requests/:id` blocks assigned manager** (Medium) | Returns `HTTP 404 Work request not found` for CM A (`Suite 06`, FAIL) | `workRequestController.js` (`getWorkRequestById` lines 1031–1039 queries with caller `user_id`) |
| **`GET /manager/assigned-work-requests/work-request/:id/tasks` drops task status/count/dates** (Medium) | Returns only `id, task_name, deadline, ...` (`Suite 06`, FAIL) | `managerAssignedController.js` (`getTasksByWorkRequestId` lines 2128, 2194–2207) |
| **Multi-assignee reassignment wipes co-assignee** (Medium) | Assigning CM B's share to Artist B deleted Artist A (`Suite 06`, FAIL) | `userController.js` (`assignTaskToUser` lines 735–738 destroys all `TaskAssignments` for `task_id`) |
| **Open project shows finished `project_end_date` in Admin Projects grid** (Medium) | Pending `T_open` exists (`fy=00, month=00`) yet `project_end_date="2026-11-26"` (`Suite 06`, FAIL) | `adminController.js` (`getAdminData` lines 1553–1576 uses `MAX(end_date)` without open-task check) |
| **Duplicate `pm-approve` is idempotent-unsafe** (Low) | Second `pm-approve` returns `HTTP 200` and duplicates history (`Suite 06`, FAIL) | `workRequestController.js` (`pmApproveTask` lines 1926–1938, `handleIssuePmApproval` 2067–2073) |
| **Auto-completed project shows `project_completion_timestamp="N/A"`** (Low) | `Projects grid` searches `action='completed'` instead of `'auto_completed'` (`Suite 01`, FAIL) | `adminController.js` (`getAdminData` lines 1828, 1844, 1859, 1881, 1900) |
| **`issuedetails/data` search behavior** (Note) | Searches `task_name`, NOT issue `description` or `project_name` (`Suite 07` verified) | `adminController.js` (`getIssueDetailsData`) — once searched by `task_name`, data (`version`, `pages`, `dates`, `task_manager`, `assigned_creative_user`) populated properly |

---

## 3. Audit Logs & History Tracking Analysis (Suite 08 — Live UAT + Code Audit)

Workflow history endpoints (`GET /work-requests/history/:id`, `GET /users/tasks/:id/history`, `GET /manager/assigned-work-requests/history/task/:id`, `GET /users/issues/:id/history`, `GET /manager/assigned-work-requests/history/issue/:id`) work and capture full step sequences (e.g. `created -> accepted -> submitted -> manager_change_requested -> submitted -> manager_approved -> shared_for_client_review -> pm_rejected`), **HOWEVER 6 live UAT log integrity bugs + infrastructure gaps were confirmed:**

1. **`pm-approve` overwrites `previous_review_stage` before logging** (`Suite 08`, Medium, FAIL):  
   - **Observed:** `action=pm_approved | prevReview=approved -> newReview=approved | prevStage=final_approved -> newStage=final_approved`.  
   - **Root Cause:** `workRequestController.js` (`pmApproveTask` line 1934) awaits `task.update(...)` BEFORE `recordTaskHistory` (lines 1965–1985), mutating `task.review_stage` in memory first.
2. **`pm-reject` overwrites `previous_status`, `previous_review`, `previous_review_stage` and `previous_data` before logging** (`Suite 08`, Medium, FAIL):  
   - **Observed:** `action=pm_rejected | prevStatus=in_progress -> newStatus=in_progress | prevStage=change_requested -> newStage=change_requested` (should log `completed` / `pm_review` as `previous_*`).  
   - **Root Cause:** `pmRejectTask` (`workRequestController.js` lines 2415 & 2524) runs `.update()` BEFORE `recordTaskHistory`/`recordIssueHistory`.
3. **Chained Issue (`issue-register/assignment` with `issue_id` only, no `task_id`) logs `task_id = null`** (`Suite 08`, Medium, FAIL):  
   - **Observed:** Creating V3 with only `issue_id` wrote `issue_history.task_id=null` (expected `3807`) and `previous_review_stage="null"`.  
   - **Root Cause:** [`issueRegisterController.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/controller/issueRegisterController/issueRegisterController.js) (`createIssueAssignment` lines 263, 278, 294–297) reads `req.body.task_id || null` instead of `rootTaskId`, and in the task update path skips `Tasks.update` / hardcodes `previousReviewStage: 'final_approved'`.
4. **Work request `resubmitted` history (`PUT /work-requests/:id`) captures post-update values in `previous_data`** (`Suite 08`, Low, FAIL):  
   - **Observed:** Updating description `"Initial..." -> "Updated..."` and priority `"low" -> "high"` recorded `prevDesc="Updated description ..."` and `prevPrio="high"` inside `previous_data`.  
   - **Root Cause:** `workRequestController.js` (`updateWorkRequest` line 495) updates `workRequest` BEFORE calling `recordWorkRequestHistory` (line 661).
5. **Manager rework (`reviewTask`) logs contradictory review state** (`Suite 08`, Low, FAIL):  
   - **Observed:** `task_history` recorded `new_review="pending"` while `changes={"review":"change_request", "review_stage":"manager_review", "status":"in_progress"}` (and `TaskReviewHistory` logs `action="change_request"`).
6. **Task soft-delete logs incomplete metadata & misses child issue logs** (`Suite 08`, Low, FAIL):  
   - **Observed:** `DELETE /manager/assigned-work-requests/tasks/:id` logged `action="deleted", previous_status=null, new_status=null`. Code audit (`managerAssignedController.js:2905-2920`, `2804`, `adminController.js:543, 645-686`) confirms soft-deleting tasks/work-requests omits child `issue_history` / `task_history` entries, `adminController.updateIssue` passes `workRequestId: null`, and admin deletes write zero history.
7. **API Request/Response Logging Middleware Disabled** (**Code-Verified**): [`server.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/server.js) lines 82–87 have `loggingMiddleware` (and `rateLimitMiddleware`) commented out, so API access/error audit logs are not being shipped by `middleware/loggingMiddleware.js`.

---

## 4. Email Pipeline, Recipients, Triggers & Tracking Audit

> **Verification Boundary Note:** Live UAT HTTP tests verified API response flags (`email_sent`, `email_status`) and confirmed **404 / absence of any mail-log API endpoint** (`Suite 08`, FAIL). Because direct SMTP/Redis inspection is out of scope over HTTP, exact recipient, trigger, and template mismatches below are established via static inspection of [`services/mailService.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/services/mailService.js), all 20 `sendMail()` call sites, and all 21 HTML templates under [`email-templates/`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/email-templates).

### 4.1 Complete Email Tracking & Infrastructure Issues
- **No Email Delivery Tracking / Audit Log (High — Live UAT + Code Verified):**  
  `mailService.js` pushes jobs into BullMQ `mail-queue` (Redis, 5 retry attempts) and logs ONLY to server stdout (`console.log` `✅`/`❌`). If Redis is down, `sendMail` silently returns `null`. There is **no DB table or admin/API view** storing who received which mail, when it was sent, or SMTP errors (except `pm_review_reminder_history` for the disabled/prod-only daily reminder cron).  
  Over HTTP, only `share-for-client-review` (`email_sent: true`), `assign-issue-to-user` (`email_sent: true`), and `cancel` (`email_status: "queued"`) expose delivery metadata in responses.

### 4.2 Email Trigger Matrix (Who Gets Mail, When, and Where It Fails)

| Workflow Event | Expected Recipient(s) | Current Behavior & Template | Status / Bug |
| :--- | :--- | :--- | :--- |
| **Auth: Verify / Reset / Complete** | Registering / resetting user | `emailVerification`, `passwordReset`, `registrationSuccess` | **Template Bug:** `registrationSuccess.html` has **0 `{{...}}` placeholders** (unlike `registrationSuccess copy.html`), ignoring passed `user_name`/`user_email` (`completeRegistration.js:76`) |
| **PMT creates Work Request** | PMT + Vertical Managers | `workRequestUserConfirmation` -> PMT; `workRequestManagerNotification` -> managers | Wired (`workRequestController.js:319, 367`) |
| **PMT updates Work Request** | Assigned Manager(s) | *No `sendMail` call* | **MISSING MAIL** (`updateWorkRequest`) |
| **Manager accepts Work Request** | PMT | `workRequestAcceptanceNotification` (`managerAssignedController.js:1378`) | Wired |
| **Manager defers / transfers WR** | PMT / Target Manager | `workRequestDeferNotification` (:1534); `workRequestTransferNotification` (:1672) | **Bug:** line 1658 accesses `user.Division?.title` instead of `user.Divisions` |
| **Manager assigns / reassigns Task** | Assigned User / Delegated Manager | `taskAssignmentNotification` (`managerAssignedController.js:2047`, `userController.js:837`) | Wired |
| **User submits Task (`V1`)** | Primary Manager + **Delegated Manager (CM B)** | `taskCompletionNotification` (`userController.js:1672`) | **Wrong/Incomplete Recipients:** sends ONLY to `workRequest.WorkRequestManagers[0].manager`; misses co-managers and delegated managers (CM B) |
| **Manager reviews Task/Issue** | Assigned User | `taskReviewNotification` (`managerAssignedController.js:4093, 4366`) | Wired for rework & approval |
| **Manager shares for Client Review** | PMT | `clientReviewNotification` (`managerAssignedController.js:4830`) — returns `email_sent: true` | **Bug:** attachment links use `${BACKEND_URL}/${doc.document_path}` -> **double slash** (`//`) because `document_path` begins with `/` (`BASE_ROUTE`) |
| **PMT calls `pm-approve`** | Manager(s) + Assigned Artist(s) | *No `sendMail` call* | **MISSING MAIL (High)** (`pmApproveTask` & `handleIssuePmApproval`) |
| **Project Auto-Completes on final `pm-approve`** | PMT + Manager(s) | `workRequestCompletionService.js` sends **0 mails** (`workRequestCompletionNotification.html` is only used in manual `completeAllTasksAndIssues` at line 6225) | **MISSING MAIL (High)** |
| **PMT calls `pm-reject` (V2+)** | Manager(s) + Artist | *No `sendMail` call* | **MISSING MAIL (High)** (`pmRejectTask`) |
| **PMT calls `issue-register/assignment`** | Manager(s) | *No `sendMail` call* | **MISSING MAIL (High)** (`createIssueAssignment`) |
| **Manager accepts / cancels / assigns Issue** | PMT / User | `issueAcceptanceNotification` (:4963), `issueCancellationNotification` (:5186), `issueAssignmentNotification` (:6004) | Wired (`assign-issue-to-user` returns `email_sent: true`) |
| **User submits Issue (`V2+`)** | Task/Issue Manager(s) (incl. CM B) | `userController.js:2869` mails `issueRequester` (**PMT!**) with template `issueAssignmentNotification` (`assigned_by = PMT`) | **Critical Mail Bugs (3):** (1) Wrong recipient (PMT instead of Manager) & wrong template (`issueAssignmentNotification`); (2) misses delegated manager CM B; (3) `task.TaskType` not queried so `task_type` falls back to `'Issue'`/`'N/A'` |
| **Manager cancels Project** | PMT + Involved Team | `projectCancelled` (`projectCancellationService.js:272`) — returns `email_status: "queued"` | Wired |

---

## 5. Features & Rules Verified Passing Cleanly on UAT

- **PMT -> Manager -> Artist Happy Path & Rework (`Suite 01`):** Creating, accepting, task `V1` assignment, submission (`task_count >= 1`, `start_date`, `end_date`), rework clearing `end_date`, sharing gate before `pm-approve`, and auto-completion (`166` total checks passed).
- **`task_count` Validation (`Suite 04`):** Missing, empty, `0`, `"0"`, negative, decimal, text, and `>100000` values are consistently rejected with HTTP 400 across task submit, issue submit, complete-all, and admin edit.
- **Core Date Ordering (`Suite 04`):** Yesterday `start_date`, invalid formats, future `end_date`, and `start_date > end_date` are blocked with HTTP 400 across accept, submit, and admin edits.
- **Issue Assignment Security & V2->V3 Chaining (`Suite 02` & `07`):** PMT cannot be assigned as issue assignee (403) and is hidden from `assignedUsers`; rejecting `V2` properly chains `V3` (`issue_id = V2`); cancelling `V4` restores `V3`.
- **User & Manager Core Views (`Suite 07`):** Artist A/B isolate each other's tasks cleanly; CM A sees BOTH team tasks and own self-assigned tasks (`GET /users/tasks`, `?assigned_to=self`, and `/manager/assigned-work-requests/my-tasks`); `projectsdetails/data`, `taskdetails/data`, `issuedetails/data`, `linked/project/:id`, and `overview/data` return clean aggregated metrics.
- **Project Cancellation (`Suite 06` & `08`):** Short cancellation reason (<5 chars) blocked (400); valid cancel updates status to `cancelled`, blocks subsequent writes (400), writes `cancelled` history with item summary, and queues cancellation email.

---

## 6. Test Artifacts Created (No Application Source Modified)

- Runner: [`test/run.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/run.js) (`node test/run.js`)
- UAT HTTP Client & Cleanup Helper: [`test/lib/client.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/lib/client.js)
- Suites:
  - [`test/cases/01-project-and-task-lifecycle.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/01-project-and-task-lifecycle.test.js)
  - [`test/cases/02-changes-issues-and-versions.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/02-changes-issues-and-versions.test.js)
  - [`test/cases/03-cross-manager-delegation.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/03-cross-manager-delegation.test.js)
  - [`test/cases/04-task-count-and-date-validations.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/04-task-count-and-date-validations.test.js)
  - [`test/cases/05-completion-and-reopen.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/05-completion-and-reopen.test.js)
  - [`test/cases/06-edge-cases-access-and-data.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/06-edge-cases-access-and-data.test.js)
  - [`test/cases/07-visibility-filters-and-data.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/07-visibility-filters-and-data.test.js)
  - [`test/cases/08-logs-and-email-audit.test.js`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/cases/08-logs-and-email-audit.test.js)
- Latest JSON Result Dump: [`test/results/latest.json`](file:///e:/Projects/Alembic%20Projects/Digilabs/DMap_New/test/results/latest.json)
