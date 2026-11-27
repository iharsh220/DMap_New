# D-Map live production test log

- **Started:** 2026-11-27 (IST)
- **Site:** https://dmap.alembicdigilabs.com/ (user app); the API is `https://alembicdigilabs.in/digilabs/dmap/api`; the admin panel is `…/digilabs/dmap/api/datatable/admin/*`
- **Backend version on production:** 1.11.3, the same as the local code at `dc1f983`
- **How:** Chrome driven through remote debugging (UI clicks, console errors and every API call logged). Each step is checked against the production DB with **read-only** SELECTs. No application code was changed.
- **Accounts** (from `.env.e2e.local`):

  | Alias | User | Role | Division |
  |---|---|---|---|
  | PMT | #68 Sandesh Pujari | 8 Business Enabler (test client) | HR |
  | CM A | #21 Kiran Thekootu | 2 Creative Manager | Web Application |
  | Artist A1 | #20 Nikhil Nadkar | 4 Creative User | Web Application |
  | Artist A2 | #66 Harsh Gohil | 4 Creative User | Web Application |
  | CM B | #24 Bhagwan Parab | 2 Creative Manager | Graphic |
  | Artist B | #192 Mangesh Khale | 4 Creative User | Graphic |
  | CM C | #28 Divya Raval | 2 Creative Manager | Content |
  | Artist C | #29 Vinisha Chadala | 4 Creative User | Content |

- **Test data:** every project created by this run is named `TEST_LIVE_2711_*`.
- **Rules agreed with the owner:** task = V1, changes start at V2; managers and artists are the real internal team, and emails to them are fine.

Problems found: [frontend.md](frontend.md) (id `F-xx`) and [backend.md](backend.md) (id `B-xx`).

## Summary (27 Nov 2026)
- **Main workflow works end to end on production**: PMT request → CM accept → task → artist accept / submit → rework → approve → share → PMT change V2 → V3 → PMT approve → project auto-completes (P1 #3015). Manager → Manager → Artist delegation (P2 #3017), defer + transfer (P3), change cancel, task delete, project cancel (P4), attachments, self task, task edit (P5) also work. Access isolation, date and page rules, read-only cancelled projects: all hold.
- **Findings**: 19 frontend ([frontend.md](frontend.md)) + 21 backend ([backend.md](backend.md)) = 5 High, 20 Medium, 15 Low. Admin panel findings are parked in [admin-later.md](admin-later.md).
- **High**: F-03 API errors never shown (user clicks, nothing happens); F-08 change detail page empty when opened by link / reload; B-09 PMT reference file becomes the artist's "output" and is shared back to the client (35 files already in production); B-11 delegated manager cannot see the project / its task list; B-19 manager search ignored with the overdue filter.
- Production data: the data rules are clean; 83 changes without change types, 39 + 35 B-09 rows, 32 projects stuck in `accepted` (section 9).

Legend: ✅ pass · ❌ fail (see frontend.md / backend.md) · ⚠️ works but has a gap · ⏭️ not tested

## 0. Login and session
| # | Step | Result | Notes |
|---|---|---|---|
| 0.1 | PMT logs in through the UI (email tab) | ✅ | 3.1 s, lands on `/dashboard/pmt/projects`; `token`, `refreshToken` and `user` are stored in localStorage |
| 0.2 | All 8 accounts log in (API) | ✅ | roles and divisions as in the table above |
| 0.3 | Production version | ✅ | `whats-new` current = 1.11.3 |

## 1. Scenario P1: PMT → CM A → Artist A1 (project #3015 `TEST_LIVE_2711_P1_WEB`, Web & Digital Solutions / Static Website)
| # | Step (who, where) | Result | Notes / DB check |
|---|---|---|---|
| 1.1 | PMT: New request, submit an empty form | ✅ | shows "Minimum 10 words required", nothing is sent |
| 1.2 | PMT: fill the form (work type, project type, publish, target, priority) → Submit → "Confirm Submission?" → Confirm | ✅ | `POST /work-requests` 201, lands on "Project Request Submitted!". DB: `work_requests` 3015 `pending`, priority `medium`, `about_project` JSON correct, manager 21 in `work_request_managers` |
| 1.3 | PMT: attach a brief file | ⏭️ | Chrome could not read the test file (`net::ERR_ACCESS_DENIED`, a sandbox limit on my side); the upload is tested through the API later. The screen showed no error message for the failed request (F-01) |
| 1.4 | DB: history of the created request | ⚠️ | `work_request_history` `created` has `previous/new_status = null` (B-02) |
| 1.5 | Other users open #3015 (CM B, CM C, Artist A1, Artist C) | ✅ | manager detail 404, `/work-requests/:id` + history 403; CM B accept 404, Artist C accept 403 |
| 1.6 | CM A: `GET /work-requests/3015` | ❌ | 404 "Work request not found" for the project's own manager (B-03) |
| 1.7 | CM A: Requests list shows the new project, opens the detail page | ✅ | PMT details, project details correct; the page calls `GET /manager/assigned-work-requests/3015` 3 times (F-02) |
| 1.8 | CM A: Accept Project | ✅ | `PUT …/3015/accept` 200, DB `pending → accepted`, history `manager_accepted` 21. No confirmation dialog |
| 1.9 | Accept again (API) | ✅ | 400 "Work request is already accepted" |
| 1.10 | CM A: New Task → Assign list | ✅ | only CM A's Web team + "Self" (no other vertical, no PMT) |
| 1.11 | CM A: Task Type list, Deadline calendar | ✅ | past days and weekends are disabled; Confirm with no date keeps "Create Task" disabled |
| 1.12 | CM A: Create Task (Artist A1, Front-End Development, 30 Nov) | ✅ | `POST …/tasks` 201. DB task 3767 `pending` / review `pending` / `not_started`, assignee 20, `task_count` 0, history `created`. The task card shows the request type "Web & Digital Solutions", not the task type |
| 1.13 | Artist A1: Requests list → open task → Accept Task → start date picker (today) → Confirm | ✅ | `PUT /users/tasks/3767/accept` 200. DB `pending → in_progress`, `start_date` 27 Nov, history `accepted` |
| 1.14 | DB: project status after the first task starts | ⚠️ | the project stays `accepted` while its task is `in_progress`; it only becomes `in_progress` with the 00:01 cron (B-04) |
| 1.15 | Artist A1: My Tasks search | ⚠️ | the task search works; the change search (`/users/issues?search=`) ignores the text and returns unrelated changes (B-06) |
| 1.16 | Artist A1: Submit Task with pages = 0 | ❌ | the frontend accepts 0 and moves on to the Link step; the API rightly returns 400 "task_count … at least 1", but **no error is shown**, so the artist is stuck (F-03). DB unchanged ✅ |
| 1.17 | Artist A1: Submit Task, pages 2, options 1, Link | ✅ | `POST /users/tasks/submit` 200. DB `completed`, stage `manager_review`, `task_count` 2, `end_date` 27 Nov, `link` saved |
| 1.18 | Submit again / other artist submits / other artists open the task (API) | ✅ | 400 "must be accepted or in_progress"; Artist A2 404; Artist C and A2 view 404 |
| 1.19 | CM A: task detail → Request Change (rework) with comment | ✅ ⚠️ | `PUT …/review` 200. DB `completed → in_progress`, `end_date` cleared, `task_review_history` row with the comment. History row is contradictory: `new_review = pending`, but `changes.review = change_request` (B-05) |
| 1.20 | Artist A1 sees the rework comment, submits again (3 pages) | ✅ | DB `completed`, `task_count` 3 |
| 1.21 | CM A: Approve → Confirm | ✅ ⚠️ | stage `manager_review → pm_review`. After the approval the "Request Change" and "Approve" buttons are still shown (F-04) |
| 1.22 | CM A: Share with client → tick the link → Send Files | ✅ | `POST …/share-for-client-review` 200, `intimate_client` 1, task + project history `shared_for_client_review` |
| 1.23 | PMT: Projects list → project → OUTPUT tab shows V1 with Request Change / Approve | ✅ | the TASKS tab row does not open anything for the PMT (only OUTPUT has actions) |
| 1.24 | PMT: Request Change → pick change types (Bug fixes, Colour Update) → description → attach a file → Send Request | ✅ ⚠️ | `POST /issue-register/assignment` 201. DB change #1851 **V2**, `m_pending`, requester 68, PMT file stored (row of user 68, `uploaded_by = pmt`); task `review = change_request`. History of the task says stage `final_approved → change_requested`, but the task was `pm_review` and still is (B-07) |
| 1.25 | PMT attachment URL | ⚠️ | `GET /digilabs/dmap/api/uploads/...png` returns 200 **without a token** (B-08) |
| 1.26 | CM A: Requests → CHANGE tab → V2 "Pending for your action" → open | ⚠️ | type and description shown, but **the PMT's attached file is not shown** (the API does send it in `pmt_documents`) (F-05) |
| 1.27 | CM A: Accept Change → assign screen (pre-filled with the task's artist + deadline) → change artist to Harsh (A2) → Send Request | ✅ | `PUT …/issue/1851/accept` 200, `POST …/assign-issue-to-user` 200. DB V2 `u_pending`, assignee 66, deadline 30 Nov. The list shows only CM A's Web team |
| 1.28 | Assign V2 to the PMT / to Artist C / by CM B / by an artist; CM B accepts V2 (API) | ✅ | 403 each, nothing changed |
| 1.29 | Artist A2: Requests → CHANGE → open V2 | ⚠️ | the PMT file is listed twice; the artist gets a "Cancel Change" button that the API always refuses (403) (F-06, F-07) |
| 1.30 | Artist A2: Accept Change → start date today | ✅ | DB V2 `in_progress`, start 27 Nov |
| 1.31 | Artist A2: open `/dashboard/issuedetails/1851` directly (URL / reload) | ❌ | empty page: "Invalid Date", "Issue Acceptance Pending", no data; the page makes no API call (F-08) |
| 1.32 | Artist A2: My Tasks → V2 → detail | ⚠️ | the PMT file shows twice under Resources **and** under OUTPUT FILES before anything is submitted; PROJECT NAME empty (F-06, F-09, B-09) |
| 1.33 | Artist A2: Submit Change with pages 0 | ❌ | API 400 (correct); no message on screen, only `console.error "Error submitting issue: [object Object]"` (F-03) |
| 1.34 | Artist A2: Submit Change, 2 pages, **Files** mode with an output file | ✅ | `PUT /users/issues/1851/submit` 200. DB V2 `completed` / `manager_review`, pages 2, end 27 Nov, `output-v2.png` stored (`uploaded_by = user`). The PMT file (2467) now sits under the artist's row (user 66) (B-09) |
| 1.35 | CM A: V2 detail → OUTPUT FILES | ❌ | shows `pmt-change-ref.png` (the PMT's reference) as an artist output next to `output-v2.png` (B-09) |
| 1.36 | CM A: Approve → Confirm → Share with client | ⚠️ | 200. The share dialog **pre-ticks every file**, including the PMT reference; the PMT reference was shared (`intimate_client = 1`) and the PMT received their own file as the "V2 output" (F-10, B-09) |
| 1.37 | PMT: OUTPUT → V2 → Request Change (Theme Update) | ✅ ⚠️ | 201, V3 #1852 with `issue_id = 1851`, `m_pending`, no assignee. V2 `review = change_request`. History again logs stage `final_approved` as the previous value (B-07) |
| 1.38 | V3 (API, same calls as the app): CM A accept + assign A2, A2 accept | ✅ | 200 each |
| 1.39 | V3 submit negatives: end before start, end in future, `2026-02-31`, pages 2.5, no pages | ✅ | 400 each with a clear message |
| 1.40 | V3 submit (1 page, file) → CM A approve + share in UI | ✅ | the share dialog lists only `output-v3.png` (pre-ticked) |
| 1.41 | PMT: OUTPUT → V3 → Approve → Confirm | ✅ | `POST /work-requests/pm-approve` 200. DB: V3 `approved/final_approved`; V2 closed as `approved_with_later_version`; task 3767 `approved/final_approved`; **project 3015 `accepted → completed` (`auto_completed`)** |
| 1.42 | Approve again / Artist C approves (API) | ✅ | duplicate returns 200 but writes no new history; Artist C 403 "Only the requester can approve" |
| 1.43 | Admin grids for #3015 (Projects, Tasks, Changes) | ⚠️ | FY 2026-27, November, task_count 1, change_count 2, change pages 3 ✅; `project_completion_timestamp` = **"N/A"** for the auto-completed project (B-10) |
| 1.44 | Emails | ⏭️ | the API cannot show sent mail. The team should have received: new request (Kiran), task assigned (Nikhil), change assigned (Harsh), share for review (Sandesh) |

## 2. Scenario P2: Manager → Manager → Artist delegation (project #3017 `TEST_LIVE_2711_P2_DELEG`, Web; task #3769 to Graphic)
| # | Step (who, where) | Result | Notes / DB check |
|---|---|---|---|
| 2.1 | PMT creates the project; CM A accepts | ✅ | 201 / 200, DB `accepted` |
| 2.2 | CM A: New Task → Request Sister Vertical → list of verticals and managers | ✅ ⚠️ | also lists CM A's own vertical (Web & Digital Solutions → Kiran), which makes no sense for delegation (F-11) |
| 2.3 | CM A: pick Bhagwan Parab (Design & Graphics) → Project Type → Task Type (Template) → Send Request | ⚠️ | `POST …/tasks` 201, task 3769 assigned to CM B (24). **No deadline is asked**, so the task has `deadline = NULL` (F-12) |
| 2.4 | CM B: Requests → TASKS shows the delegated task | ✅ | |
| 2.5 | CM B: the project in his project list / `GET …/work-request/3017/tasks` | ❌ | project list empty for #3017; task list 404 "Work request not found or not assigned to you" (B-11). `GET /users/tasks/3769` 200 |
| 2.6 | CM B: open the task → Accept Task (opens the assign panel) → pick Mangesh Khale → Deadline 30 Nov → Assign Task | ✅ | `PUT /users/tasks/3769/accept` + `POST /users/assign-task` 200. DB task `accepted → pending`, assignee 192, deadline 30 Nov; the list shows only CM B's Graphic team |
| 2.7 | Owner's rule (6 Nov): creator CM A may only view | ✅ ⚠️ | CM A edit 404, take back to own artist 403, view task 200, project task list shows the task with Mangesh. CM A's own `/users/tasks` list does **not** show it (B-12). CM C and Artist A1 view 404 ✅ |
| 2.8 | Artist B accepts + submits with a file (API) | ✅ | `in_progress → completed`, 2 pages, `graphic-output.png` stored |
| 2.9 | CM B: task detail → Approve → Confirm → Share with client | ✅ | `PUT …/review` 200 (the app uses `/review`, not the per-document review endpoints that returned 404 yesterday, so those only affect an unused API), share 200 |
| 2.10 | PMT approves (API) | ✅ ⚠️ | 200, `work_request_completed: true`, project `accepted → completed` (`auto_completed`). The `pm_approved` history row has before = after (`approved → approved`, `final_approved → final_approved`) (B-13) |

## 3. Scenario P3: defer and transfer (project #3018 `TEST_LIVE_2711_P3_DEFER`)
| # | Step | Result | Notes / DB check |
|---|---|---|---|
| 3.1 | CM A: Defer Project → "Insufficient details" → Inform Client with an empty message | ❌ | API 400 "message is required for insufficient_details reason"; nothing shown on screen (F-13) |
| 3.2 | Same with a message | ✅ ⚠️ | 200; `work_request_deferrals` row with reason + message. Project status stays `pending`; history `manager_deferred` has no status values (B-14) |
| 3.3 | PMT: PENDING tab shows "More details required, please resubmit" + Edit Project; the detail page shows the manager's message | ✅ ⚠️ | the Edit form itself does not show what the manager asked for (F-14) |
| 3.4 | PMT: edit the description → Submit → Confirm | ✅ | `PUT /work-requests/3018` 200; deferral `client_resubmitted_at` set, `resubmission_count` 1; history `resubmitted` |
| 3.5 | CM A: Defer → Different Vertical → Design & Graphics / Bhagwan Parab → project type → Defer Project | ✅ ⚠️ | 200; request type 4 → 1, project type 27 → 9, manager 21 → 24. CM A now 404, CM B 200. The vertical list also offers CM A's own name (under Consulting & Advisory) (F-11) |

## 4. Scenario P4: change cancel, task delete, project cancel (project #3019 `TEST_LIVE_2711_P4_CANCEL`)
| # | Step | Result | Notes / DB check |
|---|---|---|---|
| 4.1 | CM A creates 4 tasks (API) | ✅ | 3770–3773 |
| 4.2 | createTask negatives (API): deadline `2026-02-31`; artist of another team (Artist C) | ✅ | 400 / 403 |
| 4.3 | createTask with a **past** deadline (2026-11-20) (API) | ❌ | 201, task 3774 saved with an overdue deadline (the UI calendar blocks past days, the API does not) (B-15) |
| 4.4 | T1: accept → submit → approve → share → PMT raises change V2 #1853; T2: artist A2 accepts (in progress) | ✅ | |
| 4.5 | CM A: Requests → CHANGE → V2 → Cancel Change → reason "Already Addressed" + comment → Confirm Cancellation | ✅ | `PUT …/issue/1853/cancel` 200; change `cancelled` (`is_deleted` 1); task T1 back to review `pending` / `pm_review` (history `review_reset_to_pm`) |
| 4.6 | CM A: task 3774 → ⋮ → Delete → "Permanently delete this task?" → Confirm | ✅ | `DELETE …/tasks/3774` 200, soft delete (`is_deleted` 1). Afterwards the artist gets 404 on view/accept; artist delete 403, CM B delete 404. History `deleted` has no status values |
| 4.7 | Cancel preview (API) | ✅ | tasks: in_progress 1, not_started 2, pending_approval 1; artist 403. The app never shows this preview before cancelling (F-15) |
| 4.8 | CM A: project ⋮ → Mark as Cancel → reason "abc" (Yes stays disabled) → valid reason → Yes | ✅ | `PUT …/3019/cancel` 200. Project `cancelled`; T2 `in_progress → cancelled` with end date today; T3/T4 `pending → cancelled`, no dates; T1 unchanged + `flagged_on_cancellation`; history `cancelled_with_project` per item |
| 4.9 | After cancel: new task, PMT new change, cancel again | ✅ | 400 "This project is cancelled and read-only" / "already cancelled" |
| 4.10 | PMT approves the flagged T1 | ✅ ⚠️ | 200; project stays `cancelled`. History before = after again (B-13) |
| 4.11 | Project ⋮ menu also shows "Mark as Complete" and "Delete Project" | ⏭️ | not run on production (Mark as Complete force-closes everything; Delete removes the project) |

## 4b. Scenario P5: brief attachments, self task, edit, Mark as Complete (project #3020 `TEST_LIVE_2711_P5_SELF`)
| # | Step | Result | Notes / DB check |
|---|---|---|---|
| 4b.1 | PMT: new request with 2 attached files (pdf + png) → Submit → Confirm | ✅ | 201; both files in `work_request_documents` and on disk |
| 4b.2 | CM A: project detail shows both ATTACHED FILES | ✅ | |
| 4b.3 | CM A: Accept → New Task → Assign → **Self** → task type → deadline → Create Task | ✅ | task 3777 assigned to 21 |
| 4b.4 | CM A: task ⋮ → Edit → rename + reassign to Harsh → Update Task | ✅ | `PUT …/tasks/3777` 200; name and assignee (66) changed; history `updated` (no field values in status columns) |
| 4b.5 | CM A: project ⋮ → Mark as Complete → Confirm (task still pending, 0 pages) | ❌ | API 400 "Add the number of pages before completing: task … (#3777)" (correct, nothing changed), but **no message on screen** (F-03) |
| 4b.6 | Initiative request (CM), PMT Activity module | ⏭️ | separate modules, not tested today |

## 5. User app: every page per role (Chrome, console errors + failed API calls + "Invalid Date/undefined/NaN" text)
| # | Role / page | Result | Notes |
|---|---|---|---|
| 5.1 | PMT: Projects, My Team, Activity, Profile, New request | ✅ | no console errors, no failed API calls, 2.2–2.7 s per page |
| 5.2 | PMT: project detail `/projectstatus/3015` | ⚠️ | `GET /work-requests/3015` called 4 times (F-02) |
| 5.3 | PMT: Completed Projects | ❌ | every project shows the date **"16th Dec '25"**; cancelled projects are listed as completed with no "Cancelled" label (the CM page shows "Canceled") (F-16) |
| 5.4 | PMT: Guidebook | ⚠️ | page is empty (only the title) (F-17) |
| 5.5 | CM: Requests, Work Overview, My Tasks, My Team, Analytics, Initiative request, New request, Completed, member tasks | ✅ | no errors |
| 5.6 | CM: `/dashboard/cm/ProjectAssign` opened directly | ❌ | calls `GET /manager/assigned-work-requests/undefined` → 400; page shows "sd", "Invalid Date" (F-08) |
| 5.7 | CM: `/dashboard/cm/memberdetails` | ❌ | placeholder page with fixed data: "Jayesh", Available/Balanced/Overloaded/Active Tasks all **2003** (F-18) |
| 5.8 | CM: assign list "Self – 8 Tasks" vs My Tasks "No tasks yet" | ❌ | the active-task count includes 6 soft-deleted tasks (B-16) |
| 5.9 | Artist: Requests, My Tasks, My Team, Profile, New request, own task details | ✅ | no errors |
| 5.10 | Artist opens a task that is not theirs (`/taskdetails/3769`) | ⚠️ | API 404 (correct), but the page shows a broken layout ("sd", "Invalid Date", "Task Acceptance Pending") instead of "not found / no access" (F-19) |

## 6. Admin panel (parked: owner asked to test the admin panel later; findings moved to admin-later.md) (`/digilabs/dmap/api/datatable/admin/*`) per role
| # | Role / page | Result | Notes |
|---|---|---|---|
| 6.1 | CM A: Overview, Client requests, Projects, Tasks, Changes, Master data, Reports, What's new | ✅ | every grid loads 25 rows + KPI cards, no console errors, ~3.5 s per page. Nav shows Report + Setup (manager) |
| 6.2 | CM A / Artist: Raw data, Feedback, Leaves, Rate card | ✅ ⚠️ | redirected to Overview (correct), but done by throwing an uncaught JS error "Admins only" (F-20) |
| 6.3 | Artist A1: Overview, Client requests, Projects, Tasks, Changes | ✅ | loads; no Edit/Delete; no cost columns; Master data → redirected |
| 6.4 | Data visible in the admin grids (API) for Artist A1, Artist C, PMT, CM A | ❌ | **everyone gets all rows**: 2,677 projects, 2,776 tasks, 1,788 changes, 2,715 client requests of every division (incl. requester contact details); an artist can open the Linked work of another vertical's project (#3017) (B-17) |
| 6.5 | Side effect of the test | ⚠️ | opening What's new as Kiran marked release 1.11.3 as seen for her (no popup for her for this release) |

## 7. Security / session
| # | Check | Result | Notes |
|---|---|---|---|
| 7.1 | No token on a user API and an admin API | ✅ | 401 |
| 7.2 | Tampered / random token | ✅ | 403 |
| 7.3 | `/uploads/..%2f..%2f.env` | ✅ | 403 |
| 7.4 | Logout, then reuse the access token | ✅ | 401 |
| 7.5 | Logout, then `POST /auth/refresh-token` with the old refresh token | ❌ | 200, a new session can be created after logout (B-18) |
| 7.6 | Uploaded files without a token | ❌ | see B-08 |
| 7.7 | Login response | ⚠️ | see B-01 |

## 8. Lists, filters, pagination (API, read-only)
| # | Check | Result | Notes |
|---|---|---|---|
| 8.1 | `GET /users/tasks?search=ZZZ_NO_SUCH_TASK&status=overdue` as CM A / CM B | ❌ | 12 / 21 unrelated overdue tasks (the search is dropped when `status=overdue`); artist 0 (B-19) |
| 8.2 | `GET /manager/assigned-work-requests?limit=-1` | ❌ | 500 "Something went wrong" (B-20) |
| 8.3 | `GET /users/issues?limit=1` | ⚠️ | returns 6 rows, no `pagination` (B-21) |
| 8.4 | `GET /manager/assigned-work-requests/user/20/tasks` | ❌ | 25 tasks, `workRequest = null` on all 25 (B-22) |
| 8.5 | `GET /manager/assigned-work-requests/my-team?limit=1` | ⚠️ | whole team incl. the manager, no pagination (owner to decide if the manager should be listed) |
| 8.6 | `GET /work-requests/my-requests?limit=-1` (PMT) | ✅ | 200 |
| 8.7 | bad `page`/`limit`, `sort_by` injection, unknown params | ✅ | 200, no 500 |

## 9. Production data audit (read-only SELECTs, `scripts/audit-data-integrity.js` + extra checks, 27 Nov 2026)
| Check | Count | Notes |
|---|---|---|
| Completed tasks / changes without dates, with 0 pages, end < start | 0 | data rules of sessions 22/28/30 hold ✅ |
| Change requests without change types | **83** | ids 1577–1676 (multipart crash of session 8; more than the 43 in the dump) |
| Live tasks / changes without any history row | 728 / 398 | created before the history tables (expected) |
| Completed task whose review never started | 1 | task 801 |
| Open task with an end date | 1 | task 3134 |
| **PMT attachments sitting on an artist's row** | **39 changes** | B-09 (e.g. 1851, 1835, 1833 …) |
| **PMT attachments already shared back to the client as output** | **35 files** | B-09 (e.g. 2467, 2429, 2428 …) |
| Projects still `accepted/assigned` while a task is `in_progress` | 32 | B-04 (e.g. 3012, 3010, 3008 …) |
| Open live tasks with no deadline | 11 | F-12 (sister-vertical delegation) |
| Leftover test project from the 26 Nov UAT/prod run | 1 | #3014 `TEST_PROD_CHECK_…` still `accepted`, in Kiran / Nikhil's lists |
| Other checks (no assignee, no manager, completed with open work, duplicates …) | 0 | ✅ |

## 10. Yesterday's 37 failures (26 Nov suite), status after today's live check
| Group | Status today |
|---|---|
| Delegation: CM B project list / task list 404 | still there → B-11 |
| Delegation: CM B per-document review 404 | the app does not use those endpoints → low priority |
| Delegation: CM A loses the task from `/users/tasks` | still there → B-12 |
| Completed task with `start_date` NULL | not reproduced through the app (the accept screen requires a start date); API-only edge case, see 26 Nov report |
| `2026-02-31` → 500 on update task / create change / pm-reject | not re-run on production (would need write calls on live projects); same code as UAT, so still expected |
| pm-reject on a completed project / stale end date | not re-run (writes); same code |
| V1 allowed for changes | **not an error** (owner: task = V1, changes from V2) |
| Project stays `accepted` when work starts / re-open status | confirmed → B-04 (32 projects in production) |
| Search + overdue clobber | confirmed → B-19 |
| `/users/issues` default only `u_pending` | **not an error** for the app (the app sends `status` on the other tabs) |
| `/users/issues` no pagination / no search | confirmed → B-21, B-06 |
| `user/:id/tasks` workRequest null | confirmed → B-22 |
| my-team includes the manager / no pagination | confirmed, decision needed (8.5) |
| Wrong "before" values in history (pm-approve, pm-reject, rework, change create, WR update) | confirmed for pm-approve, rework, change create → B-05, B-07, B-13 |
| Auto-completed project completion timestamp N/A | confirmed → B-10 |
| Duplicate pm-approve | returns 200 but writes no new history → harmless |
| Missing emails / no mail log | not visible through the API; check inboxes (1.44) |

## 11. Test data left on production
| Project | State | Note |
|---|---|---|
| #3015 `TEST_LIVE_2711_P1_WEB` | completed | task 3767, changes 1851 (V2) / 1852 (V3) |
| #3017 `TEST_LIVE_2711_P2_DELEG` | completed | task 3769 (Graphic, Mangesh) |
| #3018 `TEST_LIVE_2711_P3_DEFER` | **pending, in CM B (Bhagwan)'s queue** | needs CM B to cancel/delete, or the owner |
| #3019 `TEST_LIVE_2711_P4_CANCEL` | cancelled | tasks 3770–3774, change 1853 |
| #3014 `TEST_PROD_CHECK_…` (26 Nov run) | accepted, open | still shows in Kiran's / Nikhil's lists |
| #3020 `TEST_LIVE_2711_P5_SELF` | accepted, task 3777 pending for Harsh | cancel or delete when done |
