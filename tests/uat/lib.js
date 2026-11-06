// UAT end-to-end test library (talks to the live UAT backend over HTTP; no database access).
// Accounts and the backend URL come from `.env.e2e.local` in the repo root (git-ignored).
// Refuses to run against anything that is not a UAT URL.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = process.env.E2E_ENV || path.join(ROOT, '.env.e2e.local');
const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2]; // a key written twice: the LAST value wins (same as dotenv)
}
const API = String(env.E2E_API_TARGET || '').replace(/\/?$/, '/');
if (!/\/uat\//i.test(API)) {
    console.error(`Refusing to run: E2E_API_TARGET (${API}) is not a UAT URL.`);
    process.exit(2);
}

const ROLES = ['PMT', 'CM_A', 'ARTIST_A', 'CM_B', 'ARTIST_B', 'CM_C', 'ARTIST_C'];
const users = {};   // role -> { id, name, email, role_id, divisions, token }

const login = async (role) => {
    if (users[role] && users[role].token) return users[role];
    const r = await fetch(API + 'auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: env[`E2E_${role}_ID`], password: env[`E2E_${role}_PASSWORD`], loginType: env.E2E_LOGIN_TYPE || 'email' })
    });
    const b = await r.json().catch(() => ({}));
    const d = b.data || b;
    const u = d.user || d.userData || {};
    const token = d.accessToken || d.access_token || (d.tokens && d.tokens.accessToken);
    if (!token) throw new Error(`Login failed for ${role} (${env[`E2E_${role}_ID`]}): ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
    users[role] = { id: u.id, name: u.name, email: u.email, role_id: u.jobRole && u.jobRole.id, divisions: (u.divisions || []).map(x => x.title), token };
    return users[role];
};

// HTTP call as a role. body: object (JSON) or FormData. Returns { status, body, ms }.
const api = async (role, method, url, body) => {
    const u = await login(role);
    const t0 = Date.now();
    const headers = { Authorization: 'Bearer ' + u.token };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch(API + url, { method, headers, body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch (e) { json = text; }
    const res = { status: r.status, body: json, ms: Date.now() - t0, method, url, role };
    log.calls.push({ at: new Date().toISOString(), role, method, url, status: r.status, ms: res.ms });
    return res;
};

const form = (fields, files = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null) continue;
        f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    for (const [k, name] of Object.entries(files)) f.append(k, new Blob(['UAT e2e test file ' + name], { type: 'text/plain' }), name);
    return f;
};

// IST dates (the backend works in +05:30)
const istNow = () => new Date(Date.now() + 330 * 60000);
const today = () => istNow().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);

// rows of a list response: data, data.rows, data.history, data.data …
const rows = (body) => {
    if (!body) return [];
    const d = body.data !== undefined ? body.data : body;
    if (Array.isArray(d)) return d;
    for (const k of ['rows', 'history', 'data', 'items', 'tasks', 'workRequests', 'issues']) if (d && Array.isArray(d[k])) return d[k];
    return [];
};
const ok = r => r.status >= 200 && r.status < 300;
const short = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 300 ? s.slice(0, 300) + '…' : s; };

// ---- result log ------------------------------------------------------------------------------
const log = { scenario: null, checks: [], calls: [], timelines: [], started: new Date().toISOString(), created: [] };

const scenario = (name) => { log.scenario = name; console.log(`\n=== ${name}`); };

/**
 * check(name, condition, details, opts)
 *   opts.res      : the response that was checked (status / body go into the issue)
 *   opts.expected : what should have happened (text)
 *   opts.severity : 'bug' (default) | 'gap' (works, but differs from the owner's rule) | 'info'
 */
const check = (name, cond, details = '', opts = {}) => {
    const pass = !!cond;
    const entry = { scenario: log.scenario, name, pass, details: short(details), severity: opts.severity || 'bug',
        expected: opts.expected || null, request: opts.res ? `${opts.res.role} ${opts.res.method} ${opts.res.url}` : null,
        status: opts.res ? opts.res.status : null, response: opts.res ? short(opts.res.body) : null, at: new Date().toISOString() };
    log.checks.push(entry);
    console.log(`${pass ? 'PASS' : (entry.severity === 'gap' ? 'GAP ' : 'FAIL')} ${name}${details !== '' ? '  ' + short(details) : ''}`);
    return pass;
};

// a step that must succeed for the scenario to go on: throws (scenario stops) when it fails
const must = (name, res, pick) => {
    const good = ok(res);
    check(name, good, `${res.status} ${good && pick ? short(pick(res.body)) : short(res.body)}`, { res, expected: '2xx' });
    if (!good) throw new Error(`Stopped: "${name}" failed with ${res.status}`);
    return res;
};

const timeline = (title, entries) => { log.timelines.push({ scenario: log.scenario, title, entries }); };

// ---- report files ----------------------------------------------------------------------------
const writeReports = () => {
    const dir = path.join(__dirname, 'results');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = log.started.replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(dir, `run-${stamp}.json`), JSON.stringify(log, null, 2));
    const pass = log.checks.filter(c => c.pass).length;
    const failed = log.checks.filter(c => !c.pass);
    let md = `# UAT run ${log.started}\n\nBackend: ${API}\n\n**${pass} passed, ${failed.filter(c => c.severity === 'bug').length} failed, ${failed.filter(c => c.severity === 'gap').length} gaps**\n\n`;
    md += `Accounts: ${ROLES.filter(r => users[r]).map(r => `${r} = ${users[r].name} (#${users[r].id}, role ${users[r].role_id}, ${users[r].divisions.join('/')})`).join('; ')}\n\n`;
    if (log.created.length) md += `Created on UAT: ${log.created.join(', ')}\n\n`;
    let current = null;
    for (const c of log.checks) {
        if (c.scenario !== current) { current = c.scenario; md += `\n## ${current}\n\n| | Check | Details |\n|---|---|---|\n`; }
        md += `| ${c.pass ? 'PASS' : (c.severity === 'gap' ? 'GAP' : 'FAIL')} | ${c.name.replace(/\|/g, '/')} | ${String(c.details || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |\n`;
    }
    for (const t of log.timelines) {
        md += `\n### Timeline: ${t.title} (${t.scenario})\n\n| When | Record | Action | Status | Review | By |\n|---|---|---|---|---|---|\n`;
        for (const e of t.entries) md += `| ${e.when || ''} | ${e.record || ''} | ${e.action || ''} | ${e.status || ''} | ${e.review || ''} | ${e.by || ''} |\n`;
    }
    const file = path.join(dir, `run-${stamp}.md`);
    fs.writeFileSync(file, md);

    // append new problems to ISSUES.md (one block per run)
    if (failed.length) {
        const issues = path.join(__dirname, 'ISSUES.md');
        let block = `\n## Run ${log.started} (automatic)\n\n`;
        failed.forEach((c, i) => {
            block += `### ${i + 1}. [${c.severity === 'gap' ? 'GAP' : 'BUG'}] ${c.scenario}: ${c.name}\n`;
            if (c.expected) block += `- Expected: ${c.expected}\n`;
            if (c.request) block += `- Request: \`${c.request}\` → ${c.status}\n`;
            if (c.details) block += `- Got: ${c.details}\n`;
            if (c.response && c.response !== c.details) block += `- Response: \`${String(c.response).replace(/`/g, "'")}\`\n`;
            block += `- Status: open\n\n`;
        });
        fs.appendFileSync(issues, block);
    }
    console.log(`\n${pass} passed, ${failed.filter(c => c.severity === 'bug').length} failed, ${failed.filter(c => c.severity === 'gap').length} gaps`);
    console.log(`Report: ${file}`);
    return failed.filter(c => c.severity === 'bug').length;
};

module.exports = { env, API, ROLES, users, login, api, form, today, plus, rows, ok, short, check, must, scenario, timeline, log, writeReports };
