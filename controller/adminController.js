const { sequelize } = require('../config/databaseConfig');
const fs = require('fs');
const path = require('path');

const getAdminData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Hardcoded query from Sandesh_Query.txt
        let query = `
            SELECT
                wr.id AS work_request_id,
                wr.project_name,
                rdiv.title AS requester_division_title,
                ru.name AS requester_name,
                mdiv.title AS manager_division_title,
                t.id AS task_id,
                t.task_name,
                tt.task_type,
                t.task_count,
                wr.requested_at,
                t.deadline,
                t.start_date,
                t.end_date,
                t.status AS task_status,
                wr.status AS work_request_status,
                rd.department_name AS requester_department_name
            FROM work_requests wr
            LEFT JOIN request_type rt ON wr.request_type_id = rt.id
            LEFT JOIN project_type pt ON wr.project_id = pt.id
            LEFT JOIN users ru ON wr.user_id = ru.id
            LEFT JOIN department rd ON ru.department_id = rd.id
            LEFT JOIN job_role rjr ON ru.job_role_id = rjr.id
            LEFT JOIN location rl ON ru.location_id = rl.id
            LEFT JOIN designation rdes ON ru.designation_id = rdes.id
            LEFT JOIN user_divisions rud ON ru.id = rud.user_id
            LEFT JOIN division rdiv ON rud.division_id = rdiv.id
            LEFT JOIN work_request_documents wrd ON wr.id = wrd.work_request_id
            LEFT JOIN work_request_managers wrm ON wr.id = wrm.work_request_id
            LEFT JOIN users u ON wrm.manager_id = u.id
            LEFT JOIN department md ON u.department_id = md.id
            LEFT JOIN job_role mjr ON u.job_role_id = mjr.id
            LEFT JOIN location ml ON u.location_id = ml.id
            LEFT JOIN designation mdes ON u.designation_id = mdes.id
            LEFT JOIN user_divisions mud ON u.id = mud.user_id
            LEFT JOIN division mdiv ON mud.division_id = mdiv.id
            LEFT JOIN tasks t ON wr.id = t.work_request_id
            LEFT JOIN request_type trt ON t.request_type_id = trt.id
            LEFT JOIN task_type tt ON t.task_type_id = tt.id
            LEFT JOIN task_assignments ta ON t.id = ta.task_id
            LEFT JOIN users au ON ta.user_id = au.id
            LEFT JOIN department ad ON au.department_id = ad.id
            LEFT JOIN job_role ajr ON au.job_role_id = ajr.id
            LEFT JOIN location al ON au.location_id = al.id
            LEFT JOIN designation ades ON au.designation_id = ades.id
            LEFT JOIN user_divisions aud ON au.id = aud.user_id
            LEFT JOIN division adiv ON aud.division_id = adiv.id
            LEFT JOIN task_documents td ON ta.id = td.task_assignment_id
            LEFT JOIN task_dependencies tdp ON t.id = tdp.task_id
            LEFT JOIN task_project_reference tpr ON t.id = tpr.task_id
        `;

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

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        // Execute the query
        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        // Return data in DataTables expected format
        res.json({
            data: results
        });
    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getAdminData
};