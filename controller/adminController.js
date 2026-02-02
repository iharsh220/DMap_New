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
                COALESCE(wr.project_name, 'N/A') AS project_name,
                COALESCE(rt.request_type, 'N/A') AS project_type,
                COALESCE(rdiv.title, 'N/A') AS requester_division,
                COALESCE(ru.name, 'N/A') AS requester_name,
                COALESCE(mdiv.title, 'N/A') AS manager_division,
                COALESCE(GROUP_CONCAT(DISTINCT mu.name ORDER BY mu.name SEPARATOR ', '), 'N/A') AS manager_name,
                1 AS project_count,
                COUNT(DISTINCT t.id) AS task_count,
                DATE_FORMAT(wr.requested_at, '%d/%m/%Y') AS project_request_date,
                COALESCE(MIN(t.start_date), 'N/A') AS project_start_date,
                COALESCE(
                    CASE 
                        WHEN COUNT(DISTINCT t.id) = COUNT(DISTINCT CASE WHEN t.end_date IS NOT NULL THEN t.id END) THEN MAX(t.end_date) 
                        ELSE NULL 
                    END, 'N/A'
                ) AS project_end_date,
                CASE
                    WHEN MIN(t.start_date) IS NULL AND COUNT(DISTINCT CASE WHEN t.end_date IS NOT NULL THEN t.id END) = 0 THEN 'upcoming'
                    WHEN MIN(t.start_date) IS NOT NULL AND COUNT(DISTINCT t.id) = COUNT(DISTINCT CASE WHEN t.end_date IS NOT NULL THEN t.id END) THEN 'completed'
                    ELSE 'ongoing'
                END AS project_status
            FROM work_requests wr
            LEFT JOIN request_type rt ON wr.request_type_id = rt.id
            LEFT JOIN users ru ON wr.user_id = ru.id
            LEFT JOIN user_divisions rud ON ru.id = rud.user_id
            LEFT JOIN division rdiv ON rud.division_id = rdiv.id
            LEFT JOIN work_request_managers wrm ON wr.id = wrm.work_request_id
            LEFT JOIN users mu ON wrm.manager_id = mu.id
            LEFT JOIN request_division_reference rdr ON rt.id = rdr.request_id
            LEFT JOIN division mdiv ON rdr.division_id = mdiv.id
            LEFT JOIN tasks t ON wr.id = t.work_request_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            GROUP BY 
                wr.id, 
                wr.project_name, 
                rt.request_type,
                rdiv.title, 
                ru.name, 
                mdiv.title,
                wr.requested_at
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
