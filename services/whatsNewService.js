// What's new: release notes from config/whatsNew.js, filtered by role, plus the last version
// each user has seen (Redis key whatsnew:seen:<userId>, no expiry). 'api' notes are only for
// Super Admin and managers (roles 1, 2, 3); everyone else gets the feature notes.
const { VERSIONS } = require('../config/whatsNew');
const redisClient = require('../config/redisConfig');

const API_ROLES = [1, 2, 3];
const TYPES = ['new', 'improved', 'fixed', 'api'];

const parse = v => String(v || '').split('.').map(n => parseInt(n, 10) || 0);
const compareVersions = (a, b) => {
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
};

// newest first, checked once at startup so a bad entry fails loudly in the log, not for users
const SORTED = VERSIONS.slice().sort((a, b) => compareVersions(b.version, a.version));
SORTED.forEach(v => {
    if (!/^\d+\.\d+\.\d+$/.test(v.version) || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Array.isArray(v.changes)) {
        console.error('[whats-new] invalid entry in config/whatsNew.js:', v.version);
    }
    (v.changes || []).forEach(c => { if (!TYPES.includes(c.type)) console.error(`[whats-new] ${v.version}: unknown change type "${c.type}"`); });
});
const CURRENT = SORTED.length ? SORTED[0].version : '0.0.0';

const roleOf = user => Number(user && user.jobRole && user.jobRole.id);
const canSeeApi = user => API_ROLES.includes(roleOf(user));

const forUser = user => {
    const api = canSeeApi(user);
    return SORTED
        .map(v => ({ version: v.version, date: v.date, title: v.title, changes: v.changes.filter(c => api || c.type !== 'api') }))
        .filter(v => v.changes.length);
};

const seenKey = userId => `whatsnew:seen:${Number(userId)}`;
const getSeen = async userId => {
    if (redisClient.status !== 'ready') return null;
    try { return await redisClient.get(seenKey(userId)); } catch (e) { return null; }
};
const setSeen = async (userId, version) => {
    if (redisClient.status !== 'ready') return false;
    try {
        const prev = await redisClient.get(seenKey(userId));
        if (!prev || compareVersions(version, prev) > 0) await redisClient.set(seenKey(userId), version);
        return true;
    } catch (e) { return false; }
};

// Versions to show in the popup: everything newer than the last seen one; a user who never saw
// any gets only the latest release (not the whole history).
const unseenFor = (versions, seen) => {
    if (!versions.length) return [];
    if (!seen) return [versions[0]];
    return versions.filter(v => compareVersions(v.version, seen) > 0);
};

module.exports = { CURRENT, compareVersions, canSeeApi, forUser, getSeen, setSeen, unseenFor };
