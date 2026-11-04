// Admin "Weekly report" page: the Weekly Report App (Python, Excel exports) on live D-Map data.
// Who may use it: Super Admin (any Digilabs division) and active Creative Managers of the Digilabs
// department (only their own divisions). Each division has its own saved state and reports.
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/databaseConfig');
const { parseId, parseDateOnly } = require('../utils/validators');
const engine = require('../services/weeklyReport/engine');
const report = require('../services/weeklyReport/report');
const pptgen = require('../services/weeklyReport/pptgen');

const STORAGE = path.join(__dirname, '..', 'storage', 'weekly-reports');
const STATUSES = ['Completed', 'Ongoing', 'Upcoming', 'Cancelled'];
const PROJECT_FIELDS = ['name', 'division', 'type', 'start', 'end', 'status', 'count', 'remark', 'include'];
const INIT_FIELDS = ['id', 'name', 'lead', 'contributors', 'vertical', 'count', 'start', 'end', 'status', 'remark', 'project_ids', 'include'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif'];
const MAX_IMAGES = 6;

// Input problems the user can fix: answered with their status and message (everything else is a 500)
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const divisionDir = (divisionId, sub) => path.join(STORAGE, String(divisionId), sub);

// Digilabs divisions the user may report on: all of them for the Super Admin, their own for an
// active Creative Manager of the Digilabs department, none for anyone else.
async function reportDivisions(user) {
    const digilabs = 'SELECT d.id, d.title FROM division d JOIN department dep ON dep.id = d.department_id WHERE dep.department_name = \'Digilabs\'';
    if (user.jobRole && user.jobRole.id === 1) return select(`${digilabs} ORDER BY d.title`);
    return select(`${digilabs}
          AND d.id IN (SELECT ud.division_id FROM user_divisions ud WHERE ud.user_id = :userId)
          AND EXISTS (SELECT 1 FROM users u JOIN department ud2 ON ud2.id = u.department_id
                      WHERE u.id = :userId AND u.job_role_id = 2 AND u.account_status = 'active' AND ud2.department_name = 'Digilabs')
        ORDER BY d.title`, { userId: user.id });
}

// Router guard: puts the allowed divisions and the chosen one on req.report
const reportAccess = async (req, res, next) => {
    try {
        const divisions = await reportDivisions(req.user);
        if (!divisions.length) return res.status(403).json({ success: false, error: 'Weekly reports are only for Digilabs managers' });
        const raw = req.query.division_id !== undefined ? req.query.division_id : (req.body || {}).division_id;
        const wanted = raw !== undefined && raw !== '' ? parseId(raw) : divisions[0].id;
        const division = divisions.find(d => d.id === wanted);
        if (!division) return res.status(403).json({ success: false, error: 'You cannot view this division' });
        req.report = { divisions, division };
        next();
    } catch (error) {
        console.error('Weekly report access check failed:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// One writer per division at a time (two managers of the same team editing together)
const locks = new Map();
const withLock = (divisionId, fn) => {
    const prev = locks.get(divisionId) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    locks.set(divisionId, run.finally(() => { if (locks.get(divisionId) === run) locks.delete(divisionId); }));
    return run;
};

// Report period: ?week_start=&week_end= (any range up to a year, e.g. from the date picker), or
// ?week_end= alone for the 7 days ending that day, or by default the latest Tuesday-to-Monday week.
// Returns null for an invalid period.
const weekFrom = (req) => {
    const src = Object.assign({}, req.body || {}, req.query);
    const we = src.week_end ? parseDateOnly(src.week_end) : null;
    const ws = src.week_start ? parseDateOnly(src.week_start) : null;
    if ((src.week_end && !we) || (src.week_start && !ws)) return null;
    if (ws && !we) return null;
    if (!we) return engine.reportWeek();
    const start = ws || engine.addDays(we, -6);
    if (start > we || start < engine.addDays(we, -366)) return null;
    return [start, we];
};

// Report number of an earlier report for exactly this period, else the next number
const reportNoFor = (st, ws, we) => {
    const h = st.history.find(x => x.week_start === ws && x.week_end === we);
    return h ? h.report_no : st.settings.next_report_no;
};

async function payload(req, st, ws, we) {
    const { division, divisions } = req.report;
    const model = await engine.buildModel(division.id, st.settings, ws, we);
    const requestTypes = (await select('SELECT request_type AS name FROM request_type ORDER BY request_type')).map(r => r.name);
    return {
        division,
        divisions,
        week: { start: ws, end: we, label: `${engine.fmtDate(ws)} to ${engine.fmtDate(we)}` },
        refreshed_at: new Date().toISOString(),
        settings: st.settings,
        request_types: requestTypes,
        client_rows: report.clientView(model, st, ws),
        initiatives: report.initiativeView(model, st),
        unlinked: report.unlinkedInitiativeProjects(model, st),
        all_projects: Object.values(model)
            .map(p => ({ id: p.id, name: p.name, client: p.client, project: p.project }))
            .sort((a, b) => (parseInt(String(b.id).replace(/\D/g, ''), 10) || 0) - (parseInt(String(a.id).replace(/\D/g, ''), 10) || 0)),
        highlight: st.highlight,
        notes: st.notes,
        history: st.history.slice(-8),
        default_week: engine.reportWeek(),
        file_name: report.fileName(reportNoFor(st, ws, we), ws, we, st.settings.report_label)
    };
}

const str = (v, max = 5000) => (v === null || v === undefined ? '' : String(v).slice(0, max));
const strMap = obj => {
    const out = {};
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([k, v]) => { if (str(k).trim() && str(v).trim()) out[str(k, 200).trim()] = str(v, 200).trim(); });
    }
    return out;
};
const strList = v => (Array.isArray(v) ? v : []).map(x => str(x, 200).trim()).filter(Boolean);

// Applies one edit to the state (same actions as the Python app's POST /api/*); throws on bad input
async function applyAction(action, body, st, req) {
    if (action === 'project') {
        const id = str(body.id, 40);
        if (!id || !PROJECT_FIELDS.includes(body.field)) throw bad('Unknown project field');
        const e = st.projects[id] || {};
        let v = body.value;
        if (body.field === 'include') v = v === null || v === undefined || v === '' ? null : !!v;
        else v = v === null || v === undefined ? '' : str(v);
        if (body.field === 'status' && v && !STATUSES.includes(v)) throw bad('Unknown status');
        if (v === null || v === '') delete e[body.field]; else e[body.field] = v;
        if (Object.keys(e).length) st.projects[id] = e; else delete st.projects[id];
    } else if (action === 'initiatives') {
        if (!Array.isArray(body.initiatives)) throw bad('initiatives must be a list');
        st.initiatives = body.initiatives.slice(0, 200).map(i => {
            const out = {};
            INIT_FIELDS.forEach(k => { out[k] = i[k]; });
            ['id', 'name', 'lead', 'contributors', 'vertical', 'count', 'start', 'end', 'remark'].forEach(k => { out[k] = str(out[k]); });
            out.status = STATUSES.includes(out.status) ? out.status : 'Ongoing';
            out.project_ids = strList(out.project_ids);
            out.include = out.include !== false;
            return out;
        });
    } else if (action === 'notes') {
        st.notes = { notable: str(body.notable, 20000), challenges: str(body.challenges, 20000) };
    } else if (action === 'highlight') {
        st.highlight.title = str(body.title, 300);
        st.highlight.enabled = !!body.enabled;
    } else if (action === 'highlight-remove') {
        st.highlight.images = st.highlight.images.filter(x => x !== body.name);
        const file = path.join(divisionDir(req.report.division.id, 'highlights'), path.basename(str(body.name, 200)));
        fs.promises.unlink(file).catch(() => {});
    } else if (action === 'highlight-order') {
        const wanted = strList(body.images);
        if (wanted.length !== st.highlight.images.length || wanted.some(x => !st.highlight.images.includes(x))) throw bad('Unknown images');
        st.highlight.images = wanted;
    } else if (action === 'settings') {
        const s = st.settings;
        if (body.team_name !== undefined) s.team_name = str(body.team_name, 200).trim() || s.team_name;
        if (body.report_label !== undefined) s.report_label = str(body.report_label, 60).replace(/[\\/:*?"<>|]/g, '').trim() || s.report_label;
        if (body.unit !== undefined) {
            if (!['project', 'task'].includes(body.unit)) throw bad('Report unit must be project or task');
            s.unit = body.unit;
        }
        if (body.requested_verticals !== undefined) {
            const known = new Set((await select('SELECT request_type AS name FROM request_type')).map(r => r.name));
            const list = strList(body.requested_verticals);
            if (list.some(x => !known.has(x))) throw bad('Unknown requested vertical');
            s.requested_verticals = list;
            delete s.requested_vertical;
        }
        if (body.initiative_clients !== undefined) s.initiative_clients = strList(body.initiative_clients);
        if (body.initiative_lead !== undefined) s.initiative_lead = str(body.initiative_lead, 20).trim();
        if (body.active_days !== undefined) {
            const n = parseInt(body.active_days, 10);
            if (!(n >= 1 && n <= 365)) throw bad('Active days must be 1 to 365');
            s.active_days = n;
        }
        if (body.next_report_no !== undefined) {
            const n = parseInt(body.next_report_no, 10);
            if (!(n >= 1 && n <= 100000)) throw bad('Report number must be a positive number');
            s.next_report_no = n;
        }
        ['division_alias', 'type_alias', 'initials_overrides'].forEach(k => { if (body[k] !== undefined) s[k] = strMap(body[k]); });
    } else if (action === 'new-week') {
        st.notes = { notable: '', challenges: '' };
        st.highlight = { enabled: false, title: '', images: [] };
    } else if (action !== 'refresh') {
        throw bad('Unknown action', 404);
    }
}

const fail = (res, error, fallback) => {
    if (error && error.status) return res.status(error.status).json({ success: false, error: error.message });
    console.error(fallback, error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
};

// GET /admin/reports/data?division_id=&week_end=
const getReportData = async (req, res) => {
    try {
        const week = weekFrom(req);
        if (!week) return res.status(400).json({ success: false, error: 'Invalid report period' });
        const st = await report.loadState(req.report.division);
        res.json({ success: true, data: await payload(req, st, ...week) });
    } catch (error) {
        fail(res, error, 'Error loading weekly report:');
    }
};

// POST /admin/reports/action/:action  (JSON body; returns the refreshed data like GET)
const postReportAction = async (req, res) => {
    const week = weekFrom(req);
    if (!week) return res.status(400).json({ success: false, error: 'Invalid report period' });
    try {
        const data = await withLock(req.report.division.id, async () => {
            const st = await report.loadState(req.report.division);
            await applyAction(req.params.action, req.body || {}, st, req);
            if (req.params.action !== 'refresh') await report.saveState(req.report.division, st, req.user.id);
            return payload(req, st, ...week);
        });
        res.json({ success: true, data });
    } catch (error) {
        fail(res, error, 'Error saving weekly report:');
    }
};

// POST /admin/reports/highlight/upload  (multipart "files"; up to 6 images on the slide)
const uploadHighlight = async (req, res) => {
    const week = weekFrom(req);
    if (!week) return res.status(400).json({ success: false, error: 'Invalid report period' });
    const files = req.files && req.files.files ? [].concat(req.files.files) : [];
    if (!files.length) return res.status(400).json({ success: false, error: 'No image uploaded' });
    try {
        const data = await withLock(req.report.division.id, async () => {
            const st = await report.loadState(req.report.division);
            const dir = divisionDir(req.report.division.id, 'highlights');
            await fs.promises.mkdir(dir, { recursive: true });
            // check every file before storing any
            files.forEach(file => {
                const ext = path.extname(file.name).slice(1).toLowerCase();
                if (!IMAGE_EXT.includes(ext) || !/^image\//.test(file.mimetype || '')) throw bad(`${file.name} is not a PNG, JPG or GIF image`);
                if (file.size > 10 * 1024 * 1024) throw bad(`${file.name} is larger than 10 MB`);
            });
            for (const file of files) {
                if (st.highlight.images.length >= MAX_IMAGES) break;
                const ext = path.extname(file.name).slice(1).toLowerCase();
                const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
                const name = `${stamp}_${path.basename(file.name, path.extname(file.name)).replace(/[^\w.-]/g, '_').slice(0, 80)}.${ext}`;
                await file.mv(path.join(dir, name));
                st.highlight.images.push(name);
                st.highlight.enabled = true;
            }
            await report.saveState(req.report.division, st, req.user.id);
            return payload(req, st, ...week);
        });
        res.json({ success: true, data });
    } catch (error) {
        fail(res, error, 'Error uploading highlight image:');
    }
};

// POST /admin/reports/generate  -> builds the .pptx, stores it and records it in the history
const generateReport = async (req, res) => {
    const week = weekFrom(req);
    if (!week) return res.status(400).json({ success: false, error: 'Invalid report period' });
    const [ws, we] = week;
    try {
        const result = await withLock(req.report.division.id, async () => {
            const { division } = req.report;
            const st = await report.loadState(division);
            const model = await engine.buildModel(division.id, st.settings, ws, we);
            const rep = report.assemble(model, st, ws, we);
            const no = reportNoFor(st, ws, we);
            const name = report.fileName(no, ws, we, st.settings.report_label);
            const buffer = await pptgen.generate(rep, { imageDir: divisionDir(division.id, 'highlights') });
            const dir = divisionDir(division.id, 'reports');
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path.join(dir, name), buffer);
            st.history = st.history.filter(h => !(h.week_start === ws && h.week_end === we));
            st.history.push({
                week_start: ws, week_end: we, report_no: no, file: name,
                generated_at: engine.fmtDate(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10))
                    + ' ' + new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16),
                generated_by: req.user.name || null,
                project_ids: rep.client_rows.map(r => r.id),
                counts: Object.fromEntries(STATUSES.map(k => [k, rep.client_rows.filter(r => r.status === k).length]))
            });
            st.history.sort((a, b) => a.week_start.localeCompare(b.week_start) || a.week_end.localeCompare(b.week_end));
            if (no >= st.settings.next_report_no) st.settings.next_report_no = no + 1;
            await report.saveState(division, st, req.user.id);
            return { file: name, data: await payload(req, st, ws, we) };
        });
        res.json({ success: true, file: result.file, data: result.data });
    } catch (error) {
        fail(res, error, 'Error generating weekly report:');
    }
};

// Stored files are only served when the division's state still lists them
const sendStored = (sub, type) => async (req, res) => {
    try {
        const name = path.basename(String(req.query.f || ''));
        const st = await report.loadState(req.report.division);
        const known = sub === 'reports' ? st.history.some(h => h.file === name) : st.highlight.images.includes(name);
        const file = path.join(divisionDir(req.report.division.id, sub), name);
        if (!name || !known || !fs.existsSync(file)) return res.status(404).json({ success: false, error: 'File not found' });
        res.setHeader('Cache-Control', 'private, no-store');
        if (type === 'download') return res.download(file, name);
        return res.sendFile(file);
    } catch (error) {
        fail(res, error, 'Error sending weekly report file:');
    }
};

module.exports = {
    reportAccess,
    reportDivisions,
    getReportData,
    postReportAction,
    uploadHighlight,
    generateReport,
    downloadReport: sendStored('reports', 'download'),
    highlightImage: sendStored('highlights', 'image')
};
