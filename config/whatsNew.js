// "What's new" changelog, shown in the admin panel (popup once per user per release, and the
// What's new page) and served by GET /datatable/admin/whats-new/data.
//
// HOW TO RELEASE: add a new object at the TOP of VERSIONS with a higher `version`
// (major.minor.patch), the release `date` (YYYY-MM-DD), a short `title` and the `changes`.
// Every logged-in user gets the popup once after the deploy.
//
// change.type:
//   'new'      new feature            (everyone)
//   'improved' better existing feature (everyone)
//   'fixed'    bug fix                (everyone)
//   'api'      API / integration note (Super Admin and managers only, roles 1, 2, 3)
// change.area: where it shows up (Admin panel, Tasks, Changes, Projects, Emails, ...).
// Write the 'new' / 'improved' / 'fixed' texts for end users (no code names); put endpoints,
// parameters and response fields in 'api' items.

const VERSIONS = [
    {
        version: '1.11.0',
        date: '2026-11-12',
        title: 'Start and end dates always in the right order',
        changes: [
            { type: 'improved', area: 'Tasks', text: 'When you submit a task or change you can pick its end date. It can be today or earlier, never in the future and never before the start date.' },
            { type: 'fixed', area: 'Changes', text: 'Accepting a change with a wrong start date (for example 31 February) is now refused, like on tasks. A cancelled or rejected change can no longer be accepted.' },
            { type: 'fixed', area: 'Tasks', text: 'Accepting a task or change clears an old end date, so an open item never shows an end date before its start date.' },
            { type: 'fixed', area: 'Changes', text: 'A new change request with an end date before its start date is refused.' },
            { type: 'api', area: 'API', text: 'POST /users/tasks/submit and PUT /users/issues/:id/submit accept an optional end_date (YYYY-MM-DD; default today; 400 when invalid, in the future or before the start date). PUT /users/issues/:id/accept validates start_date strictly (400 for invalid dates) and returns data.start_date as YYYY-MM-DD (was a full timestamp); 400 for cancelled / rejected changes. POST /issue-register/assignment and /work-requests/pm-reject return 400 when start_date / end_date are invalid or end is before start.' }
        ]
    },
    {
        version: '1.10.0',
        date: '2026-11-06',
        title: 'Change requests and delegated tasks fixed',
        changes: [
            { type: 'fixed', area: 'Changes', text: 'A change requested from the PMT review gets the right version: the task is V1, the first change V2, the next V3.' },
            { type: 'fixed', area: 'Projects', text: 'After two or more rounds of changes the project now completes automatically when the last change is approved (the older version no longer stays "in progress").' },
            { type: 'fixed', area: 'Changes', text: 'When a manager cancels a change, the task goes back to the requester as completed and can be approved again (before, the approval was refused).' },
            { type: 'fixed', area: 'Tasks', text: 'When a manager sends a task or change back for rework, its end date is cleared until the artist submits again.' },
            { type: 'improved', area: 'Tasks', text: 'A task given to a manager of another vertical is handled only by that manager: the project manager can still see it but can no longer edit, re-assign or review it.' },
            { type: 'improved', area: 'History', text: 'Manager approve, rework and share steps show the status and review stage in the history; a change approval is recorded once.' },
            { type: 'api', area: 'API', text: 'POST /work-requests/pm-reject accepts an optional version (V2, V3 ...). Manager actions on a delegated task (update, assign-task, review, share, delete, change accept / assign / cancel) return 403/404 for managers other than the delegated one (and Super Admin). New history action approved_with_later_version.' }
        ]
    },
    {
        version: '1.9.0',
        date: '2026-11-06',
        title: 'Project cancellation with clear rules',
        changes: [
            { type: 'new', area: 'Projects', text: 'Cancel project: before confirming you see how many tasks and changes are started, not started, waiting for approval and completed, the list of affected items and who is notified. A reason is required.' },
            { type: 'improved', area: 'Projects', text: 'On cancellation, started work gets the cancellation date as its end date, work that has not started is cancelled without dates, and completed or submitted work keeps its status and dates.' },
            { type: 'improved', area: 'Projects', text: 'Submitted work that is still waiting for review or approval can still be reviewed and approved after the project is cancelled.' },
            { type: 'new', area: 'Emails', text: 'The requester, the project managers and every assigned creative user get an email with the cancellation date, the reason and what happened to each task and change.' },
            { type: 'improved', area: 'Projects', text: 'A cancelled project is read-only: no new tasks, changes, assignments, acceptances, submissions or edits. Its documents and history are kept.' },
            { type: 'improved', area: 'Admin panel', text: 'Cancel project action on Projects and Client requests (Super Admin and the project\'s managers). The history records who cancelled, when, why and every task or change that changed.' },
            { type: 'api', area: 'Manager API', text: 'New GET /manager/assigned-work-requests/:id/cancel-preview returns { project, can_cancel, blockers, cancel_date, summary: { tasks, changes: { in_progress, not_started, pending_approval, completed, closed } }, items[], notify[] }. PUT /:id/cancel now requires body { reason } (5-1000 characters; 400 without it), is allowed for the request\'s managers and Super Admin (404 for others) and adds data (summary, items, email_status) to the old response.' },
            { type: 'api', area: 'API', text: 'Writes on a cancelled project return 400 "This project is cancelled and read-only": task create / update / delete / assign / accept / submit, change create / accept / assign / submit / cancel, manager change_request reviews, PM reject, complete all, project edit / accept / defer, admin edits. Approvals (review approved, share for client review, PM approve) still work.' }
        ]
    },
    {
        version: '1.8.0',
        date: '2026-11-06',
        title: 'See how projects, tasks and changes connect',
        changes: [
            { type: 'new', area: 'Projects', text: 'Opening a project shows a Linked work tree: the project with all its tasks and the number of changes on each. Click a task to see its details and its changes, right in the same panel.' },
            { type: 'new', area: 'Tasks', text: 'Opening a task shows its project and the other tasks of that project; the task is marked and opened with all its change versions (V2, V3 …).' },
            { type: 'new', area: 'Changes', text: 'Opening a change shows the path Project › Task › Change on top, the task it came from with all its versions, and the change marked.' },
            { type: 'improved', area: 'Admin panel', text: 'The Linked work tree scrolls on its own, has Expand all / Collapse all, and the path buttons jump to the project, task or change.' },
            { type: 'api', area: 'Admin API', text: 'New GET /datatable/admin/linked/:kind/:id (kind = project | task | change) returns { focus, project, tasks[ { …, changes[] } ], totals } for the project of that record; deleted tasks and changes are left out. 400 for a bad kind or id, 404 when not found.' }
        ]
    },
    {
        version: '1.7.0',
        date: '2026-11-05',
        title: 'Complete data for every task and change',
        changes: [
            { type: 'improved', area: 'Tasks & Changes', text: 'Submitting a task or a change needs the number of pages (a whole number, at least 1).' },
            { type: 'improved', area: 'Tasks & Changes', text: 'Financial Year is now the financial year of the end date (April to March), on the column, the quick filter and the export. Work that is not finished yet shows 00.' },
            { type: 'improved', area: 'Projects', text: 'Financial Year of a project is the financial year of its last end date (of its tasks and their changes). It shows 00 while the project has no task or any task or change is not finished yet.' },
            { type: 'fixed', area: 'Projects', text: 'Change Count on Projects is the number of change requests raised on the project\'s tasks (before it counted only one kind of history entry and was almost always 0).' },
            { type: 'api', area: 'Admin API', text: 'Tasks / Changes data: `fy` (column and col_exact filter) is computed from tasks.end_date / issue_assignments.end_date instead of the deadline; filter-options `deadline_financial_years` (key name unchanged) now lists the FYs of end dates.' },
            { type: 'fixed', area: 'Changes', text: 'A change accepted for a later start date and finished earlier now starts on the day it is submitted, so its end date is never before its start date.' },
            { type: 'fixed', area: 'Projects', text: '"Complete all" no longer closes cancelled or deleted work, asks for the pages of any task or change that has none, and gives every completed item a start and end date.' },
            { type: 'fixed', area: 'Tasks', text: 'A completed task can no longer be reassigned to someone else (this left old end dates behind). Only completed work can be approved.' },
            { type: 'improved', area: 'Admin panel', text: 'Editing a task, change or project in the admin panel checks the data (real dates, end date not before start date, completed work has dates and pages, a project is completed only when all its work is) and keeps a history of every edit. Fields you do not change are kept as they are.' },
            { type: 'api', area: 'Tasks API', text: 'POST /users/tasks/submit: task_count must be an integer >= 1 (400 otherwise). PUT /users/issues/:issueId/submit: task_count (or the change\'s existing count) must be >= 1; optional start_date (YYYY-MM-DD, not after today); a future start_date on the change is moved to today.' },
            { type: 'api', area: 'Workflow API', text: 'PUT /manager/assigned-work-requests/complete: skips deleted/cancelled/rejected items, 400 listing items without pages, sets valid start/end dates, one transaction (response unchanged). PUT /manager/assigned-work-requests/tasks/:taskId: 400 when reassigning a completed/cancelled/rejected task. POST /work-requests/pm-approve: 400 unless the task / change is completed.' },
            { type: 'api', area: 'Admin API', text: 'PUT /datatable/admin/edit/task|issue/:id: 400 with the reason for invalid status, dates (YYYY-MM-DD, end >= start, completed needs start + end, open items no end) or pages (completed >= 1); 404 for an unknown id; missing fields keep their value; history action admin_updated. PUT /datatable/admin/edit/project/:id: status completed only with >= 1 live task and no open task/change (400); status changes write work_request_history admin_status_changed.' }
        ]
    },
    {
        version: '1.6.0',
        date: '2026-11-05',
        title: 'Master data requests',
        changes: [
            { type: 'new', area: 'Master data', text: 'Managers can raise a change request ("Request a change") for master data: pick the table and what you need, and write a title and details. The Super Admin gets an email (you are in CC) and a popup, and you can follow the status and full history under "My requests".' },
            { type: 'improved', area: 'Master data', text: 'Master data is view-only for managers and shows only the work setup of their department (divisions, request, project, task and change types). Designations and job roles are managed by the Super Admin only.' },
            { type: 'new', area: 'Admin panel', text: 'Super Admin: a popup when managers raise new master data requests, and the number of open requests next to "Master data" in the sidebar.' },
            { type: 'api', area: 'Master data API', text: 'Writes (POST/PUT/DELETE /datatable/admin/master/:entity) are Super Admin only; managers get 403. designation and job_role return 403 for managers, and meta lists only the tables the caller may see. lite lists are always scoped for managers (all=1 is ignored).' },
            { type: 'api', area: 'Requests API', text: 'New: GET /datatable/admin/master/requests (Super Admin all, managers their own; { rows, summary }), GET /datatable/admin/master/requests/:id (with history), POST /datatable/admin/master/requests { entity, action: add|change|remove|other, title, details } (details required; optional target_id must be in the caller\'s scope; the email CCs the requester) (roles 2, 3), PUT /datatable/admin/master/requests/:id { status: in_progress|done|rejected, remark } (Super Admin), GET /datatable/admin/master/requests/alerts and POST .../alerts/seen { last_id } (Super Admin popup).' }
        ]
    },
    {
        version: '1.5.0',
        date: '2026-11-05',
        title: 'Master data, view-only admin panel and What\'s new',
        changes: [
            { type: 'new', area: 'Admin panel', text: 'What\'s new: after every update you see what changed, once. You can read all versions any time under "What\'s new" in the sidebar.' },
            { type: 'new', area: 'Master data', text: 'New "Setup → Master data" page for Super Admin and managers: departments, divisions, designations, job roles, request types, project types, task types and change types, with everything they are linked to. Managers manage only their own department.' },
            { type: 'improved', area: 'Master data', text: 'Linked data stays complete: a request type always has a division, a project type a request type, a task type a project type, a change type a task type, and a designation a department with its job role. Rows that are still in use cannot be deleted (set them inactive instead).' },
            { type: 'improved', area: 'Admin panel', text: 'Only Super Admin and managers can edit or delete client requests, tasks and changes in the admin panel. Everyone else can view, filter and export.' },
            { type: 'fixed', area: 'Tasks', text: 'The manager of the person a task is assigned to can now edit that task (before, only the project\'s manager could, and others got "Task not found").' },
            { type: 'api', area: 'Admin API', text: 'PUT/DELETE /datatable/admin/edit/* and /datatable/admin/delete/* (and their GET helpers and delete preview) now return 403 for roles other than 1, 2, 3.' },
            { type: 'api', area: 'Master data API', text: 'New: GET /datatable/admin/master/meta, GET /datatable/admin/master/:entity (?lite=1, &all=1), GET|PUT|DELETE /datatable/admin/master/:entity/:id, POST /datatable/admin/master/:entity. Entities: department, division, designation, job_role, request_type, project_type, task_type, change_type. Roles 1, 2, 3; managers are limited to their department.' },
            { type: 'api', area: 'Tasks API', text: 'PUT /manager/assigned-work-requests/tasks/:taskId allows every task manager (request manager, delegated manager, the artist\'s manager); changing user_id follows the same own-team rule as task creation (403 otherwise).' },
            { type: 'api', area: 'What\'s new API', text: 'New: GET /datatable/admin/whats-new/data (versions filtered by role, `unseen`, `current`) and POST /datatable/admin/whats-new/seen { version } for any logged-in user, so the user apps can show the same notes.' }
        ]
    },
    {
        version: '1.4.0',
        date: '2026-11-04',
        title: 'Access by team, project list filters and clearer errors',
        changes: [
            { type: 'improved', area: 'Access', text: 'A task is visible only to its project manager(s), its task manager(s) and the artist working on it. A manager gives work to their own team, or delegates it to another Digilabs manager.' },
            { type: 'new', area: 'Projects', text: 'Project lists can be filtered by deadline range, artist and requester, and sorted by date, deadline, status, name or priority.' },
            { type: 'improved', area: 'Projects', text: 'Adding a change or a new task to a completed project re-opens it automatically.' },
            { type: 'improved', area: 'Overview', text: 'Team numbers count only work assigned to the team (not work of other verticals on projects the team manages). Links from the overview open the grids filtered to the same team or person.' },
            { type: 'improved', area: 'Overview', text: 'The People table lists every team member, including inactive users, marked "Inactive".' },
            { type: 'new', area: 'Overview', text: 'New "Overdue tasks" and "Due in 7 days" cards; clicking them opens the Tasks grid with exactly those tasks.' },
            { type: 'new', area: 'Sales activity', text: 'Single sign-on: HO and sales users can open their activities straight from the other app without logging in again.' },
            { type: 'new', area: 'Emails', text: 'Daily reminder to requesters with work waiting for their approval (production only, at most one per day).' },
            { type: 'improved', area: 'Tasks & Changes', text: 'Financial Year is the financial year of the deadline, with a quick filter; "This FY" selects the whole year (1 April to 31 March).' },
            { type: 'fixed', area: 'All', text: 'Errors no longer show technical database messages; you see "Something went wrong. Please try again later."' },
            { type: 'api', area: 'Projects API', text: 'GET /work-requests/my-requests and /work-requests/division/all: new deadline_from, deadline_to, artist_name, artist_id, requester_name, requester_id, sort_by (created_at|requested_at|deadline|status|project_name|priority|id) and order; limit=-1 works; pagination adds total and total_pages.' },
            { type: 'api', area: 'Access API', text: 'GET /users/tasks/:id gives the full view only to task managers; /users/my-team shows team tasks only to manager roles; POST /issue-register/assignment requires the requester or a colleague in the requester\'s division (403).' },
            { type: 'api', area: 'Errors', text: 'Every 5xx response is { success: false, error: "Something went wrong. Please try again later." } and is logged with endpoint, user id and params.' },
            { type: 'api', area: 'Admin API', text: 'Projects, Tasks and Changes data accept `scope` ({team:1} | {division_id} | {user_id}); the Tasks/Changes `fy` filter uses the deadline.' },
            { type: 'api', area: 'Sales activity API', text: 'New: GET /salesusers/sso_check?user_type=ho|sales (Bearer token of the other app) and GET /salesusers/open_activity. The activity list filters on activity.division_id.' }
        ]
    },
    {
        version: '1.3.0',
        date: '2026-11-03',
        title: 'Weekly report, costs and automatic project completion',
        changes: [
            { type: 'new', area: 'Weekly report', text: 'Weekly report in the admin panel for Digilabs managers: client work, initiatives, highlights and notes, and a PowerPoint download.' },
            { type: 'new', area: 'Tasks & Changes', text: 'Change cost and total cost columns; Excel export includes every column, also hidden ones, with numbers as numbers.' },
            { type: 'improved', area: 'Tasks & Changes', text: 'The cards show task pages and change pages (total and completed) for the filtered rows.' },
            { type: 'new', area: 'Tasks & Changes', text: 'Task Manager Vertical filter with the five Digilabs verticals.' },
            { type: 'improved', area: 'Projects', text: 'A project completes automatically once every task and change is approved.' },
            { type: 'fixed', area: 'Changes', text: 'Raising a change request with attachments no longer fails.' },
            { type: 'fixed', area: 'Tasks', text: 'Approving a change request no longer sends its task back to "accepted".' },
            { type: 'api', area: 'Changes API', text: 'POST /issue-register/assignment accepts issue_register_ids as an array, a JSON string, a comma-separated string, a single id or repeated multipart fields; invalid ids return 400 before anything is saved.' },
            { type: 'api', area: 'Approval API', text: 'Approval responses add work_request_completed (task) / data.workRequestCompleted (change).' }
        ]
    },
    {
        version: '1.2.0',
        date: '2026-11-02',
        title: 'New admin panel and team overview',
        changes: [
            { type: 'new', area: 'Admin panel', text: 'New admin panel design with the same columns as the old tables, filter chips, quick filters and light/dark theme.' },
            { type: 'new', area: 'Overview', text: 'Overview for every role: your own and your team\'s projects, tasks, changes and pages, with division and person filters and a People table.' },
            { type: 'improved', area: 'Admin panel', text: 'Feedback, Leaves, Rate card and Raw data are for Super Admin only. Grids open with 25 rows.' },
            { type: 'fixed', area: 'Projects', text: 'The request-to-response TAT column now shows values instead of N/A.' },
            { type: 'api', area: 'Admin API', text: '/datatable/admin/feedback|leaves|master-card|workrequesttasks APIs require role 1 (403 otherwise). GET /datatable/admin/overview/data is scoped by role and accepts division_id and user_id.' }
        ]
    },
    {
        version: '1.1.0',
        date: '2026-10-30',
        title: 'Security for the admin panel',
        changes: [
            { type: 'fixed', area: 'Admin panel', text: 'Text typed into project names, remarks and other fields is always shown as plain text, so it can never run as code in the admin panel.' }
        ]
    },
    {
        version: '1.0.0',
        date: '2026-10-29',
        title: 'Faster, safer D-Map',
        changes: [
            { type: 'improved', area: 'Admin panel', text: 'Admin pages load much faster (task and change details went from about 1 second to a few milliseconds).' },
            { type: 'improved', area: 'Admin panel', text: 'The cards count all filtered rows, not only the visible page, and Excel/CSV export includes every filtered row.' },
            { type: 'improved', area: 'Emails', text: 'Emails are lighter, look right in Outlook and are retried automatically when the mail server is busy.' },
            { type: 'improved', area: 'Access', text: 'Managers can act only on the requests assigned to them, and approvals only by the requester or their division colleagues.' },
            { type: 'fixed', area: 'Tasks', text: 'Tasks scheduled to start on a past date now move to "In progress" automatically.' },
            { type: 'new', area: 'Admin panel', text: 'Filter chips with "Clear all", clickable status cards, and filters kept in the page link so a filtered view can be shared.' },
            { type: 'fixed', area: 'Admin panel', text: 'Raw data search and the Clients TAT filter work again; every Raw data row can be reached by paging.' },
            { type: 'fixed', area: 'Changes', text: 'Change review emails reach the right person, and change lists show the request type, task type and project again.' },
            { type: 'improved', area: 'Tasks', text: 'Creating and assigning tasks checks dates, assignees and team rules, and saves everything together (no half-saved tasks).' },
            { type: 'api', area: 'Admin API', text: 'All /datatable/admin/* data APIs require an access token.' },
            { type: 'api', area: 'Lists API', text: 'GET /manager/assigned-work-requests/issue-assignments and GET /issue-register/assignments support page and limit (limit=-1 = all) and return a pagination object; unknown query parameters are ignored instead of failing.' },
            { type: 'api', area: 'Access API', text: 'History and feedback endpoints of tasks, changes and work requests return 403 to users who cannot see that work request; malformed JSON bodies return 400 instead of 500.' }
        ]
    },
    {
        version: '0.9.0',
        date: '2026-10-28',
        title: 'Admin panel: projects and leaves',
        changes: [
            { type: 'new', area: 'Projects', text: 'The admin Projects table shows the complete project data.' },
            { type: 'improved', area: 'Leaves', text: 'Leaves page updated, with improved date fields and selection.' }
        ]
    }
];

module.exports = { VERSIONS };
