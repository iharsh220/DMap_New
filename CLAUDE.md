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

There are no automated tests. `Testing.js` is an ad-hoc script that calls the production admin APIs (`node Testing.js`); it is not a test runner, and since the admin APIs now require a token it needs an `Authorization` header to work. API requests for manual testing are in `D-Map-API.postman_collection.json`.

Runtime dependencies that must be reachable: **MySQL** (Sequelize), **Redis** (token blacklist, admin cache, BullMQ queues), and optionally **Elasticsearch** and an SMTP server. Config comes from `.env` (gitignored); see `.env` for the expected keys.

## Architecture

**Request path.** `server.js` mounts everything under `BASE_ROUTE` (default `/digilabs/uat/dmap/api/`, which includes the environment name). `routes/indexRoute.js` mounts the feature routers (`/auth`, `/work-requests`, `/manager/assigned-work-requests`, `/users`, `/issue-register`, `/salesusers`, `/datatable`, …). Routes → `controller/` → Sequelize models. The controllers are big single files (`adminController.js` and `managerAssignedController.js` are over 6k lines each), so search them rather than reading them top to bottom.

**Auth.** Tokens are **encrypted JWE** (`jose`, `alg: dir`, `enc: A256GCM`), not signed JWTs. The keys are base64 `JWT_ENCRYPTION_KEY` / `REFRESH_ENCRYPTION_KEY`. `middleware/jwtMiddleware.js` decrypts the token into `req.user` and checks a Redis blacklist (`blacklist:<token>`) used for logout and one-time email tokens. `req.user.jobRole.id` drives authorization via `checkRole([ids])` in `middleware/roleMiddleware.js` (e.g. `[1,2,3]` for manager routes).

**Workflow and status machine.** A requester (Marketing, Medical and other departments) raises a `work_requests` row, routed to Creative Managers through `work_request_managers`. The manager accepts it (or defers it), then creates `tasks` and assigns creative users (`task_assignments`). The user accepts the task and submits it with documents. The manager reviews it, then shares it for client review (`intimate_client = 1`), and the requester gives final approval or raises a change request. A change request is an `issue_assignments` row (`assignment_type = 'mod'`, versions V2, V3, …; `issue_id` points to the parent issue, and `task_id` is always set). Issues go through the same accept → assign → submit → review cycle with their own statuses (`m_pending → m_accepted → u_pending → u_accepted → in_progress → completed`).
- Work request: `pending → accepted → in_progress → completed`. Tasks: `pending → accepted → in_progress → completed`. Review progress is tracked separately in `review` / `review_stage` (`manager_review → pm_review → final_approved`, or `change_requested`).
- Status changes must be guarded by the current status (e.g. accept only from `pending`), so a request, task or issue can never move backwards.
- Who may act (all helpers in `services/accessService.js`; every rule was validated against the real history tables so no legitimate user loses access):
  - Managers act on tasks of requests they are assigned to (`required: true` on **every** level of the nested `WorkRequests → WorkRequestManagers` include; otherwise Sequelize just drops the filter).
  - Issues: any manager in the request type's division (`isDivisionManagerForRequestType`).
  - PM approve/reject: the requester or a colleague in the requester's division (`canActAsRequester`).
  - **Delegation** (`POST /users/assign-task`, Manager → Manager → User): `canDelegateTask` allows super admin, the request's managers, managers in the task's request-type division and the task's current assignee (the manager it was delegated to). The new assignee must be active and in the task's request-type division.
  - **Read access / division isolation**: `canViewWorkRequest` (one SQL query, `viewableWorkRequestSql`) guards history, feedback and similar reads. It allows the requester and their division colleagues, the request's managers, the request-type division, task/issue assignees, past participants from the history tables, and super admin. `viewableWorkRequestIdsSubquery(user)` gives the same rule as a subquery for list endpoints (used by `issue-register/assignments`).
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
  - `registrationSuccess.html` (user guide) and `pmReviewPendingReminder.html` (its cron is disabled) still use their old markup.
- `services/taskSchedulerService.js`: `task-scheduler-queue`. `node-cron` runs at 00:01 every day to move tasks and issues forward based on `start_date`. The PM-review reminder cron is currently commented out. Workers start inside the API process.

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
- Noticed, not changed: the Tasks grid's `issue_no_of_work_pages` only counts changes whose task ended in FY 2026-27 (hard-coded in `getTaskDetailsData`).
