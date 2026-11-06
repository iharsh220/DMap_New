# UAT end-to-end tests

Automatic tests of the whole D-Map workflow against the **live UAT backend** (HTTP only, no database
access), plus a manual checklist for the frontend.

| File | What it is |
|---|---|
| `run.js` | the runner |
| `lib.js` | login, API calls, checks, report writer (refuses any URL that is not UAT) |
| `flow.js` | workflow steps and read-back helpers (state, history, timeline) |
| `scenarios/` | S1 full flow, S2 delegation, S3–S6 cancel / delete / defer |
| `TEST_CASES.md` | the same scenarios as a manual checklist for https://dmap.alembicdigilabs.com/ |
| `ISSUES.md` | problems found (curated list on top; every run appends its failures at the bottom) |
| `results/` | one `.md` + `.json` report per run, with the full history timeline of every test project |

## Setup
Accounts and the backend URL are read from `.env.e2e.local` in the repo root (git-ignored, never
commit it): `E2E_API_TARGET` (must contain `/uat/`), `E2E_PMT_*`, `E2E_CM_A_*`, `E2E_ARTIST_A_*`,
`E2E_CM_B_*`, `E2E_ARTIST_B_*`, `E2E_CM_C_*`, `E2E_ARTIST_C_*`. Node 18+ (built-in `fetch`).

## Run
```bash
node tests/uat/run.js            # everything (~15 s, creates 7 test projects on UAT)
node tests/uat/run.js s1         # one scenario
node tests/uat/run.js s2 s4      # several
```
Output: `PASS` / `FAIL` (bug) / `GAP` (works, but not the owner's rule) per check, then the report
path. Exit code 1 when a check failed.

| Id | Scenario | Accounts |
|---|---|---|
| s1 | PMT request → CM accepts → task to artist → accept → submit → CM rework → resubmit → CM approves → share → PMT gives changes (V2) → CM accepts V2, assigns → artist submits → CM approves, shares → PMT gives changes again (V3) → same → PMT approves → task + project complete. Dates and history of every step. | PMT, CM A, artist A |
| s2 | Manager → Manager → User: CM A gives a task to CM B, CM B assigns it to artist B; who sees it; who may act; artist B submits; CM B approves; PMT approves | PMT, CM A, CM B, artist B |
| s3 | Cancel a project with a started, a not-started and a submitted task: preview, access, reason, result, read-only, approval of submitted work | PMT, CM A, artist A |
| s4 | PMT gives changes, the manager cancels the change, the task goes back to the PMT | PMT, CM A, artist A |
| s5 | Delete a task, then the whole project; nobody sees them any more | PMT, CM A, artist A |
| s6 | Defer a project (insufficient details) | PMT, CM A |

Every scenario also checks that people outside the project (CM C, artist C, artist B) cannot see
or act, and the report has a **Timeline** per project: every history row (project, task, change)
with time, action, status before → after, review stage before → after, and who did it.

## Notes
- Test projects are named `E2E UAT … - please ignore` (PMT = the account in `.env.e2e.local`). The
  normal emails are sent (to the test accounts and the managers of the request's division).
- The runner never deletes what it creates except in S5; delete old test projects from the admin
  panel (Projects → search "E2E UAT") when they get in the way.
- When a scenario stops early ("Stopped: …"), the step before it failed; see the report and
  `ISSUES.md`.
