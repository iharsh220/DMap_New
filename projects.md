# D-Map: project brief, requirements and end-to-end testing prompt

Read this file and `CLAUDE.md` before you start. `CLAUDE.md` has the code-level facts (architecture, auth, schema, earlier fixes, how to run a local copy of the dump). This file explains how the business process works and what the owner wants now. The goal: **D-Map should run smoothly, with no missing data, correct access, fast filtering and proper error handling, proven by end-to-end tests.**

---

## 1. What D-Map is

D-Map is Digilabs' internal work-management tool. People in other departments (Marketing, Medical, Business Enablers, CQA, …) raise **projects** (work requests). The creative department, **Digilabs**, delivers them. Each project is split into **tasks**, and each task can get several rounds of **changes** (change requests, stored as issues), up to final approval by the requester.

- Organisation: **departments** contain **divisions**. A user belongs to one department and to one or more divisions (`user_divisions`).
- The Digilabs department has the creative divisions (verticals): Graphic, Video, Shoot, Content, Web Application. Each has Creative Managers and Creative Users (artists).
- A request type is mapped to a division in `request_division_reference`. That mapping decides which division's managers get the request.
- This repo is the Node/Express backend plus the admin panel in `public/`. The user-facing app is in a separate repo and calls these JSON APIs.

### Roles (`job_role.id`)
| id | Role | What they do |
|---|---|---|
| 1 | Super Admin | Sees and can do everything |
| 2 | Creative Manager | Receives requests, creates and assigns tasks, reviews work |
| 3 | Creative Lead | Manager-level routes (`checkRole([1,2,3])`) |
| 4 | Creative User (artist) | Accepts and does tasks and changes, submits work |
| 5/6, 9/11, 8/20, 15/17, 18/19, 22 | Requester departments (Marketing, Medical, BE, CQA, CComm, IBU) | Raise projects. Act as **PMT / client**: final approve or request changes |
| 7, 13 | Senior Leadership, Legal Senior | |

"PMT" in this file means the requester side: the person who raised the project, or a colleague in the same division (`canActAsRequester`).

---

## 2. The workflow

1. **The requester (PMT) raises a project.** They pick the type of work (vertical). The project goes to the managers of the matching Digilabs division(s). **A project can have several managers** (`work_request_managers`).
2. **A manager accepts the project** (or defers it) and splits it into **tasks**.
3. **The manager assigns each task**, either:
   - **a)** directly to an artist (Creative User) in their own team, or
   - **b)** to a **manager of another Digilabs division** when that division's help is needed (delegation, Manager → Manager → User, `POST /users/assign-task`). The receiving manager accepts and then assigns the task to an artist in their own team.
4. **The artist accepts the task** and starts working (`pending → accepted → in_progress`). The daily scheduler moves `accepted` tasks to `in_progress` once `start_date <= today`.
5. **The artist submits the task** with documents (`POST /users/tasks/submit`, task becomes `completed`, review starts).
6. **Manager review** (`review_stage = manager_review`):
   - **Approve:** the task is shared with the PMT for client review (`intimate_client = 1`, `pm_review`).
   - **Changes:** the task goes back to the same artist for rework.
7. **PMT review** (`pm_review`):
   - **Approve** (`POST /users/pm-approve`): the task is `final_approved`.
   - **Changes** (`POST /users/pm-reject` / `POST /issue-register/assignment`): a **change request** is created as an `issue_assignments` row with `assignment_type = 'mod'`, version **V2, V3, …**, and `issue_id` pointing to the parent change. It goes to the manager of the artist who did the work.
8. **A change request follows the same cycle as a task**, with its own statuses: `m_pending → m_accepted → u_pending → u_accepted → in_progress → completed`. The manager accepts it and assigns it, usually to the same artist, or to another artist if that one is busy. The artist submits, the manager reviews, and the PMT approves or asks for another version.
9. **One project → many tasks → each task → many changes (versions).**
10. **Automatic project completion:** a project becomes `completed` only when **every live task and every live change** is `completed` + `approved` + `final_approved`. Cancelled, rejected and deleted items are ignored. This runs after each PM approval and again in a daily job (`services/workRequestCompletionService.js`, history action `auto_completed`).
11. **Re-opening:** if new work comes in after a project is completed (a new task or a new change), the project is **re-opened**. Creating a task on a `completed` request sets it back to `accepted` (`createTask` in `managerAssignedController.js`). The database must then hold the new task and changes correctly, with history, and the project must complete again when that work is approved.
12. **History:** every status or field change of a work request, task or change is written to `work_request_history`, `task_history` and `issue_history` (`services/historyService.js`), plus `task_review_history`.
13. **Emails:** each step sends an email through the Redis/BullMQ mail queue. The PMT should get a **daily reminder of projects waiting for their approval**.
    > Check this first: in `services/taskSchedulerService.js` the PM-review reminder cron (`0 9,17 * * 1-5`) is **commented out**, and `pmReviewPendingReminder.html` still uses the old template markup. Today no daily reminder is sent. Confirm with the owner before switching it back on.

### Status guards (must hold)
- Nothing moves backwards. Accept a work request only from `pending`/`deferred`, a task only from `pending`/`assigned`, a change only from `m_pending`. Re-opening a completed project is the only allowed way back, and it must be recorded in history.

---

## 3. What the owner wants now (requirements)

### R1. No missing data, anywhere
Problem today: **some data is missing from the admin tables** (blank cells, missing rows, missing history, missing assignees or changes).
- Every step of the workflow must save **all** of its data: the row itself, assignments (`task_assignments`, `issue_user_assignments`), documents, change types (`issue_assignment_types`), managers (`work_request_managers`) and the **history row**. A step must never be half saved.
- Multi-row writes run in one `sequelize.transaction`, so either everything is saved or nothing is. Validate input **before** writing anything (see session 8 for the cost of validating after the write).
- For every blank cell in the admin grids (Projects, Tasks, Changes, Clients, Raw data), find out whether the value is really null in the DB or lost by the query: wrong join key, wrong history action name (see session 4), soft-deleted rows, the `master_card` join on `task_type_id` only, or a missing `required: true`. Fix the cause, not the display.
- Existing rows that are already broken (an issue without change types, a task without history, a completed request with open work, …) get a re-runnable data-fix SQL in `migrations/`, written like `fix_tasks_reopened_by_issue_approval.sql`.

### R2. Who can see and act on what (access rules)
| Situation | Who gets access (see it and act on it) |
|---|---|
| Manager assigns a task to an artist in their own team | **That manager** and **that artist** |
| Manager A delegates a task to Manager B, who assigns it to an artist in B's team | **Manager A** (who delegated it), **Manager B** (the artist's manager) and **the artist** |
| Changes (V2, V3, …) on a task | The same people as the task, plus the manager or artist the change is assigned to |
| The project as a whole | The PMT/requester (see R3), the project's managers and Super Admin |

- Nobody else should see or act on the task: no other artists, and no managers not involved.
- Enforce this **server side** in `services/accessService.js` for every endpoint: lists, details, history, documents, accept, submit, review, delegate and changes. Hiding things in the UI is not enough. Unauthorised calls return 403 and write nothing.
- **Confirm with the owner before tightening.** The current rules are broader: `canViewWorkRequest` also lets in division colleagues of the requester, managers of the request-type division and past participants from the history tables, and all of these were validated against real data. Show the owner which current users would lose access (count them from the history tables) before switching.

### R3. The PMT sees all their project data, with fast filters and sorting
- The PMT (requester, and per `canActAsRequester` their division colleagues) sees **every project they raised**, with all of its tasks, changes, versions, assignees, deadlines, statuses and history. Nothing should be missing.
- Main endpoint: `GET /work-requests/my-requests` (`getMyWorkRequests`; it already chains filter, pagination and search middleware). Check also the PMT review lists.
- Server-side filters: **deadline** (date range), **artist name**, **requester name**, status, vertical/request type, project, plus free-text search.
- Sorting: **deadline ascending and descending**, created date, status, project name. Sort keys come from a whitelist, never passed raw into ORDER BY. Ties need a stable sort (add `id`).
- Pagination as today (`page`/`limit`, `limit=-1` = all), plus a `pagination` object. Client-supplied keys go through `pickModelFilters` / `pickModelFields`.
- **Do not break the response contract.** Keep the existing shape; adding fields such as `pagination`/`summary` is fine. Prove it with before/after JSON.

### R4. Fast and smooth
- No N+1 queries: use `separate: true` for one-to-many includes, batch lookups and the composite indexes in `migrations/add_performance_indexes.sql`. Add an index migration when a new filter or sort needs one.
- Count queries run over FROM/WHERE only. Fetch the page's IDs first, then build the rows (see `getTaskDetailsData`).
- Measure before and after (SQL count per request, ms) on the local dump copy. Target: list endpoints well under 300 ms.
- Mutating admin routes keep `invalidateAdminCache`.

### R5. Proper error handling
- Every handler: validate input (`parseId`, `parseIdArray`, `parseIdList`, `parseDateOnly`) → 400 with a clear message. Access → 403. Not found → 404. Wrong current status → 400/409 with the reason. Unexpected → 500 with a generic message, while the real error goes to the log with context (endpoint, user id, ids).
- No silent `catch` that returns success, no unhandled promise, and no crash on bad input (for example a string where an array was expected).
- Emails never break a committed action (`sendMail` never throws), but failures are logged.
- Keep the existing error JSON shape (`{ success: false, error }` / `message`) so the apps keep working.

---

## 4. Testing: end to end

### Test accounts: `.env.e2e.local` (repo root)
The file holds the UAT login details. **Read the values from the file and never copy the passwords** into code, commits, logs, chat or this document.

| Key | Role in the test |
|---|---|
| `E2E_API_TARGET` | Backend the browser tests talk to (UAT: `https://alembicdigilabs.in/digilabs/uat/dmap/api`) |
| `E2E_LOGIN_TYPE` | Login tab: `email` / `employee` / `sap` |
| `E2E_PMT_ID` / `_PASSWORD` | PMT / marketing requester: creates the project and reviews as client |
| `E2E_CM_A_ID` / `_PASSWORD` | Creative Manager of vertical A |
| `E2E_ARTIST_A_ID` / `_PASSWORD`, `E2E_ARTIST_A_NAME` | Artist in vertical A (name as shown in the Assign list) |
| `E2E_CM_B_ID` / `_PASSWORD` | Creative Manager of vertical B (the sister vertical for delegation) |
| `E2E_ARTIST_B_ID` / `_PASSWORD`, `E2E_ARTIST_B_NAME` | Artist in vertical B |
| `E2E_VERTICAL_A` / `E2E_VERTICAL_B` | Vertical names exactly as shown in the request form |

> **Warning:** `.env.e2e.local` is **not git-ignored**. `.gitignore` lists `.env.local` and `.env.test.local` but not `*.local`, even though the file's header says it is. A `git add .` would commit the passwords. Add it to `.gitignore` (ask the owner first) before any commit.

### Safety rules
- `.env` points at **production**. Never run the server, the cron or the mail worker against it.
- UAT is on the same host as production. Before writing test data there, ask the owner whether UAT has its own database and whether UAT emails reach real people.
- For backend checks, prefer the local dump copy (`CLAUDE.md` → "Local testing against a dump copy"), with `EMAIL_PORT=9` so no mail goes out.
- Do not break API response contracts. Prove it with before/after JSON.
- Leave the socket email-verification code alone; the owner is testing it manually.
- Keep each file's line endings (CRLF vs LF, see `CLAUDE.md`).
- Record what you did in `CLAUDE.md` as a new session entry.

### Scenarios (check data, status, history, access and email at every step)
For each step check: the HTTP status, the response JSON, the DB rows (`work_requests`, `work_request_managers`, `tasks`, `task_assignments`, `issue_assignments`, `issue_user_assignments`, `issue_assignment_types`, documents), the `*_history` rows, the queued email (recipient and template), and that each role's lists **and the admin grids** show the item with **no blank fields** that have a value in the DB.

1. **Happy path, single vertical:** the PMT raises a project in vertical A → CM A accepts → creates 2 tasks → assigns them to Artist A → the artist accepts (with start date and deadline) → in progress → submits with a file → CM A approves → shares for client review → the PMT approves both → the project auto-completes (`auto_completed` history).
2. **Delegation:** CM A delegates a task to CM B → CM B accepts → assigns it to Artist B → done → review → PMT approval. **Access (R2):** CM A, CM B and Artist B can see and act on it; Artist A and other managers get 403 and don't see it in their lists.
3. **Own-team access (R2):** a task CM A gives Artist A is visible to CM A and Artist A only; CM B and Artist B get 403.
4. **Manager asks for rework:** CM A sends a submitted task back → it returns to the artist → resubmit → approve.
5. **PMT change requests:** the PMT asks for changes → V2 created (`issue_id`, `task_id`, version, change types) → the right manager gets it → accepts → assigns to the same artist, and in a second run to a different artist → submit → review → PMT approves. Then V3 → approve. The versions and history line up.
6. **Completion rule:** a project with several tasks, each with changes, must **not** complete while any item is open, and must complete right after the last approval.
7. **Re-open:** after completion, add a new task, and separately raise a new change → the project re-opens, with history. The new work completes it again.
8. **Multiple managers on one project:** each manager sees it, and actions by one are visible to the other.
9. **PMT view (R3):** the PMT sees all their projects with tasks, changes and assignees. Filter by deadline range, artist name and requester name, sort by deadline asc/desc, page through, and check that the results equal a direct SQL query. Check the timings.
10. **Admin grids (R1):** for the test project, every column in Projects, Tasks, Changes and Raw data matches the DB, and the counts match.
11. **Negative / error checks (R5):** wrong role, other division, other manager's task, accepting twice, acting on cancelled or completed items, bad ids, bad dates (`2026-02-31`), multipart `issue_register_ids` shapes (session 8), missing files. Expect clean 400/403/404/409, **no row written**, and no 500.
12. **Scheduler:** `accepted` tasks and `u_accepted` changes with `start_date <= today` move to `in_progress`. The daily completion job finishes finished projects. Already-approved tasks are never restarted.
13. **Emails:** every step queues the expected template to the expected people, and the PMT pending-approval reminder works (see the note in section 2).

### How to report and fix
- Keep a list of findings: step → expected → actual → root cause (file:line) → fix → how it was verified.
- Fix the root cause: guard statuses, write history, use transactions, validate before writing.
- Re-run the failing scenario and the happy path after each fix.
- Report honestly what passed, what failed and what was not tested.

### Useful entry points
- Routes: `routes/indexRoute.js` → `/auth`, `/work-requests`, `/manager/assigned-work-requests`, `/users`, `/issue-register`, `/datatable`.
- Controllers: `workRequestController.js` (`getMyWorkRequests`), `managerAssignedController.js` (create/assign/review tasks, re-open), user/task controllers (accept/submit, `pm-approve`, `pm-reject`, `assign-task`), `issueRegisterController.js` (changes), `adminController.js` (admin grids).
- Services: `accessService.js` (permissions), `historyService.js`, `workRequestCompletionService.js`, `taskSchedulerService.js`, `mailService.js`, `templateService.js`.
- Utils: `utils/validators.js`, `utils/queryFilters.js`; middleware `filterMiddleware`, `paginationMiddleware`, `searchMiddleware`.
- Manual API calls: `D-Map-API.postman_collection.json`.
