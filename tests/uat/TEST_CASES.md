# D-Map manual test cases (UAT, frontend)

Frontend: https://dmap.alembicdigilabs.com/ (UAT backend). Accounts: see `.env.e2e.local`
(PMT = requester, CM A / artist A = Web Application, CM B / artist B = Graphic, CM C / artist C =
Content). Name every project `E2E manual <date> - please ignore`.

For every step write down the **time** you did it and check the **history** afterwards (project
history, task history, change history) and the **admin panel** (Projects / Tasks / Changes →
open the row → Linked work). Admin data can be up to 1 minute old.

Result column: ✅ ok, ❌ bug (add it to `ISSUES.md`), ⚠️ works but not as wanted.

## TC-1 Full flow with two rounds of changes (automatic: s1)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | PMT | Raise a project: "Web & Digital Solutions", Static Website, brief file | Status Pending; requested date/time = now; CM A gets the request (email) | |
| 2 | CM C | Try to accept it | Not visible / not allowed | |
| 3 | CM A | Accept | Status Accepted; project history "manager_accepted" with time and CM A | |
| 4 | CM A | Create task T1 for artist A, deadline +7 days, 2 pages | Task Pending, deadline set, no start / end date; artist A gets it; history "created" | |
| 5 | CM A | Try to give a task to artist C (other vertical) | Refused | |
| 6 | artist A | Accept T1, start today | In progress, start date = today; history "accepted" | |
| 7 | artist A | Submit with 0 pages | Refused ("number of pages") | |
| 8 | artist A | Submit with 2 pages, link, file | Completed, end date = today, waiting for manager review; history "submitted" | |
| 9 | CM A | Send back for rework | Back with the artist; **end date should be empty** (see ISSUES #4); history "manager_change_requested" | |
| 10 | artist A | Resubmit | Completed again, end date = today | |
| 11 | CM A | Approve, then share with the client | Waiting for PMT review; history "manager_approved", "shared_for_client_review" | |
| 12 | PMT | Give changes on T1 (pick a change type, deadline +5) | New change **V2** (see ISSUES #1: shows V1), waiting for the manager; history "pm_rejected" + "pm_change_request_created" | |
| 13 | CM A | Accept V2, assign to artist A | V2 assigned; history "manager_accepted", "assigned" | |
| 14 | artist A | Accept V2, submit (1 page) | V2 completed, start/end today | |
| 15 | CM A | Approve V2, share | V2 waiting for PMT | |
| 16 | PMT | Give changes on V2 | New change **V3** (shows V1, ISSUES #1); V2 keeps its data | |
| 17 | CM A / artist A | Accept, assign, accept, submit, approve, share V3 | V3 waiting for PMT | |
| 18 | PMT | Approve V3 | V3 and T1 final approved; **V2 completed** and **project Completed** with history "auto_completed" (see ISSUES #2: V2 stays In progress, project stays Accepted) | |
| 19 | admin | Projects → the project → Linked work | Project → T1 → V2, V3 with the right status, dates, pages | |

## TC-2 Manager → Manager → User (automatic: s2)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | PMT | Raise a Web project; CM A accepts | | |
| 2 | CM A | Create task T2 for **CM B** (Graphic manager) | Allowed; CM B gets it | |
| 3 | CM A | Try to give a task straight to artist B | Refused ("own team or a Digilabs manager") | |
| 4 | CM B | Assign T2 to artist B (deadline +8) | Artist B gets it; history "assigned" by CM B | |
| 5 | CM B | Try to assign T2 to artist A | Refused | |
| 6 | CM A, CM B, artist B | Open T2 | All three see it; artist A and CM C do not | |
| 7 | CM A | Try to edit T2 or re-assign it | **Should be refused: CM B is the main manager, CM A only views** (ISSUES #6: today allowed) | |
| 8 | artist B | Accept, submit (3 pages) | Completed, start/end today | |
| 9 | CM B | Approve, share | Waiting for PMT | |
| 10 | PMT | Approve | Final approved; project Completed | |
| 11 | admin | History of T2 | created by CM A → assigned by CM B → accepted / submitted by artist B → approved / shared by CM B → approved by PMT | |

## TC-3 Cancel a project (automatic: s3)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | CM A | Project with 3 tasks: one accepted (started), one not accepted, one submitted + shared | | |
| 2 | CM A | Cancel without a reason | Refused | |
| 3 | CM C | Cancel | Not allowed | |
| 4 | CM A / admin | Cancel with a reason (admin panel: Projects → row → Cancel project shows the summary first) | Started task: Cancelled, end date = today; not started: Cancelled, no dates; submitted: unchanged; everyone gets an email | |
| 5 | artist A, CM A, PMT | Submit / new task / edit / give changes | All refused: "This project is cancelled and read-only" | |
| 6 | PMT | Approve the submitted task | Allowed; project stays Cancelled | |
| 7 | admin | Project history | "cancelled" with reason; each task "cancelled_with_project" / "flagged_on_cancellation" | |

## TC-4 Cancel a change (automatic: s4)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | | Task submitted, approved, shared; PMT gives changes (V2) | | |
| 2 | CM C | Cancel V2 | Not allowed | |
| 3 | CM A | Cancel V2 | V2 gone from the lists; task back to PMT review | |
| 4 | PMT | Approve the task | Final approved, project Completed (**ISSUES #3: refused, task stuck In progress**) | |

## TC-5 Delete (automatic: s5)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | CM A | Delete one of two tasks | Gone for everyone; the other stays | |
| 2 | CM C | Delete the project | Not allowed | |
| 3 | CM A | Delete the project | Gone from the PMT list and the artist's tasks; history keeps "deleted" | |

## TC-6 Defer (automatic: s6)
| # | Who | Step | Expected | Result |
|---|---|---|---|---|
| 1 | CM A | Defer a new project: insufficient details + message | PMT gets the message; project stays Pending (by design); history "manager_deferred" | |
| 2 | CM A | Accept it after the PMT updates it | Accepted | |
