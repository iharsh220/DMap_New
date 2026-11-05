#!/usr/bin/env node
// Read-only data-integrity audit (R1, 2026-11-04). Prints one line per check: count and the newest ids.
// Usage on the server: node scripts/audit-data-integrity.js   (uses .env; runs SELECTs only, writes nothing)
require('dotenv').config();
const { sequelize } = require('../config/databaseConfig');

const CHECKS = [
    { key: 'A', label: 'change requests without change types (left by the multipart crash fixed on 2026-11-03; the types cannot be recovered)', sql: `SELECT COUNT(*) AS n, GROUP_CONCAT(ia.id ORDER BY ia.id DESC SEPARATOR ',') AS ids FROM issue_assignments ia WHERE ia.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM issue_assignment_types x WHERE x.issue_assignment_id=ia.id)` },
    { key: 'B', label: 'live tasks without any task_history row (tasks created before the history tables existed)', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(t.id ORDER BY t.id DESC),1,120) AS ids FROM tasks t WHERE t.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM task_history h WHERE h.task_id=t.id)` },
    { key: 'C', label: 'live tasks without an assignee', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(t.id ORDER BY t.id DESC),1,120) AS ids FROM tasks t WHERE t.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id=t.id)` },
    { key: 'D', label: 'changes at u_pending or later without an assignee', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(ia.id ORDER BY ia.id DESC),1,120) AS ids FROM issue_assignments ia WHERE ia.is_deleted=0 AND ia.status IN ('u_pending','u_accepted','in_progress','completed') AND NOT EXISTS (SELECT 1 FROM issue_user_assignments u WHERE u.issue_assignment_id=ia.id)` },
    { key: 'E', label: 'completed projects with open live tasks or changes (should be re-opened)', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(w.id ORDER BY w.id DESC),1,120) AS ids FROM work_requests w WHERE w.status='completed' AND w.is_deleted=0 AND (EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id=w.id AND t.is_deleted=0 AND t.status NOT IN ('completed','cancelled','rejected')) OR EXISTS (SELECT 1 FROM issue_assignments ia JOIN tasks t ON t.id=ia.task_id WHERE t.work_request_id=w.id AND t.is_deleted=0 AND ia.is_deleted=0 AND ia.status NOT IN ('completed','cancelled','rejected')))` },
    { key: 'F', label: 'projects without a manager', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(w.id ORDER BY w.id DESC),1,120) AS ids FROM work_requests w WHERE w.is_deleted=0 AND w.status NOT IN ('draft') AND NOT EXISTS (SELECT 1 FROM work_request_managers m WHERE m.work_request_id=w.id)` },
    { key: 'G', label: 'live tasks on deleted projects', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(t.id ORDER BY t.id DESC),1,120) AS ids FROM tasks t JOIN work_requests w ON w.id=t.work_request_id WHERE t.is_deleted=0 AND w.is_deleted=1` },
    { key: 'H', label: 'tasks final_approved but not completed', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(CONCAT(t.id,':',t.status) ORDER BY t.id DESC),1,120) AS ids FROM tasks t WHERE t.is_deleted=0 AND t.review_stage='final_approved' AND t.status NOT IN ('completed','cancelled','rejected')` },
    { key: 'I', label: 'changes without a task', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(ia.id),1,120) AS ids FROM issue_assignments ia WHERE ia.task_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=ia.task_id)` },
    { key: 'J', label: 'live changes without any issue_history row (created before the history tables existed)', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(ia.id ORDER BY ia.id DESC),1,120) AS ids FROM issue_assignments ia WHERE ia.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM issue_history h WHERE h.issue_assignment_id=ia.id)` },
    { key: 'K', label: 'duplicate task_history "assigned" rows', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(task_id),1,120) AS ids FROM (SELECT task_id FROM task_history WHERE action='assigned' GROUP BY task_id, actor_id, assigned_to_user_id, created_at HAVING COUNT(*)>1) d` },
    { key: 'L', label: 'duplicate work_request_history "task_assigned" rows', sql: `SELECT COUNT(*) AS n, '' AS ids FROM (SELECT 1 FROM work_request_history WHERE action='task_assigned' GROUP BY work_request_id, related_task_id, actor_id, created_at HAVING COUNT(*)>1) d` },
    { key: 'M', label: 'pending projects that already have tasks', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(w.id ORDER BY w.id DESC),1,120) AS ids FROM work_requests w WHERE w.is_deleted=0 AND w.status='pending' AND EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id=w.id AND t.is_deleted=0)` },
    { key: 'N', label: 'changes whose parent change is missing', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(ia.id),1,120) AS ids FROM issue_assignments ia WHERE ia.issue_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM issue_assignments p WHERE p.id=ia.issue_id)` },
    { key: 'O', label: 'completed tasks whose review never started', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(t.id ORDER BY t.id DESC),1,120) AS ids FROM tasks t WHERE t.is_deleted=0 AND t.status='completed' AND (t.review_stage IS NULL OR t.review_stage='not_started')` },
    { key: 'P', label: 'finished projects not yet completed (the daily 00:01 job completes them)', sql: `SELECT COUNT(*) AS n, SUBSTRING(GROUP_CONCAT(w.id ORDER BY w.id DESC),1,120) AS ids FROM work_requests w WHERE w.is_deleted=0 AND w.status IN ('accepted','assigned','in_progress') AND EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id=w.id AND t.is_deleted=0 AND t.status NOT IN ('cancelled','rejected')) AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.work_request_id=w.id AND t.is_deleted=0 AND t.status NOT IN ('cancelled','rejected') AND NOT (t.status='completed' AND t.review='approved' AND t.review_stage='final_approved')) AND NOT EXISTS (SELECT 1 FROM issue_assignments ia JOIN tasks t ON t.id=ia.task_id WHERE t.work_request_id=w.id AND t.is_deleted=0 AND ia.is_deleted=0 AND ia.status NOT IN ('cancelled','rejected') AND NOT (ia.status='completed' AND ia.review='approved' AND ia.review_stage='final_approved'))` },
];

(async () => {
    let problems = 0;
    for (const check of CHECKS) {
        const [row] = await sequelize.query(check.sql, { type: sequelize.QueryTypes.SELECT });
        const n = Number(row.n);
        if (n > 0) problems++;
        console.log(`${check.key} ${String(n).padStart(5)}  ${check.label}${n ? `\n         ids: ${String(row.ids || '').slice(0, 200)}` : ''}`);
    }
    console.log(`\n${problems} check(s) with rows`);
    await sequelize.close();
})().catch((error) => {
    console.error('Audit failed:', error.message);
    process.exit(1);
});
