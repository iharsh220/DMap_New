// Helpers for the local end-to-end tests (scripts/e2e). They run ONLY against a local copy of the
// dump (see CLAUDE.md "Local testing against a dump copy"): the API under test must run with
// DB_HOST=127.0.0.1 and EMAIL_PORT=9, and this script refuses any non-local DB host.
// Tokens are minted like login.js does (no passwords needed); they are kept in memory only.
const path = require('path');
const repo = path.resolve(__dirname, '../..');
require(path.join(repo, 'node_modules/dotenv')).config({ path: path.join(repo, '.env') });

if (!['127.0.0.1', 'localhost'].includes(process.env.DB_HOST)) {
    console.error('Refusing to run: DB_HOST must be 127.0.0.1 / localhost (a local copy of the dump), never production or UAT.');
    process.exit(2);
}

const mysql = require(path.join(repo, 'node_modules/mysql2/promise'));
const API = (process.env.E2E_LOCAL_API || `http://127.0.0.1:${process.env.E2E_API_PORT || 18080}${(process.env.BASE_ROUTE || '/digilabs/dmap/api/').replace(/\/?$/, '/')}`);

let db;
const sql = async (q, p) => {
    db = db || await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME, dateStrings: true });
    const [rows] = await db.query(q, p);
    return rows;
};

const tokens = {};
const tokenFor = async (userId) => {
    if (tokens[userId]) return tokens[userId];
    const { generateAccessToken } = require(path.join(repo, 'middleware/jwtMiddleware'));
    const { User, Department, JobRole, Location, Designation, UserDivisions, Division } = require(path.join(repo, 'models'));
    const u = await User.findByPk(Number(userId), { include: [Department, JobRole, Location, Designation] });
    const d = u.toJSON();
    delete d.password;
    d.userType = 'user';
    const divs = await UserDivisions.findAll({ where: { user_id: u.id }, include: [{ model: Division, as: 'division' }] });
    d.divisions = divs.map(x => { const j = x.division.toJSON(); delete j.created_at; delete j.updated_at; return j; });
    for (const k of ['department_id', 'job_role_id', 'location_id', 'designation_id']) delete d[k];
    d.department = d.Department; delete d.Department;
    d.jobRole = d.JobRole; delete d.JobRole;
    d.location = d.Location; delete d.Location;
    d.designation = d.Designation; delete d.Designation;
    tokens[userId] = await generateAccessToken(d);
    return tokens[userId];
};

const api = async (userId, method, url, body) => {
    const t0 = Date.now();
    const headers = { Authorization: 'Bearer ' + await tokenFor(userId) };
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch(API + url, { method, headers, body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = text; }
    return { status: r.status, body: json, ms: Date.now() - t0 };
};

const form = (fields, files = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const [k, name] of Object.entries(files)) f.append(k, new Blob(['e2e test file ' + name], { type: 'text/plain' }), name);
    return f;
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plus = (days) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);

let pass = 0;
let fail = 0;
const check = (name, cond, info = '') => {
    if (cond) pass++; else fail++;
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== '' ? '  ' + info : ''));
};
const done = async () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (db) await db.end();
    process.exit(fail ? 1 : 0);
};

module.exports = { sql, api, check, done, form, today, plus, repo };
