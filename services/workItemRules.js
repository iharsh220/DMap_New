// Data rules for a task or a change request (owner, 2026-11-05), shared by every place that writes
// status / dates / pages directly (admin panel edit). The normal workflow (accept, submit, approve,
// complete all) enforces the same rules in its own handlers.
//   - dates must be real calendar dates (YYYY-MM-DD);
//   - end date never before start date;
//   - a completed item has a start date, an end date and at least 1 page;
//   - an open item (not completed / cancelled / rejected) has no end date yet.
const { parseDateOnly, parsePageCount } = require('../utils/validators');

const STATUSES = {
    task: ['draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred', 'cancelled'],
    change: ['m_pending', 'u_pending', 'm_accepted', 'u_accepted', 'in_progress', 'completed', 'rejected', 'on_hold', 'cancelled']
};
const FINISHED = ['completed', 'cancelled', 'rejected'];

const dateOrNull = (value, label) => {
    if (value === undefined || value === null || String(value).trim() === '') return { value: null };
    const parsed = parseDateOnly(String(value).trim().slice(0, 10));
    return parsed ? { value: parsed } : { error: `${label} is not a valid date (use YYYY-MM-DD)` };
};

// Returns { error } or { values } with normalized start_date / end_date / deadline / task_count.
const checkWorkItem = (kind, item) => {
    const label = kind === 'change' ? 'change' : 'task';
    const status = item.status === undefined || item.status === null ? '' : String(item.status);
    if (!STATUSES[kind].includes(status)) return { error: `Status must be one of: ${STATUSES[kind].join(', ')}` };
    const start = dateOrNull(item.start_date, 'Start date');
    const end = dateOrNull(item.end_date, 'End date');
    const deadline = dateOrNull(item.deadline, 'Deadline');
    for (const d of [start, end, deadline]) if (d.error) return { error: d.error };

    const rawPages = item.task_count === undefined || item.task_count === null || String(item.task_count).trim() === '' ? '0' : String(item.task_count).trim();
    if (!/^\d+$/.test(rawPages)) return { error: 'Number of pages must be a whole number' };
    const pages = Number(rawPages);

    if (start.value && end.value && end.value < start.value) return { error: 'End date cannot be before start date' };
    if (status === 'completed') {
        if (!start.value) return { error: `A completed ${label} needs a start date` };
        if (!end.value) return { error: `A completed ${label} needs an end date` };
        if (!parsePageCount(pages)) return { error: `A completed ${label} needs at least 1 page` };
    } else if (!FINISHED.includes(status) && end.value) {
        return { error: `Only a completed, cancelled or rejected ${label} can have an end date` };
    }
    return { values: { start_date: start.value, end_date: end.value, deadline: deadline.value, task_count: pages } };
};

module.exports = { checkWorkItem, STATUSES };
