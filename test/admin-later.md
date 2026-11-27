# Admin panel findings (parked: admin testing is for later, owner 27 Nov)

Found before the owner asked to leave the admin panel for later. Not re-checked; use as a starting point. Steps are in TEST.md section 6 and step 1.43.

| ID | Area | Side | Sev | What happens | Where |
|---|---|---|---|---|---|
| B-10 | Admin Projects grid `project_completion_timestamp` | BE | Low | "N/A" for a project closed by `auto_completed` (#3015) | `adminController.getAdminData` looks only for action `completed` |
| B-17 | Admin grids data scope (`projectsdetails`, `taskdetails`, `issuedetails`, `clients` data, `linked/:kind/:id`) | BE | High | Any logged-in user (artist, PMT / requester) gets every project, task, change and client request of all divisions (2,677 / 2,776 / 1,788 / 2,715 rows), incl. requester names, emails, phones; the user app limits an artist to their own work | `routes/adminRoutes.js` data routes have only the token guard (open decision since session 6) |
| F-20 | Raw data / Feedback / Leaves / Rate card / Master data opened by a non-admin | FE | Low | The redirect to Overview happens by throwing an uncaught JS error "Admins only" | `public/admin-app.js` page guard |
| — | What's new | — | Note | Opening the admin What's new page as Kiran marked release 1.11.3 as seen for her | test side effect |
