# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

D-Map API (`dmap-api`) is the Node.js/Express backend for Digilabs' work-request / task / issue tracking system. It also serves a set of static admin HTML dashboards from `public/`. Plain CommonJS JavaScript: no build step, no TypeScript, no linter, no test suite.

This repo is backend-only plus the admin panel in `public/`; the user-facing apps live elsewhere and consume the JSON APIs (they handle pagination). **Do not break API response contracts**: success responses must keep their exact shape (adding new fields such as `pagination` or `summary` is fine). Prove it by comparing old vs new JSON on a local copy of the data (see "Local testing"). The socket (email-verification) code is being tested manually by the owner; leave it alone unless asked.

## Commands

```bash
npm install
npm run dev     # nodemon server.js (ignores uploads/*)
npm start       # node server.js
```

There is no unit-test runner. End-to-end scripts for a local dump copy live in `scripts/e2e/` (see session 15), and `scripts/audit-data-integrity.js` is a read-only data audit. `Testing.js` is an ad-hoc script that calls the production admin APIs (`node Testing.js`); it is not a test runner, and since the admin APIs now require a token it needs an `Authorization` header to work. API requests for manual testing are in `D-Map-API.postman_collection.json`.

Runtime dependencies that must be reachable: **MySQL** (Sequelize), **Redis** (token blacklist, admin cache, BullMQ queues), and optionally **Elasticsearch** and an SMTP server. Config comes from `.env` (gitignored); see `.env` for the expected keys.

## Architecture

**Request path.** `server.js` mounts everything under `BASE_ROUTE` (default `/digilabs/uat/dmap/api/`, which includes the environment name). `routes/indexRoute.js` mounts the feature routers (`/auth`, `/work-requests`, `/manager/assigned-work-requests`, `/users`, `/issue-register`, `/salesusers`, `/datatable`, …). Routes → `controller/` → Sequelize models. The controllers are big single files (`adminController.js` and `managerAssignedController.js` are over 6k lines each), so search them rather than reading them top to bottom.

**Auth.** Tokens are **encrypted JWE** (`jose`, `alg: dir`, `enc: A256GCM`), not signed JWTs. The keys are base64 `JWT_ENCRYPTION_KEY` / `REFRESH_ENCRYPTION_KEY`. `middleware/jwtMiddleware.js` decrypts the token into `req.user` and checks a Redis blacklist (`blacklist:<token>`) used for logout and one-time email tokens. `req.user.jobRole.id` drives authorization via `checkRole([ids])` in `middleware/roleMiddleware.js` (e.g. `[1,2,3]` for manager routes).

**Workflow and status machine.** A requester (Marketing, Medical and other departments) raises a `work_requests` row, routed to Creative Managers through `work_request_managers`. The manager accepts it (or defers it), then creates `tasks` and assigns creative users (`task_assignments`). The user accepts the task and submits it with documents. The manager reviews it, then shares it for client review (`intimate_client = 1`), and the requester gives final approval or raises a change request. A change request is an `issue_assignments` row (`assignment_type = 'mod'`, versions V2, V3, …; `issue_id` points to the parent issue, and `task_id` is always set). Issues go through the same accept → assign → submit → review cycle with their own statuses (`m_pending → m_accepted → u_pending → u_accepted → in_progress → completed`).
- Work request: `pending → accepted → in_progress → completed`. Tasks: `pending → accepted → in_progress → completed`. Review progress is tracked separately in `review` / `review_stage` (`manager_review → pm_review → final_approved`, or `change_requested`).
- Status changes must be guarded by the current status (e.g. accept only from `pending`), so a request, task or issue can never move backwards.
- Who may act (all helpers in `services/accessService.js`; owner's rule R2 since session 15, checked against the real history tables):
  - **Task manager** (`taskManagerSql` / `isTaskManager`): the request's managers, the manager a task was delegated to (current assignee or in the task's `assigned` history) and the artist's manager (a manager sharing a division with the task's or one of its changes' assignees). Managers outside that set cannot see or act on the task.
  - Managers act on tasks of requests they are assigned to (`required: true` on **every** level of the nested `WorkRequests → WorkRequestManagers` include; otherwise Sequelize just drops the filter). `reviewTask` also allows the artist's manager.
  - Changes (issues): accept / assign / cancel / share and the manager change list (`managedTaskIdsSubquery`) need a task manager of the change's task. A change is given to an artist of the manager's own team or to someone who already worked on the task. Creating a change (`POST /issue-register/assignment`) needs `canActAsRequester` (all 964 changes in the history were created that way).
  - PM approve/reject: the requester or a colleague in the requester's division (`canActAsRequester`).
  - **Delegation** (Manager → Manager → User; `createTask` and `POST /users/assign-task`): `canDelegateTask` = task manager. `assignTargetError`: a request manager gives a task to an artist of their own team (shares a division) or to a Creative Manager/Lead of a Digilabs division; anyone else (delegated manager, artist's manager) only to their own team; super admin to anyone in the task's request-type division.
  - **Read access**: `canViewWorkRequest` (one SQL query, `viewableWorkRequestSql(user)`; it takes the token user because the rule depends on the role) guards history, feedback and similar reads. Allowed: the requester; their division colleagues (requester-side roles only, not roles 2/3/4); the request's managers; task/change assignees; task_history participants; task managers (manager roles); super admin. `viewableWorkRequestIdsSubquery(user)` gives the same rule for list endpoints (`issue-register/assignments`). `GET /users/tasks/:id` gives managers the full view only of tasks they manage, and `/users/my-team` shows team tasks only to manager roles.
- The daily scheduler promotes `accepted` tasks and `u_accepted` issues whose `start_date <= today`.

**List endpoints.** List routes chain `filterMiddleware`, `paginationMiddleware` and `searchMiddleware`, which put `req.filters`, `req.pagination` (`limit=-1` means all rows) and `req.search` on the request for controllers to turn into queries. Always pass client-supplied filter keys and search fields through `pickModelFilters` / `pickModelFields` (`utils/queryFilters.js`): unknown keys such as jQuery's `_` cache-buster otherwise cause "Unknown column" 500s.

**Validation helpers.** `utils/validators.js` provides `parseId`, `parseIdArray`, `parseDateOnly` (rejects impossible dates like `2026-02-31`, which `new Date()` silently rolls over), `todayDateOnly` and `safePathSegment`. Use `safePathSegment` for any user-supplied name (task or user name) that becomes part of an upload folder path.

**Models.** One file per model in `models/<Name>/<Name>.js` using `sequelize.define`. **All associations live in `models/index.js`**, so add new models and relations there; never call `hasMany`/`belongsTo` inside request handlers. There is no `sequelize.sync()` and no migration runner: schema changes are hand-written SQL files in `migrations/`, applied to the DB by hand (keep them re-runnable and safe under strict mode, e.g. widen an ENUM before moving data into new values). Soft delete is an `is_deleted` flag column, not Sequelize `paranoid`. The DB timezone is fixed at `+05:30` with `dateStrings: true`. Multi-row writes that belong together (e.g. task + assignments + dependencies in `createTask`) go in `sequelize.transaction`.

**Admin dashboards (`/datatable/admin/*`).** `routes/adminRoutes.js` serves the HTML pages in `public/` (login, projectsdetails/admin, clients, taskdetails, issuedetails, workrequesttasks, leaves, master-card, feedback, powerbi) along with their `/data` JSON endpoints. All admin API routes require a token (a router-level guard in `adminRoutes.js`); only the HTML pages, the shared CSS/JS and the upload-progress SSE streams are public. `public/admin-theme.js` attaches the token to every jQuery request on these pages. These endpoints mostly use raw SQL (`sequelize.query`) in `adminController.js`, with many correlated subqueries per row. Keep their count queries over FROM/WHERE only (never `COUNT(*)` around the full select), and for the default sort fetch the page's IDs first, then compute the rows (see `getTaskDetailsData` / `getIssueDetailsData`). GET data endpoints are wrapped in `cachedAdminData(handler)` (`services/adminCacheService.js`), which caches any `res.json` payload that has a `data` key in Redis under `admin:data:*` for `ADMIN_CACHE_TTL_SECONDS` (default 60). **Mutating admin routes must include `invalidateAdminCache`**, or the dashboards will show stale data. The site root redirects to `/datatable/admin/login`.
- Shared front-end files: `public/dmap-theme.css` (design tokens, dark default + `body.light-theme`), `public/admin-theme.js` (theme toggle, token on every jQuery request, redirect to login on 401) and `public/admin-filters.js`. `admin-filters.js` hooks into every server-side DataTable through events, with no per-page code except a small `PAGE_CONFIG`. It provides:
  - KPI cards from the response's `summary` (counts over all filtered rows);
  - clicking a KPI card filters by that status;
  - active-filter chips and "Clear all";
  - filters/sort/page size kept in the URL hash (`#f=...`);
  - Excel/CSV export of **all** filtered rows (refetches with `limit=-1`; SheetJS is loaded lazily from cdnjs).
- **XSS rule**: API values are user-entered text and the admin token sits in `localStorage`, so never concatenate API data into HTML unescaped. `admin-theme.js` defines `dmEscape` / `dmEscapeDeep`. `admin-filters.js` wraps `$.fn.DataTable` so every column renderer gets escaped `data` and `row` for the `display` type (sort/filter/export still get raw values); page renderers can therefore keep returning `val` or `'<span>'+val+'</span>'`. In other callbacks that build HTML from API data (edit/delete modals, dropdowns), start with `res=dmEscapeDeep(res);`. Form saves read `this.value` from the DOM, which is the decoded text, so nothing escaped is ever saved.
- The data endpoints return `summary` alongside `data`/`recordsTotal`/`recordsFiltered` (projects, tasks, issues, clients, raw data). When adding a page, return a `summary` and add the page to `PAGE_CONFIG`.

**Background work (BullMQ + Redis).**
- `services/mailService.js`: `mail-queue`. Emails are queued, never sent inline.
  - `sendMail()` never throws: it logs and returns `null` if Redis is down, so a committed business action doesn't turn into a 500.
  - Jobs get 5 attempts with exponential back-off from 30 s; completed jobs are kept 1 day / 1,000, failed ones 7 days.
  - The worker runs 5 emails in parallel (`MAIL_CONCURRENCY`, matches the SMTP pool) and reconnects to Redis forever.
- Email templates are Handlebars files in `email-templates/`, compiled once and cached by `services/templateService.js` (with an `eq` helper).
  - All of them share one Outlook-safe layout: table-based with an MSO wrapper; `bgcolor` table callouts instead of padded `div`s; VML `v:roundrect` buttons; mobile breakpoint; D-Map brand colours `#291467` / `#5b2be0`.
  - Logo and banner are **CID attachments** (`public/images/email/*.jpg`, about 60 KB together) added by the mail worker. Templates still use `{{logo_base64}}` / `{{banner_base64}}`, which now resolve to `cid:` URLs. Base64 data URIs are blocked by Outlook/Gmail and made each email about 1 MB.
  - When editing a template, keep that structure. Never use a `div` with padding or borders for layout, and use the VML button pattern for buttons.
  - `registrationSuccess.html` (user guide) still uses its old markup.
- `services/taskSchedulerService.js`: `task-scheduler-queue`. `node-cron` runs at 00:01 every day to move tasks and issues forward based on `start_date`. The daily PMT reminder (`sendPmReviewPendingReminders`, 09:00 IST Mon–Sat, `PM_REVIEW_REMINDER_CRON` overrides) runs only with `PM_REVIEW_REMINDER_ENABLED=true` and never when `BASE_ROUTE` contains `/uat/`; at most one reminder per requester per day. Workers start inside the API process.

**Audit history.** `services/historyService.js` (`recordWorkRequestHistory`, `recordTaskHistory`, `recordIssueHistory`, …) stores before/after diffs in the `*_history` tables. Call it when changing the status or fields of work requests, tasks or issues.

**Socket.IO.** Namespace `/socket`, path `${BASE_ROUTE}socket.io`. The instance is available as `req.app.get('apiIo')`. It is mainly used to push email-verification results to the client socket whose id travels in the token's `session_id`.

**Uploads.** Files go to `uploads/<sanitized_project_name>/`; the work-request routes create that folder before the controller runs. They are served at `/uploads/*`, with a path-traversal check in `indexRoute.js`. `services/fileUploadService.js` handles the uploads, and the master-card Excel/CSV import reports progress over SSE (`/admin/master-card/upload/progress/:jobId`).

## Gotchas

- `ioredis` is required by `config/redisConfig.js` but is not listed in `package.json`; it is only installed because BullMQ depends on it. The `redis` package in `package.json` is not what the app uses.
- The root-level `.sql` and `sandesh_*.txt` files are reference queries, not part of the app.
- Rate limiting and request logging middleware exist but are commented out in `server.js`.
- `.env` points at the **production** DB and Redis (`alembicdigilabs.in`). Never run the server, cron or mail worker against it for testing, because they write rows and send real emails to users. See "Local testing" below.
- Most source files use **CRLF** line endings (`workRequestController.js`, `issueRegisterController.js`, `adminController.js`, `taskSchedulerService.js` and `adminRoutes.js` are LF). Keep each file's style; `perl`/`sed` line edits on CRLF files leave stray `\r` behind.
- `migrations/alembicdigilabs_Digi_dmap.sql` is a full production dump (106 MB, includes users' emails, phones and password hashes). It must not be committed or pushed; it was committed locally in `ff38393` (not on any remote as of 2026-10-29).

## Roles (`job_role.id`)

1 Super Admin, 2 Creative Manager (accepts requests, creates/assigns tasks, reviews), 3 Creative Lead, 4 Creative User (does tasks/issues). 5/6 Marketing Manager/User, 9/11 Medical, 8/20 Business Enabler, 15/17 CQA, 18/19 CComm and 22 IBU are requester departments. 7 Senior Leadership, 13 Legal Senior. Manager routes use `checkRole([1, 2, 3])`. The admin pages' `task_cost`-type columns are shown only to role 1.

## Database schema (key facts)

MariaDB 11.4 in production (`alembicdigilabs_Digi_dmap`), around 2.5k work requests, 3.1k tasks, 1.6k issues and 220 users. There are almost no real foreign-key-driven indexes beyond single columns; composite indexes are added by `migrations/add_performance_indexes.sql`.
- `work_requests` (requester `user_id`, `request_type_id`, `project_id` → `project_type`, `status`, `notification_alert`, `is_deleted`) → `work_request_managers` (manager_id), `work_request_documents`, `work_request_deferrals`, `work_request_history`.
- `tasks` (work_request_id, task_type_id, request_type_id, status, review, review_stage, intimate_team, intimate_client, deadline/start_date/end_date, many work-quantity columns used for costing) → `task_assignments` (user_id) → `task_documents`; `task_dependencies`, `task_history`, `task_review_history`, `feedbacks`.
- `issue_assignments` (change requests: task_id, issue_id = parent issue, requested_by_user_id, version, status `m_pending/m_accepted/u_pending/u_accepted/in_progress/completed/rejected/on_hold/cancelled`, review, review_stage, is_deleted) → `issue_user_assignments` → `issue_documents`; `issue_assignment_types` links to `issue_register` (change types); `issue_history`.
- Org: `users` → `job_role`, `department`, `designation`, `location`; `user_divisions` (user ↔ division); `request_division_reference` (request_type ↔ division) decides which division's managers handle a request type; `project_request_reference`, `task_project_reference` (task_type ↔ project_type).
- Admin/other: `master_card` (rate card per division, task type and financial year; empty as of the dump), `leaves` (+ `leave_history`), `activity`, `sales`, `doctors`, `work_medium`, `pm_review_reminder_history`.
- `*_history` tables store JSON `previous_data` / `changes` / `next_data` (MariaDB `CHECK (json_valid(...))`).

## Local testing against a dump copy

There is no test suite. The approach used on 2026-10-29 (no root/brew needed):
1. In a scratch folder: `npm i mysql-memory-server redis-memory-server`, then start them from a small script, e.g. `createDB({ port: 13306, dbName: 'dmap', version: '8.4.x' })` and `new RedisMemoryServer({ instance: { port: 16379 } })`.
2. Load the dump with the downloaded `mysql` client (`--max_allowed_packet=1G`, import with `sql_mode='NO_AUTO_VALUE_ON_ZERO'`), then set MariaDB-like strict mode: `SET GLOBAL sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'`. Migrations need `ADD COLUMN/INDEX IF NOT EXISTS` stripped for MySQL 8.
3. Run the app with env overrides (dotenv does not override existing env vars): `DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD= DB_NAME=dmap REDIS_HOST=127.0.0.1 REDIS_PORT=16379 EMAIL_HOST=127.0.0.1 EMAIL_PORT=9 PORT=18080 node server.js`. `EMAIL_PORT=9` makes every mail job fail with ECONNREFUSED, so no email reaches real users; confirm with "FAILED TO SEND MAIL" in the log.
4. Get tokens without passwords: load `.env`, build the same payload as `login.js` (user + `jobRole`, `department`, `divisions`, …) and call `generateAccessToken()`.
5. Compare before/after: export `git archive HEAD` to a folder (symlink `node_modules`), run both versions on the same data, save each endpoint's JSON and `cmp` them. Count SQL per request by wrapping `Sequelize.prototype.query` with `AsyncLocalStorage`. Flush Redis before each admin request, or the `admin:data:*` cache hides real timings.
Useful test users in the dump: manager 24 (1,801 requests), manager 31, creative users 26 and 50, requester 63, admin 1.

## Audit and fixes of 2026-10-29

Done (verified on a local copy of the production dump; 18 negative and a full happy-path workflow test passed):
- **Security:**
  - Admin APIs now require a token.
  - Nested manager-scoping includes got `required: true` on every level: `reviewTask` (task and issue), `updateTask`, `deleteTask`, `reviewTaskDocument` and `reviewIssueDocument`. Before, any manager could act on any request's tasks.
  - `assignIssueToUser` now checks the division.
  - PM approve/reject (`pmApproveTask`, `handleIssuePmApproval`, `pmRejectTask`) is limited via `canActAsRequester`. Before, any logged-in user could approve.
  - Upload folder names go through `safePathSegment`.
- **Status guards:**
  - `acceptWorkRequest` and `deferWorkRequest` only from `pending/deferred`.
  - `acceptTask` only from `pending/assigned`.
  - `acceptIssueRequest` only from `m_pending`.
  - `assignIssueToUser` not from `completed/cancelled/rejected`.
  - Each rule was checked against the real history tables.
- **Bugs:**
  - `getMyTaskRequests` was empty and hung forever; it now returns 501 (still not implemented).
  - The scheduler only promoted `start_date == today`; it now uses `<= today`, does bulk updates, never re-opens completed/cancelled requests and passes the Redis password to BullMQ.
  - Issue review emails used `userAssignment.User` instead of `.user`.
  - `issue-register/assignments` used lowercase association names, so `request_type`, `task_type` and `work_request` were always null.
  - `pmRejectTask` child issues now keep `task_id`.
  - The `client_division` column search referenced a non-existent column.
  - Malformed JSON returned 500; it now returns 400.
  - `getUserTask` paged without `ORDER BY`, so pages were unstable.
  - Unknown query params caused "Unknown column" 500s.
- **Validation:**
  - `createTask` validates IDs and real dates, rejects inactive assignees, ignores duplicate assignees and saves in one transaction.
  - `submitTask` stores files before marking the task completed and validates dates strictly.
  - `acceptTask` validates dates and handles a null deadline.
- **Performance:**
  - Composite index migration added.
  - Admin task details 1,215 → 13 ms and issue details 997 → 17 ms (count over FROM/WHERE, page IDs first; output byte-identical); clients 162 → 8 ms.
  - The `issue-register/assignments` N+1 went from 838 queries to 10; one-to-many includes use `separate: true`.
  - Associations defined inside handlers were removed, as were DEBUG logs.
- **Schema:** `alter_leaves_day_type_reason.sql` was rewritten to be strict-mode safe (widen ENUM → migrate data → narrow, quote typo fixed, `IF NOT EXISTS`). The production DB was missing `leaves.checker_remark`, so the Leaves admin page returned 500 until this migration is run.

Deploy order: back up → run `migrations/alter_leaves_day_type_reason.sql` → run `migrations/add_performance_indexes.sql` → restart. The first 00:01 scheduler run after deploy moves the 79 tasks and 1 issue that were stuck in `accepted` / `u_accepted` (start date already passed) to `in_progress`.

## Session 2 (2026-10-29): isolation, delegation, pagination, email, admin UI

Done (verified on the local dump copy: 18 security tests, 18 isolation/delegation/pagination tests, 16/16 email templates with identical text and links, 11 browser checks of the admin panel, and the earlier 18-test suite re-run):
- **Delegation** (`assignTaskToUser`):
  - caller checked with `canDelegateTask`;
  - `task_id` must belong to `work_request_id`;
  - assignee must be active and in the task's division;
  - no reassigning `completed/cancelled/rejected` tasks;
  - strict deadline parsing;
  - the delete/update/insert of the assignment runs in one transaction.
- **Division isolation**:
  - all task/issue/work-request history endpoints and `getFeedback` now return 403 outside `canViewWorkRequest` (before, any logged-in user could read any history);
  - `issue-register/assignments` only lists issues of viewable requests (a requester went from seeing all 832 tasks to their 7).
  - `getAssignableUsers`, `getMyTeam`, `getUserTask`, `getTaskById` and `getMyTeamTasks` were already division-scoped.
- **Pagination** (the clients handle it): `manager/assigned-work-requests/issue-assignments` and `issue-register/assignments` now honour `page`/`limit` (`limit=-1` = all) and add a `pagination` object.
  - `notification_alert_count` is still computed over all matches.
  - With `limit=-1` the manager list is identical to before, apart from a stable order among ties.
  - Also fixed: the `overdue` filter overwrote the search conditions, and `sort` was passed raw into ORDER BY.
- **Email**:
  - CID images instead of base64: about 1 MB → 94 KB per email; Redis job 634 KB → 10 KB;
  - retries/back-off (tested: SMTP down → attempt 1/5 failed → delivered on retry);
  - job cleanup and parallel worker;
  - Redis reconnects forever (before, it stopped after 3 failures until restart);
  - non-throwing `sendMail`;
  - template caching;
  - new Outlook-safe layout for 16 templates.
- **Admin panel**:
  - The KPI cards on Tasks/Changes/Clients/Raw Data were computed from the 25 visible rows (Tasks showed "4 completed" instead of 2,863). They now use the server `summary`.
  - Excel/CSV used to export only the visible page; they now export all filtered rows.
  - New filter chips, clickable KPI cards and URL state.
  - Project status badges, favicon, focus styles.
  - Raw Data paging counted distinct requests instead of rows, so 1,487 rows were unreachable.
  - Raw Data global search always returned 500 (`assigned_user.name` / `ta.status` did not exist).
  - The Clients TAT column filter returned 500 (a select alias was used in WHERE).

## Session 3 (2026-10-30): stored XSS in the admin panel

- Every admin page (8 tables, the task/issue/client edit and delete modals, the leave-user dropdown) inserted API text as raw HTML. A requester could put `<img src=x onerror=...>` in a project name, remark or similar field, and it ran in the admin's browser, where it could read the access token. Fixed with the central escaping described under "Admin dashboards" (`admin-theme.js`, `admin-filters.js`, 7 callbacks in `clients/issuedetails/taskdetails/leaves.html`; the double escape in `admin.html`'s status badge was removed).
- Verified in Chrome with every API string set to an XSS payload. Original pages: the payload ran on all 8 pages and in every modal (100+ executions per page). New code: 0 executions, the text displays exactly, and the edit forms show and save the original text unchanged (16/16 checks, no JS errors).
- Also checked: all admin raw SQL takes column and sort names from whitelists and binds values as `:replacements`; `accessService` interpolates only a validated integer user id. No SQL injection found.

### Status of the owner's 6-point audit prompt
| # | Requirement | Status |
|---|---|---|
| 1 | Security / RBAC: division isolation, Manager → Manager → User delegation, SQLi/XSS/data leakage | Done (sessions 1–3). Open: admin APIs accept any logged-in user (see below). |
| 2 | Indexes + N+1 queries | Done: `add_performance_indexes.sql`; N+1 fixes; admin pages 1.2 s → 13 ms |
| 3 | Redis mail queue + Outlook-safe template | Done (session 2) |
| 4 | Admin UI/UX + advanced filters | Done (session 2) |
| 5 | Socket verification bug | Not changed, the owner is testing it manually; suspects listed below |
| 6 | Roadmap | Listed below |

Open items / decisions for the owner:
- Admin report queries join `master_card` on `task_type_id` only (not division / financial year); once the table has several rows per task type, report rows will duplicate.
- `getWorkRequestTasksData` main query is still ~0.35 s (row-level join over all requests).
- `getMyTaskRequests` still needs an implementation; `Testing.js` needs an `Authorization` header now.
- Admin APIs only require *a* valid token, not a specific role: any logged-in user (even a Creative User or requester) can log in at `/datatable/admin/login` and call the admin edit/delete endpoints. The pages show non-admins a reduced view (cost columns only for role 1), so other roles do use the panel. The owner must decide which roles are allowed (e.g. `checkRole([1, 2, 3])` on the router, or role 1 only for edit/delete/upload) before this is locked down.
- `issue-register/assignments` still includes soft-deleted (cancelled) issues, kept for compatibility.
- Socket email-verification flow: being tested manually by the owner. Suspects found: verification is tied to the volatile `socket.id` (changes on reconnect/reload; a room keyed by a stable id would fix it); `server.js` builds the socket path as `${BASE_ROUTE}socket.io`, and with a `BASE_ROUTE` lacking a trailing slash that gives `/digilabs/dmap/apisocket.io`; `verifyToken` broadcasts errors to every connected client.
- Roadmap ideas: automated PM-review reminders (cron exists, disabled), SLA/TAT dashboards per manager and division, workload-aware assignment suggestions, a real test suite plus a staging DB, and moving the cron and mail workers out of the API process.

## Session 4 (2026-11-02): new admin UI showed too few columns

The admin UI was rebuilt (`public/admin-app.js` grid + `services/adminGridService.js`; `admin-theme.js`/`admin-filters.js` are gone; the old jQuery pages are kept in `old_html/` for reference). Every endpoint returned all its data, but the pages hid most of it:
- 112 columns had `hidden: true` (Projects 38/59, Tasks 36, Changes 35, Raw data showed 20 of 151). The old pages showed every response key. All columns are now visible by default (users can still hide them with "Columns"); every grid's `version` went 2 → 3 so the hidden-column choice saved in each browser's localStorage is reset.
- Raw data: 7 response fields had no column (`task_description`, `task_type_description`, `issue_intimate_team/_client`, `issue_requester_id/_email/_phone`); `issue_work_pages` and `request_type_id` are never returned (always blank, also in the old page) and were removed; `work_request_created_at/_updated_at` are filter-only.
- Feedback: added Client ID, Client email and Updated columns (filter/sort keys added in `getAllFeedback`).
- Bug: `project_request_to_response_tat` (Projects) was `N/A` on every row: it looked for history actions `create`/`pm_approved`, which don't exist. It now uses `requested_at` → first `manager_accepted`, the same definition as the Clients page (957 of 2,491 projects get a value).
Verified on the local dump copy in headless Chrome: every page renders all response fields, no JS errors; the Projects response keys are unchanged. Blank cells left on page 1 are real nulls (newest requests are still pending).

## Session 5 (2026-11-02): new grids copy the old tables' columns
The owner wants every new admin grid to be a replica of the old jQuery table: same columns, same order, same header names. The source is `old_html/*.html` (`COL_ORDER` / `HEADERS`); where the last committed jQuery page (`git show HEAD:public/<page>.html`) had extra fields, those are kept with its names (task/change cost columns, `project_completion_timestamp`, leaves `from_date`/`to_date`/`checker_remark`). Feedback and Rate card have no old_html copy and follow the HEAD page.
- Columns added in session 4 that the old tables never had were removed again (Clients `project_end_date`; Feedback client ID/email/updated). Raw data shows the old `COL_ORDER`, then the 7 response fields it didn't list, titled with their raw key as the old page did; `issue_work_pages` and `request_type_id` (never returned) stay out, the duplicate `request_creator_job_role` is shown once.
- Projects status uses the old labels (Pending Response, Awaiting Assignment, Upcoming, Ongoing). `pinned` matches the old `fixedColumns` minus the Action column; Raw data had none. All grid `version`s 3 → 4.
- Keep this when editing a page: change the title/order only to match the old table, and keep the column keys (filters/sort depend on them).

## Session 6 (2026-11-02): "Manage" section is super-admin only
- The sidebar's Manage group (Feedback, Leaves, Rate card) is shown only to role 1. `admin-app.js` marks the group `adminOnly`; `D.shell` redirects other roles from those pages to the overview (`D.canOpenPage(page)`), and the overview's NPS card links to Feedback only for admins.
- Server side, every API behind those pages (`/admin/feedback/data`, `/admin/leaves*`, `/admin/master-card/*`) has `adminOnly` (`checkRole([1])`) in `adminRoutes.js` and returns 403 for other roles. The HTML pages and the upload-progress SSE streams stay public as before (an upload, and so its job id, can only be started by an admin).
- The other admin pages and APIs (projects, clients, tasks, changes, raw data, edit/delete) still accept any logged-in user; that open item is unchanged.
- Page size: every admin grid now opens with 25 rows. Before, the "Rows per page" choice (including All) was saved per grid in localStorage and restored on every load, so after picking All once each page load fetched every row. The choice is no longer saved, and a URL hash only carries a positive size (never All). `paginationMiddleware` now maps `page < 1` and negative limits other than `-1` to the defaults; before, they produced a negative OFFSET and a SQL 500. Valid values behave exactly as before.

## Session 7 (2026-11-02): role-scoped Overview with people / individual view
- `getOverviewData` is scoped by `resolveOverviewScope` (in `adminController.js`): Super Admin sees everything; every other role sees themselves plus their team = everyone sharing one of their `user_divisions` (the same team as `my-team`). `?division_id=` and `?user_id=` narrow it, only within what the caller may see (403 otherwise, 400 for a bad id). Scope rules: a work request is in view when someone in the scope raised it, manages it or was assigned one of its tasks/changes; a task when assigned to them or its request was raised/managed by them; a change when assigned to them, raised by them or on an in-scope task; feedback on in-scope tasks.
- The response keeps every old key (verified byte-identical for the admin, all-time and FY range) and adds `scope` (mode, divisions, roster for the filters), `people` (per person: projects, raised, managed, tasks/done/open/overdue, work pages, changes/done/open, change pages), `tasks.work_pages/completed_work_pages` and `changes.change_pages/completed_change_pages`. Work pages = `tasks.task_count`, change pages = `issue_assignments.task_count`; per-person counts use DISTINCT assignment rows.
- The overview is cached per user (`cachedAdminData(handler, { perUser: true })`); the old key was per role, so two managers would have shared one cached team view.
- `overview.html`: Team / Only me toggle (non-admins), Division and Person filters (remembered per user in localStorage, dropped on a 403), 8 KPIs incl. work/change pages, an individual spotlight card, a sortable/searchable People table with CSV export (row click → individual view), and a work-output chart. `D.barList` items accept `onClick`.
- Verified on the local dump copy: admin/manager 24 and 31/creative 50 and 26/requester 63, individual and division views, 403/400 cases, per-user cache HIT/MISS, headless Chrome at 1440 px (light + dark) and 390 px with no JS errors and no horizontal scroll (the period buttons now scroll inside themselves on phones; the old page overflowed there too). ~65 ms admin, 110–170 ms scoped.
- Still open: links from the overview open the admin grids, which are not team-scoped (any logged-in user can open every grid; see the open item about admin roles).
- Sidebar "Work" order is now Client requests, Projects, Tasks, Changes, Raw data. Raw data is super-admin only like the Manage pages: the nav item has `adminOnly` (hidden and redirected to the overview for other roles) and `/admin/workrequesttasks/data` has the `adminOnly` guard (403 for others). Checked in headless Chrome and over HTTP (user 50 / manager 24 → 403, admin → 200).

## Session 8 (2026-11-03): `issue_register_ids.map is not a function` in production
- `POST /issue-register/assignment` (`createIssueAssignment`) and `pmRejectTask` called `.map` on `issue_register_ids`. JSON clients send an array, but a multipart request (with files, parsed by `express-fileupload`) sends a string (`"5"`, `"[5,6]"`, `"5,6"`), so it crashed with a 500. It crashed **after** the issue row, the histories and the task's `review = 'change_request'` were written, so each failure left an issue without change types (and users probably retried, creating duplicates).
- New `parseIdList` in `utils/validators.js` accepts an array, a JSON array string, a comma-separated string, a single id, repeated multipart fields and `issue_register_ids[]`. Both handlers now validate (400 for a bad list or ids that are not in `issue_register`) before writing anything.
- Verified on the local dump copy over HTTP: 7 valid shapes (multipart with/without file, JSON array, none) create the issue with the right types; invalid input returns 400 and creates no row.

## Session 9 (2026-11-03): Digilabs-only "Task Manager Vertical" filter
- `getFilterOptions` returns `digilabs_verticals`: the divisions of the department named `Digilabs` (Graphic, Video, Shoot, Content, Web Application; looked up by name, no hard-coded ids). Tasks and Changes use it for the `task_manager_vertical` filter (instead of all 42 divisions) and show that filter in their quick filters (after Task Type). Other vertical filters (project manager, CU, client division) still list every division.
- Verified on the local dump copy: each vertical's API result has only matching rows (e.g. Tasks: Graphic 1,868, Video 466, Content 351, Web Application 365, Shoot 37); in headless Chrome the quick filter lists the 5 verticals and selecting Video gives 466 tasks with the chip and URL state, no JS errors.

## Session 10 (2026-11-03): work requests complete automatically after the last approval
- Bug: approving a change request (`handleIssuePmApproval`) set its task to status `accepted` (with review `approved` / `final_approved`), so the request never reached "all tasks completed" and the daily scheduler could restart the task as `in_progress`. 374 approvals did this; 78 tasks were still stuck in the dump (these are the "79 stuck accepted tasks" mentioned in session 1). The task now stays/becomes `completed` (cancelled/rejected kept).
- New `services/workRequestCompletionService.js`: a request (status accepted/assigned/in_progress, not deleted) is finished when it has at least one live task and every live task and change request is `completed` + `approved` + `final_approved` (cancelled/rejected/deleted items ignored). `completeWorkRequestIfFinished` runs after every PM task/issue approval (replaces `checkAndCompleteWorkRequest`, which wrote no history and completed requests with no tasks); `completeAllFinishedWorkRequests` is a new daily job (`complete_work_requests`, queued at 00:01 IST with the progression jobs; `triggerWorkRequestCompletion()` for manual runs). Each completion is guarded by the current status and writes `work_request_history` action `auto_completed` (actor = the approver, or `system` for the daily job). Approve responses add `work_request_completed` (task) / `data.workRequestCompleted` (issue).
- The daily task progression no longer restarts tasks that are already `approved` + `final_approved`.
- Data fix: `migrations/fix_tasks_reopened_by_issue_approval.sql` (re-runnable) restores the stuck tasks to `completed` with a `status_restored` task_history row each.
- Verified on the local dump copy: migration 78 → 0 stuck (re-run no-op); HTTP approve of the last task (WR 1631) and the last change (WR 1094, task stays completed) completes the request with history; approving one of two pending tasks (WR 609) does not; repeating an approval adds no second history row; the daily job (real BullMQ queue) completed 137 finished requests (51 accepted, 49 assigned, 37 in_progress; spot-checked), a second run 0; the progression job left an approved `accepted` task alone. Local copy restored afterwards.

Deploy order: back up `tasks`, `task_history`, `work_requests`, `work_request_history` → run `migrations/fix_tasks_reopened_by_issue_approval.sql` → deploy and restart. At the next 00:01 run (expect ~137 on current data) every finished request is completed, each with an `auto_completed` history row.

## Session 11 (2026-11-03): Weekly report in the admin panel (port of "Weekly Report App")
`Weekly Report App/` (untracked) is the Web Application team's Python tool: it read the Projects / Tasks / Changes Excel exports, worked out each project's status, kept the manager's edits in `data/state.json` and built a .pptx from `template.pptx`. It now runs inside the admin panel on live data:
- **Who:** Super Admin (any Digilabs division, division picker) and active Creative Managers (role 2) of the department named `Digilabs`, only for their own divisions (`reportAccess` in `controller/weeklyReportController.js`, checked against the DB, not the token). Everyone else gets 403 and does not see the nav section.
- **Sidebar:** section "Report" with the Python app's tabs as nav items (Client work, Initiatives, Highlight & notes, History & settings). They are one page, `public/reports.html#client|init|extra|settings`; NAV items support `hash` (+ `D.setNavTab`) and `reportsOnly` (`D.isDigilabsManager()`).
- **Period:** default the latest Tuesday-to-Monday week (7 days); any range up to a year from the same date-range picker as the grids (`week_start`/`week_end`); the arrows move by the range's length. History and report numbers are keyed by start + end.
- **Report unit per division** (`settings.unit`): Web Application = one row per project (exactly engine.py), the other verticals = one row per task (status from the task and its change requests; "Pages" = `tasks.task_count`). Work of the division's own request types (`request_division_reference` types mapped to that division only) plus anything assigned to someone in the division.
- **Code:** `services/weeklyReport/engine.js` (engine.py), `report.js` (report.py; state in table `weekly_report_states`, one JSON row per division, model `WeeklyReportState`), `pptgen.js` (pptgen.py on the raw OOXML with `jszip` + `@xmldom/xmldom` + `image-size`, new dependencies; it prunes unused slides/notes). Template: `templates/weekly-report-template.pptx`. Generated .pptx and highlight images: `storage/weekly-reports/<division id>/{reports,highlights}` (gitignored, outside the public `/uploads`; served only through the token-checked `/admin/reports/download|img`, and only files listed in the state). Writes per division are serialized in-process (`withLock`). The table has an auto-increment `id` primary key, `division_id` UNIQUE, and `created_at` / `updated_at`; code looks rows up by `division_id`.
- **Verified:** engine identical to engine.py on all 177 Web projects for 3 weeks (every field); pptgen output identical to pptgen.py (python-pptx dump of texts, bold, links, row heights, positions, images; 9 slides) and opens in Microsoft PowerPoint without repair (tables fit; Quick Look renders the font differently); access matrix (admin, 3 managers, inactive manager, creative user, requester, other division, bad period, path traversal); headless Chrome flow as Kiran: untick, remark, initiative, 2 highlight images, notes, generate + download, sidebar tabs, custom range / arrows / reset, 390 px, no JS errors. API 27–72 ms.
- **Deploy:** run `migrations/create_weekly_report_states.sql` (gitignored like every `migrations/*.sql`, copy it to the server), `npm install`, restart. Then, to keep Kiran's initiatives and history (#27, next #28): copy `Weekly Report App/` to the server and run `node scripts/import-weekly-report-state.js "Weekly Report App" "Web Application"` (refuses to overwrite without `--force`).

## Session 12 (2026-11-03): task / change totals on the admin grids, full Excel export
- Tasks grid ends with **Task Cost** (`task_cost`, moved to the end), **Change Cost** (`change_cost`, new) and **Total Cost** (`total_cost`, new). Changes grid ends with **Change Cost** (`issue_cost`, title was "Issue Cost") and **Total Cost** (`total_cost`, new). All admin-only (in `TASK_COST_KEYS` / `ISSUE_COST_KEYS`, filterable and sortable via the outer query).
  - A change's `total_cost` = change pages × `changes_rate` + concepts + resize + AI (`changeCostSql` in `adminController.js`, the same rates the Changes grid already showed per part).
  - A task's `change_cost` = sum of the `total_cost` of all its changes (`is_deleted = 0`, any status, same as the Changes grid lists them); `total_cost` = task pages + concepts + AI + resize + `change_cost`. Rounded to 2 decimals.
  - Rates still come from `master_card` joined on `task_type_id` only (open item above).
- Excel/CSV export now writes **every** grid column (also ones hidden with "Columns"; filter-only keys are not columns) for all filtered rows, with numbers, amounts and ids as numbers. Every key of the tasks/changes responses has a column.
- Verified on the local dump copy with a temporary rate card per task type: old response fields byte-identical (page 1, page 3 of 50, `limit=-1`, sorted); `total_cost`/`change_cost` formulas hold on all 3,087 tasks (785 with changes) and 1,591 changes; managers get no cost keys; filter/sort on `total_cost`; headless Chrome shows the cost columns last and the exported .xlsx has 56 / 55 columns incl. hidden ones with numeric cells. The test rate cards were removed again.
- Column order at the end (all cost columns last): Tasks = Task Cost, Change Cost, Concept Work Cost, AI Charges Cost, Resize Work Cost, Total Cost; Changes = Change Cost, Concept Work Cost, AI Charges Cost, Resize Work Cost, Total Cost. Excel follows the same order.
- The Tasks grid's `issue_no_of_work_pages` used to count only changes whose task ended in FY 2026-27 (hard-coded); since session 13 it is the sum of `task_count` of all the task's changes (`is_deleted = 0`, any status/year).

## Session 13 (2026-11-03): Tasks KPI cards show work pages
- The Tasks grid shows only two KPI cards: **Total tasks** = `SUM(tasks.task_count)` over all filtered rows (hint: number of task rows and projects) and **Completed** = the same sum for `status = 'completed'` (clicking it still filters on completed). The In progress, Pending and Overdue cards were removed.
- `getTaskDetailsData`'s `summary` adds `work_pages` and `completed_work_pages` (both query paths); all old summary keys are unchanged.
- The difference between `SELECT COUNT(*) FROM tasks` (3,231) and the grid (3,183) is most likely the soft-deleted tasks (`is_deleted = 1`), which the grid excludes on purpose (not checked against production).
- Changes grid, same idea: **Total changes** = `SUM(issue_assignments.task_count)` of the filtered changes (hint: number of changes and tasks), **Completed** = that sum for `status = 'completed'`; In progress/Pending/Overdue cards removed. `getIssueDetailsData`'s `summary` adds `change_pages` / `completed_change_pages`. In the default path the sum runs as a separate query over `issue_assignments WHERE id IN (SELECT ia.id <same FROM/WHERE>)`, because the assignee/division joins repeat each change; in the outer-filter path the rows are already one per change.
- The grids exclude soft-deleted rows, so a raw `SELECT SUM(task_count) FROM tasks` (12,175) is higher than the card (12,166) by the pages of deleted tasks.
- Tasks grid "No. of Change Pages" (`issue_no_of_work_pages`): the hard-coded `FY 2026-27` condition was removed; it is now `SUM(issue_assignments.task_count)` over all the task's changes with `is_deleted = 0` (same changes as `change_cost`).
- **Financial Year = FY of the deadline** (session 13, 2026-11-04). The Tasks and Changes `fy` column (shown and exported as "Financial Year") used the *task's* `end_date` (Changes too), so filtering the export by FY did not match `SUM(task_count)` by deadline (Changes FY 2026-27: 5,450 vs 5,685 pages on the dump; 5,647 vs 5,884 in production). It is now `t.deadline` (Tasks) / `ia.deadline` (Changes), April-March, text `FY 2026-27` (`00` when there is no deadline). `fy` is now a WHERE-level filter (directMap, same text as the column; the old Tasks map produced `2026-27` without `FY `, so exact filters never matched) and a quick filter (select) on both grids, with options `deadline_financial_years` from `getFilterOptions` (FYs of non-deleted task and change deadlines). With the FY filter the cards equal the SQL: verified on the dump for both query paths, Tasks 2,423 tasks / 9,175 pages / 8,868 completed and Changes 1,574 / 5,685 / 5,671, the same as the export's sum per Financial Year; checked in headless Chrome (quick filter, chip, cards, no JS errors). The `month` column still uses the end date.
- The date-range preset **This FY** now selects the whole financial year (1 April → 31 March of the next year, e.g. 2026-04-01 → 2027-03-31) instead of 1 April → today, so a deadline filter with it matches the FY sums (future deadlines included). Used by every date filter and the overview/report period pickers.

## Session 14 (2026-11-04): Overview team scope fixed, cards reordered, scoped grid links
- Bug: in "My team" the Tasks/Changes cards counted every task on a request *managed* by a team member, also when it was assigned to another vertical (Web team: 723 tasks shown, 365 actually assigned to the team; Graphic 1,949 vs 1,868; Video 780 vs 466). New rule in `overviewScopeSql(scope)` (`adminController.js`, shared by the overview and the grids): work counts for the people in scope when it is assigned to them or raised by them; work on a request they manage counts only when it is unassigned or assigned to someone in their `team` (the scope itself, or for one person everyone sharing one of their divisions). A work request counts when raised by them, when one of its tasks/changes is in scope, or when they manage it and it has no live tasks yet. Team totals now equal the sum of the team members' assigned tasks. The unscoped Super Admin view is unchanged.
- Grid links from the Overview carry the scope: hash `sc` (`{team:1}` / `{division_id}` / `{user_id}` + `label`) → request param `scope` on Projects, Tasks and Changes (`scopeable: true` in their grid config; shown as a removable "Team"/"Person" chip, cleared by "Clear all", kept in exports). `gridOverviewScope(req)` resolves it with the same access checks (400 bad JSON, 403 for a division/person the caller cannot see). Requests with `scope` are cached per user. Verified: card and grid counts/pages identical for users 66, 21, 24, 63 (team and only me) and admin division/person views.
- KPI order: top Projects, Overdue tasks, Due in 7 days, Client NPS; bottom Tasks, Task pages, Changes, Change pages. "Work pages" is now called "Task pages" everywhere on the overview (response keys `work_pages` unchanged).
- The People table lists every member of a team/division/person scope, including inactive users and people with no activity, with a red "Inactive" tag (also in the individual view). The unscoped admin view still lists only people with activity.

## Session 15 (2026-11-04): projects.md requirements R1–R5, owner's access rule, end-to-end tests
Brief: `projects.md` (untracked). Owner's decisions this session: strict R2 rule ("the manager who receives the request gives it to their own artist; a manager who receives a delegated task gives it only to their own artist; only the task's manager(s), the project manager(s) and the artist see it"); UAT has real users, only the owner's listed team accounts are safe there; the PMT reminder goes out from production only; `*.local` is git-ignored (`.env.e2e.local` holds the UAT passwords).
- **R2 access** (rules under "Who may act"):
  - On the dump, artists' visible requests drop from 22,500 to 2,424 (only their own work); requester-side roles are unchanged.
  - The only history pairs that lose access are 8 requests that managers 24/27/28 deferred to another manager.
  - All but one of the 4,870 manager actions on changes still pass, as do 148 of 149 reassignments (the other one is a manager → manager delegation).
  - **Behaviour change:** 73 tasks (latest 2026-10-28) were assigned at creation by Graphic/Video/Web managers straight to Content artists. That now returns 403: the manager has to delegate to the Content manager.
  - Leaks closed: `GET /users/tasks/:id` let any manager read any task; `/users/my-team` showed artists all their division's in-progress tasks; `POST /issue-register/assignment` had no access check (`requested_by_user_id` comes from the body).
- **R3 PMT lists** (`/work-requests/my-requests`, `/division/all`):
  - `limit=-1` returned 500 (Sequelize `LIMIT -1`).
  - New params: `deadline_from/deadline_to` (project deadline = latest live task deadline), `artist_name/artist_id` (task or change assignee), `requester_name/requester_id`, and `sort_by` (whitelist: created_at, requested_at, deadline, status, project_name, priority, id) with `order`. The `id` tie-break makes pages stable; requests without a deadline sort last.
  - `pagination` adds `total` and `total_pages`.
  - One-to-many includes use `separate: true` with `order id`. Responses are identical to before for 10 requests, except the order inside nested arrays, which the old single join returned arbitrarily. `notification_alert_count` is still per page.
- **R1 data**:
  - `createIssueAssignment` validates task/parent/access first, then writes the change, its change types, the review updates, the re-open and history in one transaction. `task_id` is always set (also when only `issue_id` is sent), and the upload folder name goes through `safePathSegment`.
  - A change or a new task on a **completed** project re-opens it (`accepted`) with a `work_request_history` row `reopened` (`createTask` re-opened without history).
  - `historyService.safeCreate` passed `transaction` as a column value, so history never joined the caller's transaction. Fixed; `recordTaskReviewHistory` takes `transaction` too.
  - `assignTaskToUser` wrote its task_history and work_request_history rows twice.
  - `scripts/audit-data-integrity.js` is a read-only audit (16 checks; runs on production with `.env`). On the dump: 43 changes without change types (21–28 Oct, the multipart crash of session 8; the types cannot be recovered, ids 1577–1631); 1,335 tasks and 413 changes from before the history tables; 137 finished requests that the daily job completes. No data-fix migration was needed.
- **R5 errors**: a response guard in `server.js` logs every 5xx with endpoint, user id and params and sends `{ success: false, error: 'Something went wrong. Please try again later.' }` (the same shape; before, raw SQL errors reached the client). The Express error handler now has the same shape, and `unhandledRejection` is logged instead of crashing the process.
- **Reminder**: the cron is enabled behind the gate above. Recipients are active requesters of live requests; `email_status` is `queued`/`failed` from `sendMail`; the template is in the Outlook-safe layout. On the dump it would reach 96 requesters (300 tasks, 147 changes); a second run on the same day sends 0.
- **Tests** (local dump copy only; `scripts/e2e/lib.js` refuses a non-local `DB_HOST`): `node scripts/e2e/workflow.e2e.js` (89 checks: projects.md scenarios 1–9, 11, 13 incl. delegation, own-team access, rework, V2/V3, cancel, auto-complete, re-open twice, PMT/colleague views, negatives with no row written, emails queued) and `node scripts/e2e/pmt-list.e2e.js` (15 checks against direct SQL). Admin grids: every blank cell for the test project is a real null. Timings: changed lists stay < 300 ms (the task-manager subquery costs ~30–45 ms on manager change lists).
- Not done: scenarios on UAT (UAT runs the deployed code; run the scripts' steps there with the `.env.e2e.local` team accounts after deploying); scheduler progression (code unchanged since session 10).

Deploy: no migration. `npm start` as before. To send the PMT reminder, add `PM_REVIEW_REMINDER_ENABLED=true` to the **production** `.env` only (never on UAT) and restart.


## Session 16 (2026-11-04): artist's manager can edit a task (`updateTask`)
- `PUT` update task (`updateTask` in `managerAssignedController.js`) only allowed the request's managers (nested `WorkRequestManagers` filter), so the manager of the artist a task is assigned to got 404 "Task not found or not assigned to you". It now uses `isTaskManager` (request manager, delegated manager, artist's manager, super admin); others still get the same 404 response.
- Changing `user_id` now runs `assignTargetError` like `createTask` / assign-task (403 if the new assignee is outside the caller's team; a request manager may still delegate to a Digilabs manager).
- Checked with `node --check` only; not run against the local dump copy.

## Session 17 (2026-11-05): data-quality report checked against the code (no code changed)
The owner shared an external data-quality report (717 → 746 errors on 04-Nov). Checked on the local dump copy; its counts match exactly (task/change end < start 30/19, completed without end date 9/3, completed with 0 pages 10/11). Workflow gaps found (fixes proposed, not implemented; open decisions are in the Claude memory `decision-log.md`):
- **FY "errors" are a definition mismatch**: since session 13 the grids' FY is the FY of the deadline; the report still expects FY of the end date, so every open task with a deadline ("FY without end date") and every task finished in another FY than its deadline is flagged.
- **`completeAllTasksAndIssues`** (`PUT /manager/assigned-work-requests/complete`) sets every task/change of a request to completed + approved + final_approved, including pending/accepted/cancelled/deleted ones, with no end date, pages or per-item guard (904 task-history rows, 300 of them from `accepted`, 12 from `pending`). Source of most "completed without end date / 0 pages" rows.
- **Change submit** has its end-before-start check commented out (`userController.js` issue submit); 19 changes were accepted with a future start date (`u_accepted`) and submitted earlier. Task submit already rejects this.
- **Manager `updateTask` reassign** sends a completed task back to `pending` without clearing `end_date`/review; re-accept sets a new `start_date`, so end < start (8 cases in history). `assign-task` already blocks reassigning completed tasks.
- **Admin edit task/issue** (`adminController.updateTask/updateIssue`) writes every column from the body with no validation, status guard or history, and fields left out become NULL/0.
- **Open project with end date**: the project end date is set once every item is *submitted*, but the status closes only after PM approval: on the dump 292 wait for requester approval, 136 are fully approved and are closed by the session 10 daily job, 5 have an open task carrying an old end date.
- "Project Manager missing" = no `manager_accepted` history: 11 requests cancelled before anyone accepted (expected) and 5 completed without an accept step.

## Session 18 (2026-11-05): admin panel is view-only except for Super Admin and managers
- Owner's rule: in the admin panel only Super Admin and managers may edit or delete; every other role (creative users, requesters, …) may only view, filter and export.
- Server: new guard `canEditWork = checkRole([1, 2, 3])` in `routes/adminRoutes.js` on all 13 edit/delete routes (`/admin/edit/*` GET + PUT incl. request-types / project-types / creative-manager, `/admin/delete/*` incl. the delete preview). Others get 403. Data endpoints are unchanged (still any logged-in user); Manage pages and Raw data stay `adminOnly`.
- UI (`public/admin-app.js`): `D.canEditWork()` (roles 1, 2, 3). The grid drops `rowActions` (Edit/Delete buttons and the actions column, also in the detail panel) for other roles; `D.editRecord` / `D.confirmDelete` refuse with a toast.
- Verified on the local dump copy: 56 HTTP checks (users 50, 26, 63 → 403 on every edit/delete route and no row changed; they still get 200 on the clients/projects/tasks/changes data; admin 1 and managers 24, 31 → 200) and headless Chrome (admin and manager 24 see Edit/Delete on Client requests, Tasks and Changes; users 50 and 63 see 25 rows and no buttons; no JS errors). The Projects grid has no Edit/Delete buttons for anyone (unchanged).
- Role 3 (Creative Lead) is counted as a manager here, as in the manager routes; there is no active role-3 user in the dump.

## Session 19 (2026-11-05): "Master data" page (Setup → Master data)
- New admin page `public/master-data.html` (route `/admin/master-data`, sidebar section "Setup", `editorsOnly` → shown to roles 1, 2, 3 via `D.canEditWork()`). CRUD for department, division, designation, job role, request type, project type, task type and change type (`issue_register`), plus their link tables. A relationship map on top switches the table; a row opens a drawer with everything linked to it (own links, child rows such as a department's divisions/job roles, designation mappings, usage counts) and "Add division / job role" buttons pre-filled with the parent; forms have "+ New" next to each link list to create a missing linked row inline.
- Code: `services/masterDataService.js` (a REGISTRY of tables, fields, links, usages and the scope rule; list/detail/create/update/delete are generic, identifiers only from the registry, values bound), `controller/masterDataController.js`, routes `/admin/master/meta`, `/admin/master/:entity[/:id]` (GET/POST/PUT/DELETE) with `canEditWork` + `invalidateAdminCache` on writes. No migration.
- Access (owner's rule): Super Admin everything. Managers only their own department (`users.department_id`, read from the DB): its divisions, job roles and designations, and the request types handled by its divisions → their project types → task types → change types. Managers cannot create/delete departments, cannot edit job role 1, cannot link rows of other departments, and cannot move a row out of their department. Links to other departments' rows are hidden (shown as "+N other dept.") and kept unchanged on save; a manager cannot delete a row other departments still use.
- Link rules (the data was 100% consistent on the dump, so they are enforced): request type ≥ 1 division, project type ≥ 1 request type, task type ≥ 1 project type, change type ≥ 1 task type, designation ≥ 1 department + job role (writes `designation_jobroles` and `designation_departments` together; registration takes the job role from `designation_jobroles`), a mapped job role must belong to that department, names unique (division / job role per department). Delete is refused while the row is used (users, tasks, work requests, rate card, …) or would leave another row without its mandatory link. **Several FKs are ON DELETE CASCADE** (`tasks.task_type_id`, `tasks.request_type_id`, `work_requests.request_type_id`): never delete these rows with plain SQL.
- Protected: department names Digilabs / Leadership and the five Digilabs division names (used by name in the code) cannot be renamed or deleted; job role ids 1–22 cannot be deleted.
- Verified on the local dump copy: `node scripts/e2e/master-data.e2e.js` (54 checks: full chain create, link rules, guards, manager scope incl. shared designation, creative user 403, cleanup back to identical table/link counts); headless Chrome (all 8 tables for admin, drawer, create department → add division from the drawer → delete via UI, manager sees 5 Digilabs divisions / no "New department" / only own department in forms, creative user redirected and no nav item, 390 px no horizontal scroll, no JS errors). API 4–50 ms per call.
- Not done: no audit table for master-data changes (only a `[master-data]` console log line per write).

## Session 20 (2026-11-05): What's new (release notes, popup once per user)
- **Release rule: every update adds a version at the top of `config/whatsNew.js`** (higher `version`, `date`, `title`, `changes`). Change types: `new` / `improved` / `fixed` (end-user text, everyone) and `api` (endpoints, params, response fields; Super Admin and managers only, roles 1, 2, 3). The file is validated at startup (`[whats-new]` errors in the log). History seeded from sessions 1–19 and the owner's own commits: 0.9.0 (28 Oct) → 1.5.0 (5 Nov).
- `services/whatsNewService.js`: role filter, version compare, last seen version per user in Redis `whatsnew:seen:<userId>` (no expiry; only moves forward). Routes (any logged-in user, also usable by the user apps): `GET /datatable/admin/whats-new/data` → `{ current, seen, canSeeApi, unseen, versions }`, `POST /datatable/admin/whats-new/seen { version }` (400 for invalid or future versions); page `/admin/whats-new`.
- Admin panel (`admin-app.js`): sidebar item "What's new" (Insights) with a "New" badge; `D.shell` calls `D.checkWhatsNew()` on every page: if there are unseen versions the popup shows them (first visit: only the latest), and closing it in any way (Got it / X / Escape / backdrop) marks the latest as seen on the server and in localStorage. Opening the What's new page also marks it seen. `D.releaseHtml` renders a release (escaped) for the popup and the page; the page has type filters (API only for roles 1–3) and search. CSS `.dm-release*`, `.dm-nav-badge` in `dmap-theme.css`.
- Verified on the local dump copy (24 checks): role filter (admin/manager see API notes, creative user only features), seen flow (never goes back, invalid/future 400, no token 401), popup once then not after reload nor on another browser (server-side seen), Escape counts as closed, no popup on the What's new page, badge, filters/search, 390 px no horizontal scroll, no JS errors.

## Session 21 (2026-11-05): master data is view-only for managers; change requests
- Owner's rule: managers only **view** master data, and only the Work setup of their department (department, divisions, request / project / task / change types). People setup (designations, job roles) and every write are Super Admin only. In `masterDataService.js`: `adminOnly: true` on designation / job_role (`visible`, `VISIBLE_ORDER`, `assertVisible` → 403), `assertWriter` on create/update/remove (403 "Managers can only view master data…"), `canEdit/canDelete` only for Super Admin, detail sections without People-setup data or add buttons for managers, lite lists always scoped for managers.
- **Change requests**: managers (roles 2, 3) raise a request (`add|change|remove|other`, table, optional row of their scope, title, details). It is emailed to `MASTER_DATA_REQUEST_EMAIL` (default `sandesh.pujari@alembic.co.in`; template `email-templates/masterDataRequest.html`, Outlook-safe layout, button to `<BASE_ROUTE>/datatable/admin/master-data#requests`), and the Super Admin gets a popup in the admin panel (after the What's new popup) for requests newer than the last one they closed (Redis `mdreq:seen:<uid>`) plus an open-count badge on "Master data". Super Admin moves a request pending → in_progress → done | rejected (final; reject needs a reason in the UI) and can comment. Every step is a row in `master_data_request_history` (created, email_queued/email_failed, status_changed, comment). Max 30 requests per manager per day.
- Code: `services/masterDataRequestService.js`, handlers in `controller/masterDataController.js`, routes `/admin/master/requests*` in `adminRoutes.js` (declared before `/admin/master/:entity`), page `master-data.html` ("Requests" / "My requests" node, request form pre-filled from a row, request drawer with history and admin actions), `D.checkMasterRequests` / `D.refreshRequestBadge` in `admin-app.js`.
- **Migration**: `migrations/create_master_data_requests.sql` (tables `master_data_requests`, `master_data_request_history`; re-runnable). Gitignored like every `migrations/*.sql`: copy it to the server and run it before restarting.
- Verified on the local dump copy: `node scripts/e2e/master-data.e2e.js` 71 checks (incl. manager view-only/People-setup 403s, request validation, scope, roles, alerts seen, status flow and history, cascade cleanup) and headless Chrome 18 checks (manager map/buttons/request form pre-fill/My requests; admin popup once, badge, Mark done with remark, history; 390 px; no JS errors). Email rendered and checked visually. What's new 1.6.0 added.
- Update (owner, same day): the request form asks only **Table, What do you need, Title, Details** (no Row; `details` is now required for every request; an optional `target_id` from API clients is still scope-checked). The email goes to `MASTER_DATA_REQUEST_EMAIL` with the **requesting manager in CC** (history remark "To …, cc …"; verified in the queued BullMQ job). E2E 73 checks, browser 18 checks pass.

## Session 22 (2026-11-05): data rules for tasks / changes enforced in every write path
Owner's rule: a started task or change must get an end date when it is completed (end >= start), and no task or change is completed without pages (`task_count` >= 1). Checked every path that sets `completed` / dates / pages:
- `parsePageCount` (`utils/validators.js`, whole number 1–100000) and `services/workItemRules.js` (`checkWorkItem(kind, item)`: valid statuses, real dates, end >= start, completed needs start + end + >= 1 page, open items no end date).
- `submitTask`: `task_count` via `parsePageCount` ("0", "-2", "2.5" were accepted). `submitIssue`: pages required (sent or already on the change), optional `start_date`, a future start (accepted as `u_accepted`, finished early) moves to today; the old end-before-start check was commented out.
- `completeAllTasksAndIssues`: skips deleted/cancelled/rejected items (they were turned into completed), 400 naming items without pages before writing, start = real start if not in the future else today, end = real end if >= start else today, everything (+ histories) in one transaction; response fields unchanged.
- Manager `updateTask`: 400 when reassigning a completed/cancelled/rejected task (checked before any write); a reassigned task's start/end dates are cleared.
- `pmApproveTask` / `handleIssuePmApproval`: only `completed` items (history: 595/595 and 1,137/1,137 approvals were); a task closed by its change's approval gets valid dates.
- Admin edit task/issue: `checkWorkItem` (400 with the reason), 404 for unknown ids, fields not sent keep their value (they became NULL/0 or the query 500'd), history `admin_updated`. Admin edit project: `completed` only with >= 1 live task and no open task/change; status changes write `admin_status_changed`.
- Verified on the local dump copy: new `node scripts/e2e/data-rules.e2e.js` (30 checks; saves and restores every row it touches), `workflow.e2e.js` 89/89 and `pmt-list.e2e.js` 15/15 still pass. What's new 1.7.0.
- Not done: the existing bad rows (completed without end date / pages, end < start) are not changed; use the SQL from this session or ask for a data-fix migration.

## Session 23 (2026-11-05): Financial Year on Tasks / Changes = FY of the END DATE (owner)
- Supersedes session 13: the Tasks and Changes `fy` column, its `col_exact` filter (directMap) and the filter options (`getFilterOptions` key `deadline_financial_years`, name kept so the pages need no change) now use `tasks.end_date` / `issue_assignments.end_date` (April–March, `FY 2026-27`; `00` without an end date, i.e. unfinished work). Trigger: changes 740 / 980 had an end date but no deadline, so FY showed `00`.
- Other pages unchanged: Client requests = FY of the project end date, Projects = `work_requests.created_at`, Raw data = `tasks.end_date`. The Month column already used the end date.
- Verified on the local dump copy: 740 / 980 → FY 2026-27; fy equals FY(end_date) on all 3,090 tasks and 1,586 changes; with the FY filter the count and page cards equal SQL by end date (Tasks FY 2025-26 656 / 2,599, FY 2026-27 2,286 / 9,154; Changes FY 2026-27 1,542 / 5,710); options from end dates. What's new 1.7.0 updated.
- Side effect to remember: FY page sums now group by when work finished, not by deadline (the reason session 13 had switched to the deadline).
- Projects grid too (owner, same day): `fy` in `getAdminData` = FY of the LAST `end_date` over the project's non-deleted tasks and their non-deleted changes; `00` when the project has no task or any of those has no end date (before: FY of `work_requests.created_at`). One correlated subquery (tasks LEFT JOIN issue_assignments, `DATE_SUB(.., INTERVAL 3 MONTH)` for April–March), MariaDB/MySQL safe; filtering on `fy` goes through the outer query, so filter and export follow. Verified: 2,492 projects match an independent calculation (FY 2026-27 1,669, FY 2025-26 555, 00 268), filter counts equal, page of 25 in 17 ms, row keys unchanged (57).
- Projects grid `change_count` (owner, same day): now the number of change requests (`issue_assignments`, `is_deleted = 0`) on the project's non-deleted tasks, the same rows as `issue_no_of_work_pages` (select and the `col_exact` directMap). Before it counted `task_history` rows with action `manager_change_requested` (31 in the whole dump, so almost always 0). `task_count` (non-deleted tasks per request) was already right. Verified on the dump: both columns equal direct SQL on all 2,492 projects (1,586 changes in total; 753 projects changed value), filter "2" = 210 rows, page of 25 in 17 ms, 57 keys per row.

## Session 24 (2026-11-06): "Linked work" in the Projects / Tasks / Changes detail drawers
- Opening a row on Projects, Tasks or Changes shows a **Linked work** section at the top of the drawer: the project (status, vertical, client, managers), totals (tasks / task pages / changes / change pages), each task (type, artist, deadline, start, end, pages, review) with its changes (version, change types, artist, raised by, dates, pages). Project drawer: all tasks; task drawer: that task + its changes, other tasks folded; change drawer: its task with all its versions, the change marked. Every item links to its grid filtered on its id (`#s={f:{<id key>:{type:'exact',…}},d:1}`); `d:1` opens the record's details when the filter gives exactly one row. A same-page link reloads the page.
- Code: `controller/adminLinkedController.js` (`GET /datatable/admin/linked/:kind/:id`, kind project | task | change; 3 queries; `is_deleted = 0` tasks and changes like the grids; no cost fields; any logged-in user like the grid data; cached via `cachedAdminData`), route in `adminRoutes.js`, `D.linkedWork` + `openFirst` in `admin-app.js`, grid config `linked: { kind, idKey }` in `admin.html` / `taskdetails.html` / `issuedetails.html`, CSS `.dm-linked*`. The old `GET /admin/projectsdetails/tasks/:workRequestId` is unchanged.
- Verified on the local dump copy: API 14 checks (project 2535: 7 tasks / 20 changes equal SQL, each change under its task, task/change resolve to the same project, users 24/50/63 200 without cost keys, 400/404/401, deleted task 404, project without tasks, largest project 5 ms); headless Chrome 19 checks (light + dark: drawer lists, change → Changes grid with details open, change → task, other tasks folded, same-page link; 390 px no overflow; no JS errors). What's new 1.8.0.
