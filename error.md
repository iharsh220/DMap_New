# D-Map Consolidated Error Log (UAT API + Production Browser Testing)

**Compiled:** 2026-11-27  
**Sources:**
1. Automated UAT Backend API Suites (`test/cases/01`–`08`, target `E2E_API_TARGET` from `env.e2e.download`) -> **166 / 203 passed, 37 failed** (`test/results/latest.json`).
2. Static Code & Email/Logging Audit (`services/mailService.js`, 20 `sendMail` callers, 21 HTML templates, `server.js`).
3. Live Production Browser UI & Network Testing (`https://dmap.alembicdigilabs.com/`, API Base `https://alembicdigilabs.in/digilabs/dmap/api`) — **Stages 1 (PMT), 2 (CM A), and 3A (CM B & Artist B)** completed before Stage 3B stopped due to agent quota (`429`) / server restart.  
   > **Note on Production Test Record:** Dummy test project **`TEST_PROD_CHECK_1795709950000`** (**Work Request ID `3014`**, Tasks **`3764`**, **`3765`**, **`3766`**) created during Stage 1/2 was not cleaned up by Stage 3B due to the quota interruption; it may still need manual cancellation/soft-deletion on Production.
4. **Local Code Fix Applied (2026-11-27):** Fixed the `reviewTask` delegation access check (`"This task was delegated to another manager; only that manager can review its changes"`) in `services/accessService.js` and `controller/managerAssignedController/managerAssignedController.js` — see Section 4 below.

---

## 1. Live Production Browser UI, Console & Network Errors (`https://dmap.alembicdigilabs.com/`)

### 1.1 Login Page (Unauthenticated)
1. **Production Debug Credential Leak in Console:** `index-CgcRDJ3H.js:335:105451` prints `console.log("Login Details:", [object Object])` (3 times on load/autofill).
2. **Form Accessibility Warnings:** 2 inputs lack associated `<label>` elements and `autocomplete="current-password"`.

### 1.2 Stage 1 — PMT (`sandesh.pujari@alembic.co.in`)
3. **Uncaught JS Crash on `PENDING` Tab Click:** Clicking `PENDING` throws `Uncaught ReferenceError: setActiveFilter is not defined` (`index-CgcRDJ3H.js:337:32171`), keeping `IN PROGRESS` cards rendered under `?tab=pending`. Navigating directly to `/dashboard/pmt/projects?tab=pending` also ignores `tab=pending` and fetches `status=in_progress`.
4. **Uncaught JS Crash When Clearing Search:** Clearing the search box throws `Uncaught ReferenceError: activeFilter is not defined` (`index-CgcRDJ3H.js:337:31208` via `setTimeout`), leaving the list stuck on the old search result even after pressing Enter or selecting Filter `All`.
5. **`My Team` Project Click Throws HTTP 403 + Wrong Refresh Retry + Broken Screen:** Clicking a team project calls `GET /api/work-requests/2945` -> **HTTP 403 Forbidden** (`"You do not have access to this work request"`). Axios interceptor misinterprets `403` as expired auth, calls `POST /api/auth/refresh-token` (`200`), retries `403` again, and renders a broken screen titled `"sd"`, `"REQUESTED ON: Invalid Date"`, `"DEADLINE: Project Acceptance Pending"`.
6. **`Review Pending By Client` Filter Returns Wrong & Cancelled Projects:** Returns taskless projects (`Tasks: []`) and `status: "cancelled"` project `2246` (`DMap Project management tool`); badge shows `2` while `5` cards render; deadline on `2446` changes from `02 Dec 2026` to `06 Nov 2026`.
7. **Badge Count Mismatch & Copy Bug:** `IN PROGRESS` badge shows `8` while `3` projects render (`2` under filter); empty state reads `"Tap on NEW button to raise a new request a new project"`.
8. **Completed Tasks Shown as In-Progress & Overdue:** On `/dashboard/projectstatus/2338` (`Live Polling v02`), all 5 tasks have `status: "completed"` yet display `inprogress-icon.svg` and `"Overdue by 84/79/64 days"`; shows raw `"STATUS: IN_PROGRESS"` and `"Deadline: Project Acceptance Pending"` despite `project_deadline` being set; fires `GET /api/work-requests/:id` **3 duplicate times** on mount.
9. **No Edit or History UI in PMT View:** Pending WR `3014` only shows `"Mark as Cancel"` in the 3-dot menu (no Edit/Update, no History log/drawer); `D Map Sprint 4` (`2446`) `OUTPUT` tab displays a legacy UAT link (`https://uatdmap.alembicdigilabs.com/dashboard`).
10. **Form, Profile & Sidebar Bugs:** `"How planned is your request?"` dropdown placeholder reads `"Select project type"`; Activity `ACTIVE` tab shows expired `"World Heart Day"` (`29 Oct 2026`); `/dashboard/completedwork` mixes `cancelled` project `2246` (`status=completed,%20cancelled`) with grammar error `"Task not assign yet"`; MR list shows scientific-notation phone `"1.23124E+11"`; Apply Leave defaults today's leave to `"Planned"` (`24h ahead` rule), exposes editable `"Checker remark"`, and duplicates reasons (`"Feeling not well"` / `"Not feeling well"`); sidebar wraps/overlaps `"My Team"` and collapses to `"D"`.

### 1.3 Stage 2 — Creative Manager A (`kiran.thekootu@alembic.co.in`)
11. **Uncaught JS Crash on `Work Overview` Dropdown:** Clicking `Work Overview` header throws `Uncaught TypeError: Cannot read properties of null (reading 'classList')` at Bootstrap `dropdown.js:245:23`.
12. **Cross-Vertical Delegated Task Missing in Manager Tasks Grid & No Deadline Input:** `T3_PROD_DELEG_CMB` (`3766`, delegated to CM B) shows inside `projectstatus/3014` but is **completely omitted** from CM A's `Work Overview -> TASKS`. The Sister Vertical task modal also has no Deadline picker (`deadline: null`).
13. **Self-Assigned Manager Tasks Hidden from `My Tasks`:** `My Tasks` (`/dashboard/cm/tasks`) has only `IN PROGRESS`, `UPCOMING`, `UNDER REVIEW` tabs (no `PENDING` tab), so `T2_PROD_CMA_SELF` (`3765`, `pending`) never appears in `My Tasks`, and `/dashboard/taskdetails/3765` has no `"Accept"` button. Clicking `UPCOMING` sends empty `&status=`.
14. **`Requests -> TASKS` Param Mismatch & Stuck Search Clear:** Initial load sends `assigned_to=myTask` while clicking `My Task` filter sends `assigned_to=self`. Clearing search (`""`) in `Requests` and `Work Overview -> TASKS` fails to reset results; persisted `Overdue` filter shows future deadline (`18 Dec 2026`) as `"Overdue"` while past-deadline `19 Oct 2026` changes show `"Pending from user"`.
15. **Mismatched Task Counts, Icons & Missing History:** `My Team` shows `Nikhil: 6 / Kiran: 2`, Assign modal shows `7 / 7`, `projectstatus/3014` shows `8 / 8 / 7`; `memberalltasks/21` shows `inprogress-icon.svg` on pending `3765`; no History timeline UI; search placeholders have grammar errors (`"Search for a projects/tasks/issues"`); `/dashboard/cm/analytics` has no analytics; `completedwork` mixes `"Canceled"`; calendar overflow dates at month end are non-clickable.

### 1.4 Stage 3A — Delegated Manager B (`bhagwan.parab@alembic.co.in`) & Artist B (`mangesh.khale@alembic.co.in`)
16. **Uncaught JS Crash on Task Reassign (False Error Toast):** CM B reassigning Task `3766` calls `POST /api/users/assign-task` -> **`200 OK`**, then immediately throws **`TypeError: m is not a function`** (`index-CgcRDJ3H.js:330:226764`), displays `"Something went wrong."` toast, and keeps Edit modal open even though DB saved it.
17. **Accept/Assign Flow Gap & Broken `DESC` Sort:** `/dashboard/taskdetails/3766` has no Accept/Assign while `pending`; CM B must first accept via `Requests -> TASKS` drawer (putting `3766` in CM B's own `ACCEPTED` state before editing). `Requests -> TASKS` `DESC` sort places `26 NOV '26` 4th below `16 NOV '26`, `17 NOV '26`, and `23 JUL '26`; `_PROD_` search acts as unescaped SQL `_` wildcard.
18. **Artist B Filter, Submit Modal Icon & `task_count` DOM Bugs:**
    - `My Tasks -> IN PROGRESS` displays a `Pending` task alongside `in_progress` items.
    - `My Tasks -> UNDER REVIEW` search (`"Policies"`) filters tasks while **all 22 `Issue` items ignore the search**.
    - Sort button label next to `sortingIcon.svg` is blank (`" "`).
    - Submit modal has **swapped button icons** (`Link` shows `fileUploadIcon.svg`; `Files` shows `linkIcon.svg`), and `"No. of collaterals designed *"` has DOM attributes `min="0" max="0"` and lets users type `-1`.
    - After submitting `3766` (`200 OK`), `projectstatus/3014` still showed stale `inprogress-icon.svg` and `"7 days left"`.
19. **CM B Post-Review/Share UI Bugs:** After CM B approved (`PUT /review` -> `200`) and shared `3766` (`POST /share-for-client-review` -> `200`), `/dashboard/taskdetails/3766` still renders `Request Change` and `Approve` buttons active; Share modal filename click doesn't toggle checkbox; `"No. of collaterals designed"` shows as `"NO. OF WORK PAGES"`.

---

## 2. Automated UAT Backend API Errors (`test/results/latest.json` — 37 Failed Checks)

### Cross-Manager Delegation (Suites 03 & 07)
1. **CM B missing project in manager list:** `GET /manager/assigned-work-requests` -> `found=false` (`managerAssignedController.js:455` inner-joins `work_request_managers`).
2. **CM B 404 on project tasks:** `GET /manager/assigned-work-requests/work-request/:id/tasks` -> `404` (`managerAssignedController.js:2105-2123` checks `WorkRequestManagers` only).
3. **CM A loses delegated task in `GET /users/tasks`:** After CM B assigns T2 to Artist B, CM A sees `false` (`userController.js:65-91, 302-314` filters only CM A's division users).
4. **CM B 404 on `reviewTaskDocument`:** `PUT /manager/assigned-work-requests/documents/:id/review` -> `404` (`managerAssignedController.js:3715-3720` required `WorkRequestManagers`). *(Updated locally to `canActOnTask` with assignee context in repo.)*
5. **CM B 404 on `reviewIssueDocument`:** `PUT /manager/assigned-work-requests/issue-documents/:id/review` -> `404` (`managerAssignedController.js:3814-3819` required `WorkRequestManagers`).
6. **CM B delegated self-task missing in `GET /users/tasks?assigned_to=self`:** `allHasDeleg=true, selfFilterHasDeleg=false` (`userController.js:53-63, 224-226` restricts by `WorkRequestManagers`).
7. **Multi-assignee reassignment wipeout:** Reassigning CM B's share on `[Artist A, CM B]` deleted Artist A (`userController.js:735-738` / old UAT build destroyed all `TaskAssignments`).

### Project Status & Re-open Transitions (Suites 01 & 05)
8. **WR stays `accepted` when task starts:** Artist accepts task (`in_progress`) -> `work_requests.status` remains `"accepted"` until `00:01` cron (`userController.js` `acceptTask`/`submitTask`, `taskSchedulerService.js`).
9. **Completed project reopens to `accepted` instead of `in_progress`:** Creating Task 3 on `completed` project sets `work_requests.status="accepted"` (`managerAssignedController.js:1968`).
10. **Reopened task started -> project still `accepted`:** `acceptTask` does not move `work_requests.status` to `in_progress`.
11. **`pm-reject` on `completed` project does not reopen project:** Task reopens (`in_progress`) and V2 is created while `work_requests.status` stays `"completed"` (`workRequestController.js:2379-2472`).

### Date, `start_date`/`end_date` & Version Validations (Suites 02, 04, 06)
12. **Past-deadline task accept leaves `start_date=NULL`:** `acceptTask` without `start_date` when deadline is past succeeds (`200`) with `start_date: null` (`userController.js:1207-1225`).
13. **Task completes with `start_date=NULL`:** `submitTask` completes task with `status="completed", start_date=null` (`userController.js:1442-1453`).
14. **Impossible date `2026-02-31` -> HTTP 500 in `updateTask`:** `PUT /manager/assigned-work-requests/tasks/:id` crashes with `500` (`managerAssignedController.js:3518-3533`).
15. **Impossible date `2026-02-31` -> HTTP 500 in `createIssueAssignment`:** `POST /issue-register/assignment` crashes with `500` (`issueRegisterController.js:133, 240`).
16. **Impossible date `2026-02-31` -> HTTP 500 in `pmRejectTask`:** `POST /work-requests/pm-reject` crashes with `500` (`workRequestController.js:2355`).
17. **`pm-reject` keeps stale `end_date`:** Task becomes `in_progress` while `end_date` remains `"2026-11-26"` (`workRequestController.js:2407-2413, 2516-2522`).
18. **`POST /issue-register/assignment` allows `version: "V1"`:** Returns `201` (`issueRegisterController.js:113, 238`).
19. **`POST /work-requests/pm-reject` allows `version: "V1"`:** Returns `200` (`workRequestController.js:2353`).
20. **`POST /issue-register/assignment` allows changes on `pending` task:** Returns `201` on unsubmitted task (`issueRegisterController.js:174-180`).

### Visibility, Filters, Access & Admin Grids (Suites 01, 06, 07)
21. **Default `GET /users/issues` hides `in_progress`/`completed`:** Without `?status=`, forces `whereCondition.status = 'u_pending'` (`userController.js:2121`).
22. **`GET /users/tasks?search=...&status=overdue` clobbers search:** Overwrites `whereCondition[Op.or]` and returns 13 unrelated overdue tasks (`userController.js:210-219`).
23. **`GET /manager/assigned-work-requests/user/:user_id/tasks` returns `workRequest: null`:** Reads `taskData.WorkRequests` plural instead of `WorkRequest` singular (`managerAssignedController.js:3369-3374`).
24. **`GET /manager/assigned-work-requests/my-team` includes manager self & ignores pagination:** Returns all 6 members including role `2` manager and `pagination: undefined` (`managerAssignedController.js:2504-2508`).
25. **`GET /users/issues` ignores `limit`/`page` pagination:** Returns `pagination: undefined` and >1 rows on `limit=1` (`userController.js:2125, 2313-2318`; `userRoutes.js:39` omits search/filter middleware).
26. **`GET /work-requests/:id` 404 for assigned manager:** Queries with caller `user_id` (`workRequestController.js:1031-1039`).
27. **`GET /manager/assigned-work-requests/work-request/:id/tasks` omits `status`, `task_count`, `start_date`, `end_date`:** Selects only `[id, task_name, deadline]` (`managerAssignedController.js:2128, 2194-2207`).
28. **Duplicate `pm-approve` returns `200`:** Appends duplicate history instead of rejecting (`workRequestController.js:1926-1938, 2067-2073`).
29. **Admin `projectsdetails` shows `project_end_date` on open project:** Takes `MAX(end_date)` even with open `T_open` (`adminController.js:1553-1576`).
30. **Admin `projectsdetails` shows `project_completion_timestamp = "N/A"` on auto-complete:** Filters history by `'completed'` instead of `'auto_completed'` (`adminController.js:1828, 1844, 1859, 1881, 1900`).

### Audit Logs & History Tracking (Suite 08)
31. **`PUT /work-requests/:id` (`resubmitted`) logs post-update values in `previous_data`:** Updates model before calling `recordWorkRequestHistory` (`workRequestController.js:495 vs 661`).
32. **`DELETE /manager/assigned-work-requests/tasks/:id` logs `previous_status: null, new_status: null`:** Also writes zero child `issue_history` rows (`managerAssignedController.js:2905-2920`).
33. **`pm-approve` overwrites `previous_review_stage = "final_approved"`:** Updates task before calling `recordTaskHistory` (`workRequestController.js:1934 vs 1965-1985`).
34. **Manager rework (`reviewTask`) logs contradictory review state:** `new_review="pending"` vs `changes.review="change_request"` (`managerAssignedController.js:4027, 4062, 4121`).
35. **`pm-reject` overwrites `previous_status="in_progress"` & `previous_review_stage="change_requested"`:** Updates task before calling `recordTaskHistory` (`workRequestController.js:2415 vs 2429-2471`).
36. **Chained V3 via `issue-register/assignment` (`issue_id` only) logs `issue_history.task_id = null`:** Reads `req.body.task_id || null` instead of `rootTaskId` (`issueRegisterController.js:263, 278, 294-297`).

---

## 3. Email Triggers, Tracking & Infrastructure Audit (Live HTTP + Code Audit)

37. **No Email Delivery DB Audit / API (`GET /notifications/mail-logs -> 404`):** `services/mailService.js` queues BullMQ jobs (Redis) and logs only to console stdout; if Redis is down, `sendMail` returns `null`.
- **Missing Email Triggers (0 `sendMail()` calls):** `pmApproveTask` & `handleIssuePmApproval` (`pm-approve`), `services/workRequestCompletionService.js` (auto-complete, even though `email-templates/workRequestCompletionNotification.html` exists), `pmRejectTask`, `createIssueAssignment`, and `updateWorkRequest`.
- **Wrong Recipients / Broken Templates:**
  - `submitIssue` (`userController.js:2869`) emails **PMT** (`issueRequester`) instead of the Manager(s) with `issueAssignmentNotification`, misses delegated CM B, and lacks `TaskType` (`task_type` falls back to `'Issue'`/`'N/A'`).
  - `submitTask` (`userController.js:1672`) emails only `WorkRequestManagers[0]` (misses co-managers and delegated CM B).
  - `shareForClientReview` (`managerAssignedController.js:4825`) produces `//` double-slash URLs in attachment links.
  - `workRequestTransferNotification` (`managerAssignedController.js:1658`) reads `user.Division?.title` instead of `Divisions`.
  - `email-templates/registrationSuccess.html` has 0 `{{...}}` placeholders.
- **API Request Logging Disabled:** `server.js` lines `82–87` have `loggingMiddleware` (Elasticsearch access logging) commented out.

---

## 4. `reviewTask` Delegation Error Reported & Fixed Locally (2026-11-27)

- **Reported Error on `PUT /manager/assigned-work-requests/review` (`reviewTask`):**
  ```json
  {
      "success": false,
      "error": "This task was delegated to another manager; only that manager can review its changes"
  }
  ```
- **Root Cause:** `delegatedHandler(taskId)` / `isDelegatedAway` in `services/accessService.js` checked only a single `user_id` (`LIMIT 1`) from `task_assignments` / `task_history` (`action='assigned'`), and `reviewTask` (as well as `reviewTaskDocument`, `reviewIssueDocument`, `shareForClientReview`) blocked any manager/lead of the user actually doing the task/change (`assignedUsers` / non-PMT `issueAssignments.userAssignments`) if a different manager ID appeared as `delegatedHandler`, and `reviewTask` hardcoded `jr.role_title = 'creative manager'` (excluding Creative Leads `role 3` and Super Admin).
- **Local Fix Applied (`services/accessService.js` & `controller/managerAssignedController/managerAssignedController.js`):**
  - Added `isManagerOfAssignedUsers(user, userIds)` and `hasManagerAccessForWorkItem(user, workRequestId, assigneeUserIds)`.
  - Updated `isDelegatedAway(user, taskId, assigneeUserIds)` and `canActOnTask(user, taskId, assigneeUserIds)` so any manager (`job_role_id IN [2, 3]`) managing the active assignee(s) (or assigned directly, or Super Admin) is never blocked as "delegated away", while uninvolved Work Request managers whose team is NOT working on the delegated item still remain blocked (`403`).
  - Updated `reviewTask`, `reviewTaskDocument`, `reviewIssueDocument`, and `shareForClientReview` accordingly and excluded PMT `requested_by_user_id` rows from issue assignee checks.
