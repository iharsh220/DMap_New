// Master data change requests (owner, 2026-11-05): managers only view master data and ask the
// Super Admin for changes. A request is emailed to MASTER_DATA_REQUEST_EMAIL (default
// sandesh.pujari@alembic.co.in), shown to Super Admins as a popup in the admin panel, and every
// step is kept in master_data_request_history (migration create_master_data_requests.sql).
const { sequelize } = require('../config/databaseConfig');
const redisClient = require('../config/redisConfig');
const { sendMail } = require('./mailService');
const { renderTemplate } = require('./templateService');
const md = require('./masterDataService');

const SELECT = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT, transaction });
const RUN = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

const REQUEST_EMAIL = () => process.env.MASTER_DATA_REQUEST_EMAIL || 'sandesh.pujari@alembic.co.in';
const ACTIONS = { add: 'Add new', change: 'Change', remove: 'Remove', other: 'Other' };
const STATUSES = ['pending', 'in_progress', 'done', 'rejected'];
const OPEN = ['pending', 'in_progress'];
const REQUESTER_ROLES = [2, 3];
const DAILY_LIMIT = 30;

const httpError = md.httpError;
const isAdmin = user => Number(user && user.jobRole && user.jobRole.id) === 1;

const actorOf = async (userId, transaction) => {
    const [u] = await SELECT('SELECT u.id, u.name, u.email, u.job_role_id, u.account_status, u.department_id, d.department_name FROM users u LEFT JOIN department d ON d.id = u.department_id WHERE u.id = :userId', { userId }, transaction);
    return u || null;
};

const addHistory = (requestId, action, actor, fromStatus, toStatus, remark, transaction) => RUN(
    `INSERT INTO master_data_request_history (request_id, action, actor_id, actor_name, from_status, to_status, remark, created_at)
     VALUES (:requestId, :action, :actorId, :actorName, :fromStatus, :toStatus, :remark, NOW())`,
    { requestId, action, actorId: actor ? actor.id : null, actorName: actor ? actor.name : 'system', fromStatus: fromStatus || null, toStatus: toStatus || null, remark: remark || null }, transaction);

const cleanText = (v, label, max, required) => {
    const s = v === undefined || v === null ? '' : String(v).trim();
    if (!s && required) throw httpError(400, `${label} is required`);
    if (s.length > max) throw httpError(400, `${label} can be at most ${max} characters`);
    return s || null;
};

const adminLink = (baseUrl) => (baseUrl ? `${baseUrl.replace(/\/$/, '')}/datatable/admin/master-data#requests` : null);

// ------------------------------------------------------------------ create (managers)
const create = async (tokenUser, body, { baseUrl } = {}) => {
    const actor = await actorOf(Number(tokenUser && tokenUser.id));
    if (!actor || actor.account_status !== 'active' || !REQUESTER_ROLES.includes(Number(actor.job_role_id))) {
        throw httpError(403, 'Only managers can raise master data requests');
    }
    const scope = await md.resolveScope(tokenUser);
    const entity = String((body && body.entity) || '');
    if (!Object.prototype.hasOwnProperty.call(md.REGISTRY, entity) || !md.visible(entity, scope)) throw httpError(400, 'Pick one of the tables you can see');
    const action = String((body && body.action) || 'other');
    if (!ACTIONS[action]) throw httpError(400, 'Request type must be add, change, remove or other');
    const title = cleanText(body.title, 'Title', 200, true);
    const details = cleanText(body.details, 'Details', 5000, true);
    // Only table, request type, title and details are asked for (owner, 2026-11-05). A row id is
    // still accepted from API clients (must be in the manager's scope) but is optional.
    let targetId = null;
    let targetLabel = null;
    if (body.target_id !== undefined && body.target_id !== null && body.target_id !== '') {
        targetId = Number(body.target_id);
        if (!Number.isInteger(targetId) || targetId <= 0) throw httpError(400, 'Invalid row');
        if (!(await md.scopedIds(entity, scope)).has(targetId)) throw httpError(403, 'You can only refer to rows of your own department');
        const e = md.REGISTRY[entity];
        const [row] = await SELECT(`SELECT ${e.title} AS label FROM ${e.table} WHERE id = :targetId`, { targetId });
        targetLabel = row ? row.label : null;
    }
    const [{ n }] = await SELECT('SELECT COUNT(*) AS n FROM master_data_requests WHERE requested_by = :uid AND created_at >= NOW() - INTERVAL 1 DAY', { uid: actor.id });
    if (Number(n) >= DAILY_LIMIT) throw httpError(429, `You can raise at most ${DAILY_LIMIT} requests per day`);

    const id = await sequelize.transaction(async (transaction) => {
        const [insertId] = await sequelize.query(
            `INSERT INTO master_data_requests (requested_by, entity, action, target_id, target_label, title, details, status, created_at, updated_at)
             VALUES (:uid, :entity, :action, :targetId, :targetLabel, :title, :details, 'pending', NOW(), NOW())`,
            { replacements: { uid: actor.id, entity, action, targetId, targetLabel, title, details }, type: sequelize.QueryTypes.INSERT, transaction });
        await addHistory(insertId, 'created', actor, null, 'pending', null, transaction);
        return Number(insertId);
    });

    // email (queued; sendMail never throws and returns null when the queue is down)
    const e = md.REGISTRY[entity];
    let emailStatus = 'failed';
    try {
        const html = renderTemplate('masterDataRequest', {
            request_id: id,
            requester_name: actor.name,
            requester_email: actor.email,
            department: actor.department_name || '-',
            table_name: e.label,
            action_label: ACTIONS[action],
            target_label: targetLabel,
            title,
            details,
            admin_url: adminLink(baseUrl),
            frontend_url: process.env.FRONTEND_URL
        });
        // the manager who raised it is in CC
        const cc = actor.email && actor.email.toLowerCase() !== REQUEST_EMAIL().toLowerCase() ? actor.email : undefined;
        const queued = await sendMail({ to: REQUEST_EMAIL(), cc, subject: `Master data request #${id}: ${title} - D-Map`, html });
        emailStatus = queued ? 'queued' : 'failed';
    } catch (err) {
        console.error('Master data request email:', err.message);
    }
    await RUN('UPDATE master_data_requests SET email_status = :emailStatus WHERE id = :id', { emailStatus, id });
    await addHistory(id, emailStatus === 'queued' ? 'email_queued' : 'email_failed', null, null, null, `To ${REQUEST_EMAIL()}${actor.email ? ', cc ' + actor.email : ''}`);
    console.log(`[master-data] request #${id} by user ${actor.id} (${entity}/${action}), email ${emailStatus}`);
    return get(tokenUser, id);
};

// ------------------------------------------------------------------ read
const SELECT_REQUEST = `SELECT r.id, r.requested_by, u.name AS requested_by_name, u.email AS requested_by_email, d.department_name AS department,
        r.entity, r.action, r.target_id, r.target_label, r.title, r.details, r.status, r.admin_remark,
        r.resolved_by, ru.name AS resolved_by_name, r.resolved_at, r.email_status, r.created_at, r.updated_at
    FROM master_data_requests r
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN department d ON d.id = u.department_id
    LEFT JOIN users ru ON ru.id = r.resolved_by`;

const decorate = r => Object.assign(r, {
    table_label: md.REGISTRY[r.entity] ? md.REGISTRY[r.entity].label : r.entity,
    action_label: ACTIONS[r.action] || r.action
});

// Super Admin: every request; managers: their own.
const list = async (tokenUser, query = {}) => {
    const where = [];
    const repl = {};
    if (!isAdmin(tokenUser)) { where.push('r.requested_by = :uid'); repl.uid = Number(tokenUser.id); }
    if (query.status && STATUSES.includes(query.status)) { where.push('r.status = :status'); repl.status = query.status; }
    const rows = await SELECT(`${SELECT_REQUEST}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY FIELD(r.status, 'pending', 'in_progress', 'done', 'rejected'), r.id DESC LIMIT 500`, repl);
    const counts = await SELECT(`SELECT status, COUNT(*) AS n FROM master_data_requests r${isAdmin(tokenUser) ? '' : ' WHERE r.requested_by = :uid'} GROUP BY status`, { uid: Number(tokenUser.id) });
    const summary = { pending: 0, in_progress: 0, done: 0, rejected: 0 };
    counts.forEach(c => { summary[c.status] = Number(c.n); });
    return { rows: rows.map(decorate), summary };
};

const get = async (tokenUser, id) => {
    const [row] = await SELECT(`${SELECT_REQUEST} WHERE r.id = :id`, { id });
    if (!row || (!isAdmin(tokenUser) && Number(row.requested_by) !== Number(tokenUser.id))) throw httpError(404, 'Request not found');
    const history = await SELECT('SELECT id, action, actor_id, actor_name, from_status, to_status, remark, created_at FROM master_data_request_history WHERE request_id = :id ORDER BY id', { id });
    return Object.assign(decorate(row), { history });
};

// ------------------------------------------------------------------ update (Super Admin)
// status: pending -> in_progress -> done | rejected (done / rejected are final). A remark alone
// is stored as a comment.
const update = async (tokenUser, id, body) => {
    if (!isAdmin(tokenUser)) throw httpError(403, 'Only Super Admin can update requests');
    const actor = await actorOf(Number(tokenUser.id));
    const remark = cleanText(body && body.remark, 'Remark', 5000, false);
    const status = body && body.status ? String(body.status) : null;
    if (status && !STATUSES.includes(status)) throw httpError(400, 'Invalid status');
    if (!status && !remark) throw httpError(400, 'Give a new status or a remark');
    await sequelize.transaction(async (transaction) => {
        const [r] = await SELECT('SELECT id, status FROM master_data_requests WHERE id = :id FOR UPDATE', { id }, transaction);
        if (!r) throw httpError(404, 'Request not found');
        if (status && status !== r.status) {
            if (!OPEN.includes(r.status)) throw httpError(409, `This request is already ${r.status.replace('_', ' ')}`);
            if (status === 'pending') throw httpError(409, 'A request cannot go back to pending');
            const final = status === 'done' || status === 'rejected';
            await RUN(
                `UPDATE master_data_requests SET status = :status, admin_remark = COALESCE(:remark, admin_remark),
                    resolved_by = ${final ? ':uid' : 'resolved_by'}, resolved_at = ${final ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = :id`,
                { status, remark, uid: actor.id, id }, transaction);
            await addHistory(id, 'status_changed', actor, r.status, status, remark, transaction);
        } else {
            if (!remark) throw httpError(400, `The request is already ${r.status.replace('_', ' ')}`);
            await RUN('UPDATE master_data_requests SET admin_remark = :remark, updated_at = NOW() WHERE id = :id', { remark, id }, transaction);
            await addHistory(id, 'comment', actor, r.status, r.status, remark, transaction);
        }
    });
    return get(tokenUser, id);
};

// ------------------------------------------------------------------ admin popup
// Open requests newer than the last one this admin acknowledged (Redis mdreq:seen:<uid>).
const seenKey = uid => `mdreq:seen:${Number(uid)}`;
const alerts = async (tokenUser) => {
    if (!isAdmin(tokenUser)) throw httpError(403, 'Only Super Admin');
    let seen = 0;
    if (redisClient.status === 'ready') { try { seen = Number(await redisClient.get(seenKey(tokenUser.id))) || 0; } catch (e) { seen = 0; } }
    const [{ open }] = await SELECT(`SELECT COUNT(*) AS open FROM master_data_requests WHERE status IN ('pending', 'in_progress')`);
    const fresh = await SELECT(`${SELECT_REQUEST} WHERE r.status = 'pending' AND r.id > :seen ORDER BY r.id DESC LIMIT 20`, { seen });
    return { open: Number(open), seen, latest_id: fresh.length ? fresh[0].id : seen, unseen: fresh.map(decorate) };
};
const markSeen = async (tokenUser, lastId) => {
    if (!isAdmin(tokenUser)) throw httpError(403, 'Only Super Admin');
    const id = Number(lastId);
    if (!Number.isInteger(id) || id < 0) throw httpError(400, 'Invalid id');
    if (redisClient.status !== 'ready') return false;
    const prev = Number(await redisClient.get(seenKey(tokenUser.id))) || 0;
    if (id > prev) await redisClient.set(seenKey(tokenUser.id), String(id));
    return true;
};

module.exports = { create, list, get, update, alerts, markSeen, ACTIONS };
