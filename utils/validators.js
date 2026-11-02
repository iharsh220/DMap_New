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

// Makes a user-supplied name safe to use as one folder name: no path separators,
// no leading dots (blocks '..'), no control characters. Normal names are unchanged.
const safePathSegment = (name, fallback = 'unnamed') => {
    const cleaned = String(name ?? '')
        .replace(/[\/\\\0-\x1f]/g, '_')
        .replace(/^\.+/, '_')
        .trim();
    return cleaned || fallback;
};

module.exports = {
    parseId,
    parseIdArray,
    parseDateOnly,
    todayDateOnly,
    safePathSegment
};
