// UAT end-to-end runner.
//   node tests/uat/run.js                 all scenarios
//   node tests/uat/run.js s1 s3           only some (s1 … s6)
// Writes tests/uat/results/run-<time>.md/.json and appends failures to tests/uat/ISSUES.md.
const L = require('./lib');
const fullFlow = require('./scenarios/01-full-flow');
const delegation = require('./scenarios/02-delegation');
const cd = require('./scenarios/03-cancel-delete');

const ALL = [
    ['s1', 'S1 Full flow: request → accept → task → submit → rework → approve → PMT changes V2, V3 → approve', fullFlow],
    ['s2', 'S2 Delegation: Manager → Manager → User', delegation],
    ['s3', 'S3 Cancel project', cd.cancelProject],
    ['s4', 'S4 Cancel a change request', cd.cancelChange],
    ['s5', 'S5 Delete task and project', cd.deleteFlow],
    ['s6', 'S6 Defer a project', cd.deferFlow]
];

(async () => {
    const pick = process.argv.slice(2).map(s => s.toLowerCase());
    const run = pick.length ? ALL.filter(([k]) => pick.includes(k)) : ALL;
    console.log(`UAT backend: ${L.API}`);
    L.scenario('Accounts');
    for (const role of L.ROLES) {
        try {
            const u = await L.login(role);
            L.check(`login ${role}: ${u.name} (#${u.id}, role ${u.role_id}, ${u.divisions.join('/')})`, true);
        } catch (err) {
            L.check(`login ${role}`, false, err.message, { expected: 'login works' });
        }
    }
    for (const [, name, fn] of run) {
        L.scenario(name);
        const t0 = Date.now();
        try {
            await fn();
        } catch (err) {
            L.check('scenario finished', false, err.message, { expected: 'all steps run' });
        }
        console.log(`     (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    const failures = L.writeReports();
    process.exit(failures ? 1 : 0);
})();
