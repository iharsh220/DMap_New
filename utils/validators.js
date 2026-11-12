// Shared request-input validators. Each returns null when the input is invalid.

// Positive integer id from a number or numeric string.
const parseId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const str = String(value).trim();
    if (!/^\d+$/.test(str)) return null;
    const id = Number(str);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// Array of positive integer ids, de-duplicated. Empty or invalid arrays return null.
const parseIdArray = (values) => {
    if (!Array.isArray(values) || values.length === 0) return null;
    const ids = values.map(parseId);
    if (ids.some(id => id === null)) return null;
    return [...new Set(ids)];
};

// Optional list of ids as sent by JSON or multipart clients: an array, a JSON array string
// ("[1,2]"), a comma-separated string ("1,2") or a single id. Missing / empty input gives [],
// anything else that is not a list of positive integers gives null.
const parseIdList = (value) => {
    if (value === undefined || value === null || value === '') return [];
    let list = value;
    if (typeof value === 'string') {
        const str = value.trim();
        if (str === '' || str === '[]') return [];
        if (str.startsWith('[')) {
            try { list = JSON.parse(str); } catch (e) { return null; }
        } else {
            list = str.split(',');
        }
    } else if (!Array.isArray(value)) {
        list = [value];
    }
    if (!Array.isArray(list)) return null;
    if (list.length === 0) return [];
    return parseIdArray(list);
};

// Calendar date as 'YYYY-MM-DD'. Rejects impossible dates such as 2026-02-31,
// which `new Date()` silently rolls over into the next month.
const parseDateOnly = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Today's date in server local time as 'YYYY-MM-DD' (DB timezone is +05:30).
const todayDateOnly = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// True when a request field was actually sent (not undefined / null / empty text).
const isProvided = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// Optional start / end dates sent with a task or change: each must be a real YYYY-MM-DD date and
// the end can never be before the start. Returns { start, end } (null when not sent) or { error }.
const parseDateRange = (start, end) => {
    const startDate = isProvided(start) ? parseDateOnly(start) : null;
    if (isProvided(start) && !startDate) return { error: 'Invalid start_date. Use YYYY-MM-DD format.' };
    const endDate = isProvided(end) ? parseDateOnly(end) : null;
    if (isProvided(end) && !endDate) return { error: 'Invalid end_date. Use YYYY-MM-DD format.' };
    if (startDate && endDate && endDate < startDate) return { error: 'End date cannot be before start date' };
    return { start: startDate, end: endDate };
};

// End date picked by the user on submit (end_date, YYYY-MM-DD), otherwise today.
// It can never be in the future. Returns { end } or { error }.
const parseSubmitEndDate = (value) => {
    const today = todayDateOnly();
    if (!isProvided(value)) return { end: today };
    const end = parseDateOnly(value);
    if (!end) return { error: 'Invalid end_date. Use YYYY-MM-DD format.' };
    if (end > today) return { error: 'End date cannot be in the future' };
    return { end };
};

// Makes a user-supplied name safe to use as one folder name: no path separators,
// no leading dots (blocks '..'), no control characters. Normal names are unchanged.
const safePathSegment = (name, fallback = 'unnamed') => {
    const cleaned = String(name ?? '')
        .replace(/[\/\\\0-\x1f]/g, '_')
        .replace(/^\.+/, '_')
        .trim();
    return cleaned || fallback;
};

// Number of work pages (tasks.task_count / issue_assignments.task_count). A completed task or change
// must have at least 1 page (owner's rule, 2026-11-05). Accepts 3 or "3"; rejects 0, negatives,
// decimals ("2.5"), text and absurd values. Returns the integer or null.
const MAX_PAGES = 100000;
const parsePageCount = (value) => {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= 1 && n <= MAX_PAGES ? n : null;
};

module.exports = {
    parseId,
    parseIdArray,
    parseIdList,
    parseDateOnly,
    todayDateOnly,
    isProvided,
    parseDateRange,
    parseSubmitEndDate,
    safePathSegment,
    parsePageCount
};
