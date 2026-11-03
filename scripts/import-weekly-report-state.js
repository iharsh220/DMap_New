// One-time import of the Python Weekly Report App's saved state into the admin weekly report.
//
//   node scripts/import-weekly-report-state.js "<Weekly Report App folder>" "<division title>"
//   e.g. node scripts/import-weekly-report-state.js "Weekly Report App" "Web Application"
//
// Copies data/state.json (settings, project edits, initiatives, highlight, notes, report history)
// into weekly_report_states for that division, plus data/highlights/* and Reports/*.pptx into
// storage/weekly-reports/<division id>/ so old reports stay downloadable. Refuses to overwrite a
// division that already has a saved state unless --force is given.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/databaseConfig');
const { WeeklyReportState } = require('../models');
const report = require('../services/weeklyReport/report');

(async () => {
    const [appDir, divisionTitle] = process.argv.slice(2).filter(a => a !== '--force');
    const force = process.argv.includes('--force');
    if (!appDir || !divisionTitle) {
        console.error('Usage: node scripts/import-weekly-report-state.js "<Weekly Report App folder>" "<division title>" [--force]');
        process.exit(1);
    }
    const [division] = await sequelize.query(
        `SELECT d.id, d.title FROM division d JOIN department dep ON dep.id = d.department_id
         WHERE dep.department_name = 'Digilabs' AND d.title = :title`,
        { replacements: { title: divisionTitle }, type: sequelize.QueryTypes.SELECT });
    if (!division) throw new Error(`No Digilabs division called "${divisionTitle}"`);
    if (!force && await WeeklyReportState.findOne({ where: { division_id: division.id } })) throw new Error(`${division.title} already has a saved weekly report state (use --force to replace it)`);

    const st = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'state.json'), 'utf8'));
    st.settings = st.settings || {};
    // folders of the desktop app have no meaning here; the vertical comes from the division
    ['export_folders', 'output_folder', 'team_vertical'].forEach(k => delete st.settings[k]);
    if (st.settings.requested_vertical && !st.settings.requested_verticals) st.settings.requested_verticals = [st.settings.requested_vertical];
    delete st.settings.requested_vertical;
    st.settings.unit = st.settings.unit || 'project';
    if (!st.settings.report_label) st.settings.report_label = division.title === 'Web Application' ? 'Web' : division.title;

    const copyAll = (from, to, filter) => {
        if (!fs.existsSync(from)) return [];
        fs.mkdirSync(to, { recursive: true });
        return fs.readdirSync(from).filter(filter).map(f => { fs.copyFileSync(path.join(from, f), path.join(to, f)); return f; });
    };
    const base = path.join(__dirname, '..', 'storage', 'weekly-reports', String(division.id));
    const images = copyAll(path.join(appDir, 'data', 'highlights'), path.join(base, 'highlights'), f => /\.(png|jpe?g|gif)$/i.test(f));
    const reports = copyAll(path.join(appDir, 'Reports'), path.join(base, 'reports'), f => /\.pptx$/i.test(f));
    st.highlight = st.highlight || { enabled: false, title: '', images: [] };
    st.highlight.images = (st.highlight.images || []).filter(x => images.includes(x));

    await report.saveState(division, st, null);
    console.log(`Imported into ${division.title} (division ${division.id}): ${(st.initiatives || []).length} initiatives, `
        + `${Object.keys(st.projects || {}).length} project edits, ${(st.history || []).length} history entries, `
        + `${images.length} highlight images, ${reports.length} reports; next report no ${st.settings.next_report_no}.`);
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
