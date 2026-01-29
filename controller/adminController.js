const { sequelize } = require('../config/databaseConfig');

const getAdminData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const replacements = {};
        const whereClauses = [];

        if (startDate) {
            whereClauses.push('wr.requested_at >= :startDate');
            replacements.startDate = startDate;
        }

        if (endDate) {
            whereClauses.push('wr.requested_at <= :endDate');
            replacements.endDate = endDate;
        }

        let query = `
            SELECT
                wr.id AS work_request_id,
                wr.project_name,
                rdiv.title AS requester_division,
                ru.name AS requester_name,
                mdiv.title AS manager_division,
                u.name AS manager_name,
                COUNT(t.task_count) AS task_count,
                SUM(t.task_count) AS no_of_work_pages
            FROM work_requests wr
            LEFT JOIN users ru ON wr.user_id = ru.id
            LEFT JOIN user_divisions rud ON ru.id = rud.user_id
            LEFT JOIN division rdiv ON rud.division_id = rdiv.id
            LEFT JOIN work_request_managers wrm ON wr.id = wrm.work_request_id
            LEFT JOIN users u ON wrm.manager_id = u.id
            LEFT JOIN user_divisions mud ON u.id = mud.user_id
            LEFT JOIN division mdiv ON mud.division_id = mdiv.id
            LEFT JOIN tasks t ON wr.id = t.work_request_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            GROUP BY wr.id, wr.project_name, rdiv.title, ru.name, mdiv.title, u.name
        `;

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ data: results });

    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getTasksForWorkRequest = async (req, res) => {
    try {
        const { workRequestId } = req.params;

        const query = `
            SELECT
                t.id,
                t.task_name,
                t.description,
                t.status,
                t.deadline
            FROM tasks t
            WHERE t.work_request_id = :workRequestId
        `;

        const results = await sequelize.query(query, {
            replacements: { workRequestId },
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ tasks: results });

    } catch (error) {
        console.error('Error fetching tasks for work request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getAdminData,
    getTasksForWorkRequest
};
