const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function loadE2eConfig() {
    const localPath = path.join(REPO_ROOT, '.env.e2e.local');
    const downloadPath = path.join(REPO_ROOT, 'env.e2e.download');
    const base = parseEnvFile(downloadPath);
    const local = parseEnvFile(localPath);
    const cfg = { ...base, ...local };

    const target = (process.env.E2E_API_TARGET || cfg.E2E_API_TARGET || '').replace(/\/+$/, '');
    if (!target || !/\/uat(\/|$)/i.test(target)) {
        throw new Error(`Safety stop: E2E_API_TARGET must point to a UAT URL containing "/uat/". Got: "${target}"`);
    }
    cfg.E2E_API_TARGET = target;
    cfg.E2E_LOGIN_TYPE = cfg.E2E_LOGIN_TYPE || 'email';
    return cfg;
}

const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plusDays = (days) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);

function makeForm(fields = {}, files = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        fd.append(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
    }
    for (const [field, spec] of Object.entries(files)) {
        const list = Array.isArray(spec) ? spec : [spec];
        for (const item of list) {
            const name = typeof item === 'string' ? item : item.name;
            const content = typeof item === 'string' ? `D-Map automated test artifact (${name}) ${new Date().toISOString()}` : item.content;
            fd.append(field, new Blob([content], { type: 'text/plain' }), name);
        }
    }
    return fd;
}

class TestContext {
    constructor(suiteName, cfg) {
        this.suiteName = suiteName;
        this.cfg = cfg;
        this.baseUrl = cfg.E2E_API_TARGET;
        this.sessions = {};
        this.checks = [];
        this.findings = [];
        this.createdWorkRequests = [];
        this.startedAt = Date.now();
    }

    async loginAll() {
        const map = {
            pmt: ['E2E_PMT_ID', 'E2E_PMT_PASSWORD'],
            cmA: ['E2E_CM_A_ID', 'E2E_CM_A_PASSWORD'],
            artistA: ['E2E_ARTIST_A_ID', 'E2E_ARTIST_A_PASSWORD'],
            cmB: ['E2E_CM_B_ID', 'E2E_CM_B_PASSWORD'],
            artistB: ['E2E_ARTIST_B_ID', 'E2E_ARTIST_B_PASSWORD']
        };
        for (const [alias, [idKey, pwKey]] of Object.entries(map)) {
            const identifier = this.cfg[idKey];
            const password = this.cfg[pwKey];
            if (!identifier || !password) {
                throw new Error(`Missing credentials in env config for ${alias} (${idKey}/${pwKey})`);
            }
            const res = await fetch(`${this.baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier,
                    password,
                    loginType: this.cfg.E2E_LOGIN_TYPE
                })
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body || !body.accessToken) {
                throw new Error(`Login failed for ${alias} (${identifier}): HTTP ${res.status} ${JSON.stringify(body)}`);
            }
            this.sessions[alias] = {
                token: body.accessToken,
                user: body.user
            };
        }
        return this.sessions;
    }

    user(alias) {
        if (!this.sessions[alias]) throw new Error(`Unknown session alias: ${alias}`);
        return this.sessions[alias].user;
    }

    async api(alias, method, endpoint, body = undefined) {
        const session = this.sessions[alias];
        if (!session) throw new Error(`Unknown session alias: ${alias}`);
        const cleanEndpoint = endpoint.replace(/^\/+/, '');
        const url = `${this.baseUrl}/${cleanEndpoint}`;
        const headers = {
            Authorization: `Bearer ${session.token}`
        };
        let payload = undefined;
        if (body instanceof FormData) {
            payload = body;
        } else if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }
        const t0 = Date.now();
        const res = await fetch(url, { method, headers, body: payload });
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = { raw: text };
        }
        return {
            status: res.status,
            ok: res.status >= 200 && res.status < 300,
            body: json,
            ms: Date.now() - t0,
            endpoint: `${method} /${cleanEndpoint}`
        };
    }

    async getLinkedProject(alias, workRequestId) {
        const r = await this.api(alias, 'GET', `datatable/admin/linked/project/${workRequestId}?fresh=${Date.now()}_${Math.random()}`);
        return r;
    }

    async getAdminRow(alias, gridPath, search) {
        const q = encodeURIComponent(search);
        return this.api(alias, 'GET', `datatable/admin/${gridPath}/data?search=${q}&limit=25&fresh=${Date.now()}_${Math.random()}`);
    }

    trackWorkRequest(id, cleanupAlias = 'cmA') {
        if (id) this.createdWorkRequests.push({ id, cleanupAlias });
    }

    check(name, passed, details = '', bugMeta = null) {
        const entry = {
            suite: this.suiteName,
            name,
            passed: Boolean(passed),
            details: typeof details === 'string' ? details : JSON.stringify(details)
        };
        this.checks.push(entry);
        const tag = entry.passed ? 'PASS' : 'FAIL';
        console.log(`  [${tag}] ${name}${entry.details ? ` — ${entry.details}` : ''}`);
        if (!entry.passed && bugMeta) {
            this.findings.push({
                suite: this.suiteName,
                check: name,
                ...bugMeta,
                observed: entry.details
            });
        }
        return entry.passed;
    }

    async cleanup() {
        if (process.env.E2E_KEEP_DATA === '1') {
            console.log(`  [cleanup] Skipping cleanup (E2E_KEEP_DATA=1) for ${this.createdWorkRequests.length} work request(s).`);
            return;
        }
        for (const item of this.createdWorkRequests.slice().reverse()) {
            try {
                const r = await this.api(item.cleanupAlias, 'DELETE', `manager/assigned-work-requests/${item.id}`);
                if (!r.ok) {
                    console.log(`  [cleanup] Could not soft-delete WR #${item.id}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
                }
            } catch (e) {
                console.log(`  [cleanup] Error deleting WR #${item.id}: ${e.message}`);
            }
        }
    }

    summary() {
        const passed = this.checks.filter(c => c.passed).length;
        const failed = this.checks.length - passed;
        return {
            suite: this.suiteName,
            total: this.checks.length,
            passed,
            failed,
            durationMs: Date.now() - this.startedAt,
            checks: this.checks,
            findings: this.findings
        };
    }
}

async function discoverMetadata(ctx) {
    const rtRes = await ctx.api('pmt', 'GET', 'request-types');
    const rtMap = rtRes.body?.data || {};
    const findRt = (name) => {
        const list = rtMap[name];
        return Array.isArray(list) && list.length ? list[0].id : null;
    };
    const verticalAName = ctx.cfg.E2E_VERTICAL_A || 'Web & Digital Solutions';
    const verticalBName = ctx.cfg.E2E_VERTICAL_B || 'Design & Graphics';
    const rtA = findRt(verticalAName) || 4;
    const rtB = findRt(verticalBName) || 1;
    const rtVideo = findRt('Video & Animation') || 2;

    const ptARes = await ctx.api('pmt', 'GET', `work-requests/project-types?request_type_id=${rtA}`);
    const ptAList = ptARes.body?.data || [];
    const videoFramerPt = ptAList.find(p => /video framer/i.test(p.project_type)) || ptAList[0];

    const ptBRes = await ctx.api('pmt', 'GET', `work-requests/project-types?request_type_id=${rtB}`);
    const ptBList = ptBRes.body?.data || [];
    const ptB = ptBList[0];

    const ttARes = await ctx.api('cmA', 'GET', `manager/assigned-work-requests/id/task-types?project_id=${videoFramerPt?.id || 20}`);
    const ttAList = ttARes.body?.data || [];
    const ttBRes = await ctx.api('cmB', 'GET', `manager/assigned-work-requests/id/task-types?project_id=${ptB?.id || 1}`);
    const ttBList = ttBRes.body?.data || [];

    const irRes = await ctx.api('pmt', 'GET', 'issue-register');
    const irList = irRes.body?.data || [];

    return {
        rtA,
        rtB,
        rtVideo,
        ptAId: videoFramerPt?.id || 20,
        ptAName: videoFramerPt?.project_type || 'Video Framer',
        ptBId: ptB?.id || 1,
        ttAId: ttAList[0]?.id || 74,
        ttBId: ttBList[0]?.id || 1,
        issueRegisterId: irList[0]?.id || 1
    };
}

module.exports = {
    loadE2eConfig,
    todayIst,
    plusDays,
    makeForm,
    TestContext,
    discoverMetadata
};
