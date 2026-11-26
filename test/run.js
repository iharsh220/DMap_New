const fs = require('fs');
const path = require('path');

const SUITES = [
    ['01', './cases/01-project-and-task-lifecycle.test'],
    ['02', './cases/02-changes-issues-and-versions.test'],
    ['03', './cases/03-cross-manager-delegation.test'],
    ['04', './cases/04-task-count-and-date-validations.test'],
    ['05', './cases/05-completion-and-reopen.test'],
    ['06', './cases/06-edge-cases-access-and-data.test'],
    ['07', './cases/07-visibility-filters-and-data.test'],
    ['08', './cases/08-logs-and-email-audit.test']
];

async function main() {
    const args = process.argv.slice(2);
    const selected = args.length
        ? SUITES.filter(([id, p]) => args.some(a => id === a || p.includes(a)))
        : SUITES;

    if (selected.length === 0) {
        console.error('No matching test suites. Available:', SUITES.map(([id]) => id).join(', '));
        process.exit(2);
    }

    const results = [];
    for (const [id, modPath] of selected) {
        console.log(`\n=== Running Suite ${id}: ${modPath} ===`);
        const mod = require(modPath);
        const summary = await mod.run();
        results.push(summary);
        console.log(`=== Suite ${id} finished: ${summary.passed}/${summary.total} passed (${summary.failed} failed) in ${summary.durationMs} ms ===`);
    }

    const totals = {
        ranAt: new Date().toISOString(),
        suites: results.length,
        totalChecks: results.reduce((s, r) => s + r.total, 0),
        passed: results.reduce((s, r) => s + r.passed, 0),
        failed: results.reduce((s, r) => s + r.failed, 0),
        findingsCount: results.reduce((s, r) => s + r.findings.length, 0),
        results
    };

    const outDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'latest.json');
    fs.writeFileSync(outFile, JSON.stringify(totals, null, 2));

    console.log(`\nOVERALL: ${totals.passed}/${totals.totalChecks} passed, ${totals.failed} failed, ${totals.findingsCount} findings logged -> ${outFile}`);
    process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
