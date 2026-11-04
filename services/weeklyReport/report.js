// Saved state (what the manager edited) + assembling the final report rows.
// Node port of "Weekly Report App/report.py"; the state lives in `weekly_report_states`
// (one JSON row per division) instead of data/state.json.
const { WeeklyReportState } = require('../../models');
const engine = require('./engine');

const STATUS_ORDER = { Completed: 0, Ongoing: 1, Upcoming: 2, Cancelled: 3 };

const defaultSettings = async (division) => {
    const isWeb = division.title === 'Web Application';
    return {
        team_name: `${division.title} Team`,
        report_label: isWeb ? 'Web' : division.title,
        unit: isWeb ? 'project' : 'task',
        requested_verticals: await engine.defaultRequestedVerticals(division.id),
        team_vertical: division.title,
        initiative_clients: [],
        initiative_lead: '',
        active_days: 30,
        next_report_no: 1,
        division_alias: { 'Corporate Communication': 'Corp Comm' },
        type_alias: {},
        initials_overrides: {}
    };
};

const SETTING_KEYS = ['team_name', 'report_label', 'unit', 'requested_verticals', 'initiative_clients', 'initiative_lead',
    'active_days', 'next_report_no', 'division_alias', 'type_alias', 'initials_overrides'];

async function loadState(division) {
    const row = await WeeklyReportState.findOne({ where: { division_id: division.id } });
    let st = {};
    if (row) {
        try { st = JSON.parse(row.state) || {}; } catch (e) { st = {}; }
    }
    st.settings = st.settings || {};
    const defaults = await defaultSettings(division);
    // states imported from the Python app carry a single `requested_vertical`
    if (st.settings.requested_verticals === undefined && st.settings.requested_vertical) {
        st.settings.requested_verticals = [st.settings.requested_vertical];
    }
    Object.keys(defaults).forEach(k => { if (st.settings[k] === undefined) st.settings[k] = defaults[k]; });
    st.settings.team_vertical = division.title;
    st.projects = st.projects || {};
    st.initiatives = st.initiatives || [];
    st.highlight = st.highlight || { enabled: false, title: '', images: [] };
    st.highlight.images = st.highlight.images || [];
    st.notes = st.notes || { notable: '', challenges: '' };
    st.history = st.history || [];
    return st;
}

async function saveState(division, st, userId) {
    const values = { state: JSON.stringify(st), updated_by: userId || null };
    const row = await WeeklyReportState.findOne({ where: { division_id: division.id } });
    if (row) await row.update(values);
    else await WeeklyReportState.create({ division_id: division.id, ...values });
}

const initiativeProjectIds = st => {
    const ids = new Set();
    st.initiatives.forEach(i => (i.project_ids || []).forEach(x => ids.add(String(x))));
    return ids;
};

// Row ids shown in the last report generated for an earlier week
const previousReportIds = (st, ws) => {
    const earlier = st.history.filter(h => (h.week_start || '') < ws);
    return new Set(earlier.length ? earlier[earlier.length - 1].project_ids || [] : []);
};

// Every row of the team with its saved edits merged in (for the page table)
function clientView(model, st, ws) {
    const linked = initiativeProjectIds(st);
    const prev = ws ? previousReportIds(st, ws) : new Set();
    const sets = st.settings;
    const rows = [];
    Object.entries(model).forEach(([pid, p]) => {
        if (linked.has(pid) || p.initiative_client) return;
        const e = st.projects[pid] || {};
        const include = e.include === undefined ? null : e.include;
        const auto = p.auto_include || (p.status === 'Cancelled' && prev.has(pid));
        const divisionAuto = sets.division_alias[p.division] || p.division;
        const typeAuto = sets.type_alias[p.type] || p.type;
        rows.push({
            ...p,
            division_auto: divisionAuto,
            type_auto: typeAuto,
            division_out: e.division || divisionAuto,
            type_out: e.type || typeAuto,
            name_out: e.name || p.name,
            status_out: e.status || p.status,
            start_out: e.start || p.start,
            end_out: e.end || p.end,
            count: e.count || p.count_auto || '1',
            remark: e.remark || '',
            include_override: include,
            auto_include: auto,
            was_in_last_report: prev.has(pid),
            included: include === null ? auto : include
        });
    });
    rows.sort((a, b) => (a.included === b.included ? 0 : a.included ? -1 : 1)
        || (STATUS_ORDER[a.status_out] ?? 9) - (STATUS_ORDER[b.status_out] ?? 9)
        || (a.end_iso || '9999').localeCompare(b.end_iso || '9999'));
    return rows;
}

const unlinkedInitiativeProjects = (model, st) => {
    const linked = initiativeProjectIds(st);
    return Object.entries(model).filter(([pid, p]) => p.initiative_client && !linked.has(pid)).map(([, p]) => p);
};

function initiativeView(model, st) {
    return st.initiatives.map(i => {
        const linked = (i.project_ids || []).map(String).filter(x => model[x]).map(x => model[x]);
        return {
            ...i,
            linked: linked.map(p => ({
                id: p.id, name: p.name, status: p.status, tasks: `${p.tasks_done}/${p.tasks_total}`,
                last_activity: p.last_activity, contributors: p.contributors, start: p.start
            }))
        };
    });
}

const pad2 = n => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = d => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

function assemble(model, st, ws, we) {
    const rows = clientView(model, st, ws).filter(r => r.included).map(r => ({
        id: r.id, name: r.name_out, division: r.division_out, type: r.type_out,
        count: r.count, start: r.start_out, end: r.end_out,
        status: r.status_out, remark: r.remark || r.suggested_remark
    }));
    rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    return {
        date_line: `${ws.slice(8, 10)} ${monYear(ws)} to ${we.slice(8, 10)} ${monYear(we)}`,
        team_name: st.settings.team_name,
        team_vertical: st.settings.team_vertical,
        unit: st.settings.unit,
        client_rows: rows,
        initiatives: st.initiatives.filter(i => i.include !== false),
        highlight: st.highlight,
        notes: st.notes
    };
}

const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

const fileName = (no, ws, we, label) =>
    `${no} - Weekly Report - ${label} ${ordinal(+ws.slice(8, 10))} ${monYear(ws)} to ${ordinal(+we.slice(8, 10))} ${monYear(we)}.pptx`;

module.exports = {
    STATUS_ORDER,
    SETTING_KEYS,
    loadState,
    saveState,
    clientView,
    unlinkedInitiativeProjects,
    initiativeView,
    assemble,
    fileName,
    pad2
};
