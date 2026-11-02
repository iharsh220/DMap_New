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
