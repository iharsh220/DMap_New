# D-Map UAT issues

Found by the UAT end-to-end runner (`node tests/uat/run.js`) on 2026-11-06 against
`https://alembicdigilabs.in/digilabs/uat/dmap/api` (What's new 1.9.0). Each run appends its failed
checks at the bottom of this file ("Run … (automatic)"); move what is real into the list below and
mark it **fixed** when done.

Severity: **BUG** = wrong data or a dead end, **GAP** = works, but not the way the owner wants it,
**INFO** = worth knowing.

Version rule (owner): the task itself is **V1**; the first change on it is **V2**, the next **V3**, …

## Summary: what failed where (run 2026-11-06 09:57 IST, report `results/run-2026-11-06T04-28-02.md`)

| # | Type | Scenario / step | What the system did (actual) | What it should do | Example on UAT |
|---|---|---|---|---|---|
| 1 | BUG | S1: PMT clicks "give changes" on task T1 | New change saved as **version "V1"** | **V2** (task = V1) | project #2859, task #3521, change #1666 = "V1" |
| 1 | BUG | S1: PMT gives changes again on that change | Next change also **"V1"** (parent #1666) | **V3** | change #1667 = "V1" |
| 2 | BUG | S1: PMT approves V3 (last approval) | Older change V2 left **status "in_progress"** with review "final_approved"; project stays **"accepted"**, no "auto_completed" history | V2 completed; project **completed** automatically | change #1666, project #2859 |
| 3 | BUG | S4: manager cancels the change, then PMT approves the task | API error **400 "Only a completed task can be approved (current status: in_progress)"**: task stuck | Task back to completed + PMT review; PMT can approve; project completes | project #2862 |
| 4 | BUG | S1: manager sends T1 back for rework | Task "in_progress" but **end_date still 2026-11-06** (from the first submit) | End date empty until the artist resubmits | task #3521 |
| 5 | BUG | S1: PMT approves V3 | **Two identical "pm_approved" rows** in V3's history (same second); the other changes of the task also get a "pm_approved" row | One row, only for the approved change | change #1667 |
| 6 | GAP | S2: CM A (created the task) after CM B received it | CM A could **rename** the task (200) and **re-assign it to his own artist** (200 "Task assigned to user successfully"), which removed CM B's artist | Only CM B (main manager) may act; CM A only views | project #2860, task #3522 |
| 7 | GAP | S1: manager approve / rework / share | History rows `manager_approved`, `manager_change_requested`, `shared_for_client_review` have **no status / review stage before → after** | Store before → after like the other rows | task #3521 history |

Everything else passed (156 checks): access for other verticals' managers / artists, accept, submit,
dates (start = accept day, end = submit day, deadlines), 0-page and impossible-date errors, cancel
project (preview, reason, started / not started / submitted rules, read-only, approval after
cancel), delete task / project, defer.

Note: the first report files (`run-2026-11-06T04-25-03`, `04-25-28`) had false failures caused by
the test itself (it read cached data); ignore them, use the latest report.

---

## Open

### 1. [BUG] Changes raised from the PMT review ("give changes") get version V1 instead of V2, V3 …
- Where: `controller/workRequestController/workRequestController.js` → `pmRejectTask` → `createChangeRequestIssue`: `version: V${versionCount + 1}`, where `versionCount` counts the changes already on the task (task path) or the children of the parent change (change path).
- Reproduce: S1. PMT gives changes on a task → the change is saved as **V1** (should be V2: the task itself is V1). PMT gives changes on that change → again **V1** (should be V3).
- Effect: the version shown in the apps, the admin grids and the reports is wrong for every change made from the PMT review screen; V2/V3 cannot be told apart.
- Fix idea: version = 1 + number of changes of the task (all live changes with that `task_id`) + 1, i.e. first change V2; the same for a change on a change. Optional data fix for existing rows (renumber per task by `id`).

### 2. [BUG] Changes on a change: the older version stays `in_progress` for ever, so the project never completes
- Where: `pmRejectTask` (change path) sets the change being reviewed (V2) to `status: 'in_progress', review_stage: 'change_requested'`; `handleIssuePmApproval` later sets every change of the task to `review: approved / final_approved` but never sets V2 back to `completed`.
- Reproduce: S1. PMT gives changes on V2 → V3 → V3 done and approved → V2 ends as **status in_progress + final_approved**; project stays **accepted** (not completed); no `auto_completed` history.
- Effect: projects with 2+ rounds of changes never close; V2 shows as open work (overdue lists, workload, reports).
- Fix idea: like the session-10 fix for tasks: when the PMT approves a change, set its parent changes (and the task) to `completed` (not only the review fields); and/or do not reopen V2 at all when V3 is requested (keep it completed, mark review `change_requested`). Data fix: set such changes (`status in_progress` + `final_approved`) to `completed`.

### 3. [BUG] Cancelling a change leaves the task `in_progress` → the PMT can never approve it (dead end)
- Where: `controller/managerAssignedController/managerAssignedController.js` → `cancelIssueRequest`: resets the task's / parent change's review to `pm_review` but not the status. When the PMT gave changes, `pmRejectTask` had set the task to `in_progress`.
- Reproduce: S4. Task approved + shared → PMT gives changes (V2) → manager cancels V2 → task is `in_progress` + `pm_review` → PMT approve returns **400 "Only a completed task can be approved (current status: in_progress)"**.
- Effect: the task and the project are stuck; nobody can finish them from the apps.
- Fix idea: when the cancelled change was the open round, put the task (and parent change) back to `completed` with its old end date, review `pending`, stage `pm_review`.

### 4. [BUG] Manager sends a task back for rework, but its end date stays
- Where: `reviewTask` (`action: change_request`) sets the task to `in_progress` but keeps `end_date` from the first submit.
- Reproduce: S1. Artist submits (end date today) → manager "change request" → task is `in_progress` **with an end date**.
- Effect: breaks the rule "an open item has no end date" (data-quality report: open items with end date / end before start); TAT and FY by end date are wrong until the resubmit.
- Fix idea: clear `end_date` when the task (or change) goes back to the artist; the resubmit sets it again.

### 5. [BUG] PMT approval of a change is written twice in the change's history
- Where: `handleIssuePmApproval`: the loop over all changes of the task writes `pm_approved` for each (including the approved one), then a second `pm_approved` row is written for the approved change.
- Reproduce: S1 → history of V3 has two identical `pm_approved` rows (same second).
- Effect: history / reports count the approval twice; the other changes of the task get a `pm_approved` row although nobody approved them.
- Fix idea: in the loop skip the approved change, and use another action (e.g. `closed_by_later_version`) for the older versions.

### 6. [GAP] Delegated task: the creating manager can still edit and re-assign it
- Owner's rule (2026-11-06): Manager A gives a task to Manager B, B assigns it to his artist → both see it, but **B is the main manager and handles it; A can only view**.
- Today: `isTaskManager` lets every task manager act (request manager, delegated manager, artist's manager). In S2, CM A could rename the task (200) and **take it back and give it to his own artist** (200), which removed artist B.
- Fix idea: once a task is delegated to another manager, only that manager (and Super Admin) may update / assign / review / share it; the request's manager gets read access. Needs the "current handler" of a task (the last `assigned` / `created` history to a manager, or a new `tasks.handled_by` column).

### 7. [GAP] Manager approve / rework / share history rows have no before → after
- `manager_approved`, `manager_change_requested` and `shared_for_client_review` rows store the action, the actor and the time, but not the status / review stage before and after (the other rows do). The admin can see *that* it happened and *when*, not what changed.
- Fix idea: pass `previousStatus/newStatus/previousReviewStage/newReviewStage` in those `recordTaskHistory` / `recordIssueHistory` calls.

## Info (no change needed)
- Defer with "insufficient details" keeps the project **pending** (the deferral and the message are stored, the PMT is emailed); status `deferred` is commented out in `deferWorkRequest`. The runner checks this as INFO.
- Admin panel data (grids, linked work) is cached up to 60 s; actions done in the user apps show there within a minute.
- `.env.e2e.local` has `E2E_ARTIST_A_ID` / `E2E_ARTIST_A_NAME` twice; the last value wins (Harsh Gohil). Remove the unused line to avoid confusion.
- Test projects are named `E2E UAT … - please ignore`; each full run creates 7 projects on UAT and sends the normal emails to the team accounts (and to the managers of the request's division).

## Fixed
(none yet)
