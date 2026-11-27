# D-Map live production test: FRONTEND errors

Website: https://dmap.alembicdigilabs.com/ (user app) and the admin panel. Found on 2026-11-27 (steps in [TEST.md](TEST.md)).
Only the symptom and the screen/step where it shows up. The frontend code is not in this repo.

| ID | Screen / role | Sev | What happens | Expected | Step |
|---|---|---|---|---|---|
| F-01 | PMT → New Work Request → Confirm (request fails) | Low | When `POST /work-requests` fails (network error), the confirm dialog stays open and no error message is shown | Show "Could not submit, try again" | 1.3 |
| F-02 | CM → project detail `/dashboard/projectstatus/:id` | Low | The same `GET /manager/assigned-work-requests/:id` is called 3 times on one page load | One call | 1.7 |
| F-03 | API errors are not shown (task submit, change submit, Mark as Complete; same pattern in Defer F-13) | High | When the API refuses (400), nothing appears on screen: task submit with 0 pages ("task_count … at least 1"), change submit with 0 pages (only `console.error "Error submitting issue: [object Object]"`), Mark as Complete ("Add the number of pages before completing …"). The user clicks and nothing happens | Validate in the form (pages ≥ 1) and always show `error` from the API response as a toast | 1.16, 1.33, 4b.5 |
| F-04 | CM → task detail after Approve | Low | "Request Change" and "Approve" are still shown after the manager has approved (stage `pm_review`) | Hide them, or show "Waiting for client" | 1.21 |
| F-05 | CM → Requests → CHANGE → change detail | Medium | The PMT's attachment for the change is not shown anywhere on the manager's screen; the API sends it in `pmt_documents` | Show `pmt_documents` as "Client reference" | 1.26 |
| F-06 | Artist → change detail (Requests and My Tasks) | Medium | The PMT's reference file is listed twice under Resources, and also under OUTPUT FILES before the artist submitted anything | Show it once, as a reference only | 1.29, 1.32 |
| F-07 | Artist → change detail | Medium | The artist gets a "Cancel Change" button; the API it calls (`PUT /manager/assigned-work-requests/issue/:id/cancel`) is manager-only and always returns 403 | Hide the button for roles 4 / requesters | 1.29 |
| F-08 | `/dashboard/issuedetails/:id` opened from a link or after a reload | High | Empty page ("Invalid Date", "Issue Acceptance Pending", no artist, no files); the page reads data only from the previous screen and makes no API call | Load the change by id from the API when the page opens | 1.31 |
| F-09 | Artist → change detail | Low | PROJECT NAME is empty | Show the project name | 1.32 |
| F-10 | CM → Share with client dialog | Medium | All files are ticked by default, including the PMT's own reference file, so the client gets their own file back as the output | Pre-tick only the artist's outputs (or none) and keep client references out of the list | 1.36 |
| F-11 | CM → New Task → Request Sister Vertical | Low | The list also offers the manager's own vertical and themselves (Web & Digital Solutions → Kiran for Kiran) | Hide the caller's own vertical | 2.2 |
| F-12 | CM → New Task → Request Sister Vertical | Medium | No deadline is asked, so the delegated task is saved with `deadline = NULL` until the other manager assigns it | Ask for the deadline (like normal task creation) | 2.3 |
| F-13 | CM → Defer Project → Insufficient details | Medium | The message box can be left empty; the API returns 400 "message is required…" and the screen shows nothing | Make the message required in the form and show API errors | 3.1 |
| F-14 | PMT → Edit Project of a deferred request | Low | The edit form does not show the manager's message (what to fix); it is only on the detail page | Show the defer reason/message on top of the edit form | 3.3 |
| F-15 | CM → project ⋮ → Mark as Cancel | Low | The dialog shows only a reason box; the app never calls `GET …/:id/cancel-preview`, so the manager does not see what will be cancelled / left for approval / who is notified | Show the preview in the dialog | 4.7 |
| F-16 | PMT → Profile → Completed Projects | Medium | Every project shows the date "16th Dec '25" (also projects created today); cancelled projects are listed as completed without a "Cancelled" label | Real completion/cancel date and a status label | 5.3 |
| F-17 | PMT → Guidebook | Low | Empty page (only the heading) | Content or hide the link | 5.4 |
| F-18 | CM → `/dashboard/cm/memberdetails` | Low | Placeholder page with fixed data ("Jayesh", every number 2003) reachable by URL | Remove the route or load real data | 5.7 |
| F-19 | Any detail page (`taskdetails`, `issuedetails`, `cm/ProjectAssign`) when the API returns 404/400 or the id is missing | Medium | Broken page with "sd", "Invalid Date", "Task Acceptance Pending"; `cm/ProjectAssign` even calls `/manager/assigned-work-requests/undefined` | Show "Not found or no access" and a back button | 5.6, 5.10 |
