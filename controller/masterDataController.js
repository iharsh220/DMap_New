// Admin panel "Master data" page API (see services/masterDataService.js for the rules).
// Super Admin: every row. Managers (roles 2, 3): rows of their own department only.
const md = require('../services/masterDataService');

const fail = (res, err) => {
    if (err && err.status) return res.status(err.status).json({ success: false, error: err.message });
    console.error('Master data error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again later.' });
};
const idParam = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw md.httpError(400, 'Invalid id');
    return id;
};
const entityParam = (req) => {
    if (!Object.prototype.hasOwnProperty.call(md.REGISTRY, req.params.entity)) throw md.httpError(404, 'Unknown table');
    return req.params.entity;
};

const getMeta = async (req, res) => {
    try {
        const scope = await md.resolveScope(req.user);
        res.json({ success: true, data: await md.meta(scope) });
    } catch (err) { fail(res, err); }
};

const getList = async (req, res) => {
    try {
        const entity = entityParam(req);
        const scope = await md.resolveScope(req.user);
        const data = await md.list(entity, scope, { lite: req.query.lite === '1' || req.query.lite === 'true', all: req.query.all });
        res.json({ success: true, data });
    } catch (err) { fail(res, err); }
};

const getDetail = async (req, res) => {
    try {
        const entity = entityParam(req);
        const id = idParam(req);
        const scope = await md.resolveScope(req.user);
        res.json({ success: true, data: await md.detail(entity, id, scope) });
    } catch (err) { fail(res, err); }
};

const createRow = async (req, res) => {
    try {
        const entity = entityParam(req);
        const scope = await md.resolveScope(req.user);
        const id = await md.create(entity, req.body || {}, scope);
        console.log(`[master-data] user ${scope.userId} created ${entity} #${id}`);
        res.status(201).json({ success: true, data: await md.detail(entity, id, scope), message: `${md.REGISTRY[entity].singular} created` });
    } catch (err) { fail(res, err); }
};

const updateRow = async (req, res) => {
    try {
        const entity = entityParam(req);
        const id = idParam(req);
        const scope = await md.resolveScope(req.user);
        await md.update(entity, id, req.body || {}, scope);
        console.log(`[master-data] user ${scope.userId} updated ${entity} #${id}`);
        res.json({ success: true, data: await md.detail(entity, id, scope), message: `${md.REGISTRY[entity].singular} updated` });
    } catch (err) { fail(res, err); }
};

const deleteRow = async (req, res) => {
    try {
        const entity = entityParam(req);
        const id = idParam(req);
        const scope = await md.resolveScope(req.user);
        const out = await md.remove(entity, id, scope);
        console.log(`[master-data] user ${scope.userId} deleted ${entity} #${id} (${out.label})`);
        res.json({ success: true, data: out, message: `${md.REGISTRY[entity].singular} deleted` });
    } catch (err) { fail(res, err); }
};

module.exports = { getMeta, getList, getDetail, createRow, updateRow, deleteRow };

// ------------------------------------------------------------------ change requests
// Managers raise requests (master data is view-only for them); Super Admin handles them.
const requests = require('../services/masterDataRequestService');
const baseUrlOf = req => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    return `${proto}://${req.get('host')}${String(process.env.BASE_ROUTE || '').replace(/\/$/, '')}`;
};
const reqId = req => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw md.httpError(400, 'Invalid id');
    return id;
};
const listRequests = async (req, res) => {
    try { res.json({ success: true, data: await requests.list(req.user, { status: req.query.status }) }); } catch (err) { fail(res, err); }
};
const getRequest = async (req, res) => {
    try { res.json({ success: true, data: await requests.get(req.user, reqId(req)) }); } catch (err) { fail(res, err); }
};
const createRequest = async (req, res) => {
    try {
        const data = await requests.create(req.user, req.body || {}, { baseUrl: baseUrlOf(req) });
        res.status(201).json({ success: true, data, message: 'Request sent to the Super Admin' });
    } catch (err) { fail(res, err); }
};
const updateRequest = async (req, res) => {
    try { res.json({ success: true, data: await requests.update(req.user, reqId(req), req.body || {}), message: 'Request updated' }); } catch (err) { fail(res, err); }
};
const requestAlerts = async (req, res) => {
    try { res.json({ success: true, data: await requests.alerts(req.user) }); } catch (err) { fail(res, err); }
};
const requestAlertsSeen = async (req, res) => {
    try { res.json({ success: true, data: { saved: await requests.markSeen(req.user, (req.body || {}).last_id) } }); } catch (err) { fail(res, err); }
};

module.exports = Object.assign(module.exports, { listRequests, getRequest, createRequest, updateRequest, requestAlerts, requestAlertsSeen });
