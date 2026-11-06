// "Linked work" in the admin detail drawers (owner, 2026-11-06): for a project, task or change,
// return its project with every live task and every live change of those tasks, so the drawer can
// show project -> tasks -> changes. Same rows as the grids (is_deleted = 0); no cost fields.
// GET /datatable/admin/linked/:kind/:id   kind = project | task | change
const { sequelize } = require('../config/databaseConfig');
const { parseId } = require('../utils/validators');

const SELECT = { type: sequelize.QueryTypes.SELECT };

const projectIdOf = async (kind, id) => {
    const q = {
        project: 'SELECT wr.id FROM work_requests wr WHERE wr.id = :id AND wr.is_deleted = 0',
        task: 'SELECT t.work_request_id AS id FROM tasks t WHERE t.id = :id AND t.is_deleted = 0',
        change: `SELECT t.work_request_id AS id FROM issue_assignments ia
                 INNER JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
                 WHERE ia.id = :id AND ia.is_deleted = 0`
    }[kind];
    const [row] = await sequelize.query(q, Object.assign({ replacements: { id } }, SELECT));
    return row ? row.id : null;
};

const getLinkedWork = async (req, res) => {
    try {
        const kind = String(req.params.kind || '');
        if (!['project', 'task', 'change'].includes(kind)) return res.status(400).json({ success: false, error: 'kind must be project, task or change' });
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
        const wrId = await projectIdOf(kind, id);
        if (!wrId) return res.status(404).json({ success: false, error: `${kind[0].toUpperCase() + kind.slice(1)} not found` });

        const replacements = { wrId };
        const [project] = await sequelize.query(`
            SELECT wr.id, wr.project_name, wr.status, wr.priority, wr.brand,
                   rt.request_type, pt.project_type, ru.name AS requester_name,
                   wr.requested_at, wr.created_at,
                   (SELECT GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ')
                      FROM work_request_managers wrm INNER JOIN users u ON u.id = wrm.manager_id
                     WHERE wrm.work_request_id = wr.id) AS managers
            FROM work_requests wr
            LEFT JOIN request_type rt ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt ON pt.id = wr.project_id
            LEFT JOIN users ru ON ru.id = wr.user_id
            WHERE wr.id = :wrId`, Object.assign({ replacements }, SELECT));

        const tasks = await sequelize.query(`
            SELECT t.id, t.task_name, t.status, t.review, t.review_stage, tt.task_type,
                   t.deadline, t.start_date, t.end_date, t.task_count, t.created_at,
                   (SELECT GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ')
                      FROM task_assignments ta INNER JOIN users u ON u.id = ta.user_id
                     WHERE ta.task_id = t.id) AS assignees
            FROM tasks t
            LEFT JOIN task_type tt ON tt.id = t.task_type_id
            WHERE t.work_request_id = :wrId AND t.is_deleted = 0
            ORDER BY t.id`, Object.assign({ replacements }, SELECT));

        const changes = tasks.length ? await sequelize.query(`
            SELECT ia.id, ia.task_id, ia.issue_id AS parent_id, ia.version, ia.status, ia.review, ia.review_stage,
                   ia.deadline, ia.start_date, ia.end_date, ia.task_count, ia.created_at,
                   rb.name AS requested_by,
                   (SELECT GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ')
                      FROM issue_user_assignments iua INNER JOIN users u ON u.id = iua.user_id
                     WHERE iua.issue_assignment_id = ia.id) AS assignees,
                   (SELECT GROUP_CONCAT(DISTINCT ir.change_issue_type ORDER BY ir.change_issue_type SEPARATOR ', ')
                      FROM issue_assignment_types iat INNER JOIN issue_register ir ON ir.id = iat.issue_register_id
                     WHERE iat.issue_assignment_id = ia.id) AS change_types
            FROM issue_assignments ia
            INNER JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
            LEFT JOIN users rb ON rb.id = ia.requested_by_user_id
            WHERE t.work_request_id = :wrId AND ia.is_deleted = 0
            ORDER BY ia.task_id, ia.id`, Object.assign({ replacements }, SELECT)) : [];

        const byTask = new Map(tasks.map(t => [t.id, Object.assign(t, { changes: [] })]));
        changes.forEach(c => { const t = byTask.get(c.task_id); if (t) t.changes.push(c); });
        const pages = (list) => list.reduce((s, x) => s + (Number(x.task_count) || 0), 0);

        res.json({
            success: true,
            data: {
                focus: { kind, id },
                project,
                tasks,
                totals: {
                    tasks: tasks.length,
                    task_pages: pages(tasks),
                    changes: changes.length,
                    change_pages: pages(changes)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching linked work:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

module.exports = { getLinkedWork };
