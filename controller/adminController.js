const { sequelize } = require('../config/databaseConfig');

const getAdminData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const replacements = {};
        const whereClauses = [];

        if (startDate) {
            whereClauses.push('wr.created_at >= :startDate');
            replacements.startDate = startDate;
        }

        if (endDate) {
            whereClauses.push('wr.created_at <= :endDate');
            replacements.endDate = endDate;
        }

        let query = `
            SELECT
                wr.id                                                        AS work_request_id,
                COALESCE(NULLIF(TRIM(wr.project_name), ''), 'N/A')          AS project_name,
                COALESCE(NULLIF(TRIM(wr.brand), ''), 'N/A')                 AS brand,
                COALESCE(NULLIF(TRIM(rt.request_type), ''), 'N/A')          AS request_type_name,
                COALESCE(NULLIF(TRIM(rt.description), ''), 'N/A')           AS request_type_description,

                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT mu2.name ORDER BY mu2.name SEPARATOR ', ')
                         FROM work_request_managers wrm2
                         JOIN users mu2 ON mu2.id = wrm2.manager_id
                         WHERE wrm2.work_request_id = wr.id),
                    ''),
                'N/A')                                                       AS digi_vertical_manager_name,

                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A')                  AS project_requester_name,
                COALESCE(NULLIF(TRIM(ru.email), ''), 'N/A')                 AS project_request_creator_email,
                COALESCE(NULLIF(TRIM(ru.phone), ''), 'N/A')                 AS project_request_creator_phone,
                COALESCE(NULLIF(TRIM(dept.department_name), ''), 'N/A')     AS project_request_creator_department,
                COALESCE(NULLIF(TRIM(desig.designation_name), ''), 'N/A')   AS project_request_creator_designation,
                COALESCE(NULLIF(TRIM(loc.location_name), ''), 'N/A')        AS project_request_creator_location,

                COALESCE(NULLIF(TRIM(pt.project_type), ''), 'N/A')          AS project_type_name,
                COALESCE(NULLIF(TRIM(pt.description), ''), 'N/A')           AS project_type_description,

                COALESCE(NULLIF(TRIM(wr.priority), ''), 'N/A')              AS project_priority,

                1                                                            AS project_count,
                COUNT(DISTINCT t.id)                                         AS task_count,
                COUNT(DISTINCT ia.id)                                        AS issue_task_count,
                COALESCE(SUM(DISTINCT t.task_count), 0)                     AS task_no_of_work_pages,
                COALESCE(SUM(DISTINCT ia.task_count), 0)                    AS issue_no_of_work_pages,

                COALESCE(DATE_FORMAT(MIN(t.shared_with_client_at), '%d-%b-%Y %H:%i'), 'N/A')  AS project_requested_at_client,
                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A')               AS project_request_accept_at_cm,
                COALESCE(DATE_FORMAT(MIN(t.start_date), '%d-%b-%Y %H:%i'), 'N/A')             AS project_start_date,
                COALESCE(DATE_FORMAT(MAX(t.end_date), '%d-%b-%Y %H:%i'), 'N/A')               AS project_end_date,
                COALESCE(DATE_FORMAT(MAX(t.deadline), '%d-%b-%Y %H:%i'), 'N/A')               AS project_deadline,

                COALESCE(
                    CASE
                        WHEN COUNT(DISTINCT t.id) = 0 THEN 'N/A'
                        WHEN SUM(CASE WHEN t.review = 'approved' THEN 1 ELSE 0 END) = COUNT(DISTINCT t.id) THEN 'approved'
                        WHEN SUM(CASE WHEN t.review = 'change_request' THEN 1 ELSE 0 END) > 0 THEN 'change_request'
                        ELSE 'pending'
                    END,
                'N/A')                                                       AS project_review,

                COALESCE(
                    CASE
                        WHEN COUNT(DISTINCT t.id) = 0 THEN 'N/A'
                        WHEN SUM(CASE WHEN t.review_stage = 'final_approved' THEN 1 ELSE 0 END) = COUNT(DISTINCT t.id) THEN 'final_approved'
                        WHEN SUM(CASE WHEN t.review_stage = 'pm_review' THEN 1 ELSE 0 END) > 0 THEN 'pm_review'
                        WHEN SUM(CASE WHEN t.review_stage = 'manager_review' THEN 1 ELSE 0 END) > 0 THEN 'manager_review'
                        WHEN SUM(CASE WHEN t.review_stage = 'change_requested' THEN 1 ELSE 0 END) > 0 THEN 'change_requested'
                        ELSE 'not_started'
                    END,
                'N/A')                                                       AS project_stage,

                COALESCE(NULLIF(TRIM(wr.status), ''), 'N/A')                AS project_request_status,
                COALESCE(DATE_FORMAT(wr.created_at, '%d-%b-%Y %H:%i'), 'N/A')  AS project_request_created_at,
                COALESCE(DATE_FORMAT(wr.updated_at, '%d-%b-%Y %H:%i'), 'N/A')  AS project_updated_at,

                COALESCE(NULLIF(TRIM(wr.remarks), ''), 'N/A')               AS project_digi_comments,
                COALESCE(NULLIF(TRIM(wr.description), ''), 'N/A')           AS work_request_description,
                COALESCE(NULLIF(TRIM(wr.about_project), ''), 'N/A')         AS about_project,

                DATE_FORMAT(wr.created_at, '%M')                             AS month,
                CASE
                    WHEN MONTH(wr.created_at) >= 4
                        THEN CONCAT('FY ', YEAR(wr.created_at), '-', RIGHT(YEAR(wr.created_at) + 1, 2))
                    ELSE
                        CONCAT('FY ', YEAR(wr.created_at) - 1, '-', RIGHT(YEAR(wr.created_at), 2))
                END                                                          AS fy

            FROM work_requests wr
            LEFT JOIN request_type rt          ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt          ON pt.id = wr.project_id
            LEFT JOIN users ru                 ON ru.id = wr.user_id
            LEFT JOIN department dept          ON dept.id = ru.department_id
            LEFT JOIN designation desig        ON desig.id = ru.designation_id
            LEFT JOIN location loc             ON loc.id = ru.location_id
            LEFT JOIN tasks t                  ON t.work_request_id = wr.id
            LEFT JOIN issue_assignments ia     ON ia.task_id = t.id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            GROUP BY
                wr.id,
                wr.project_name,
                wr.brand,
                rt.request_type,
                rt.description,
                ru.name,
                ru.email,
                ru.phone,
                dept.department_name,
                desig.designation_name,
                loc.location_name,
                pt.project_type,
                pt.description,
                wr.priority,
                wr.requested_at,
                wr.status,
                wr.created_at,
                wr.updated_at,
                wr.remarks,
                wr.description,
                wr.about_project
            ORDER BY wr.created_at DESC
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

const getTaskDetailsData = async (req, res) => {
    try {
        const { taskStatus } = req.query;

        const replacements = {};
        const whereClauses = [];

        if (taskStatus) {
            whereClauses.push('t.status = :taskStatus');
            replacements.taskStatus = taskStatus;
        }

        let query = `
            SELECT
                wr.id AS work_request_id,
                COALESCE(wr.project_name, 'N/A') AS project_name,
                COALESCE(GROUP_CONCAT(DISTINCT pt.project_type SEPARATOR ', '), 'N/A') AS project_type,
                COALESCE(rt.request_type, 'N/A') AS request_type,
                COALESCE(GROUP_CONCAT(DISTINCT rdiv.title SEPARATOR ', '), 'N/A') AS requester_division,
                COALESCE(ru.name, 'N/A') AS requester_name,
                COALESCE(tdiv.title, 'N/A') AS user_division,
                COALESCE(GROUP_CONCAT(DISTINCT mu.name ORDER BY mu.name SEPARATOR ', '), 'N/A') AS manager_name,
                t.id AS task_id,
                t.task_name,
                tt.task_type,
                COALESCE(GROUP_CONCAT(DISTINCT au.name SEPARATOR ', '), 'N/A') AS creative_user,
                COUNT(DISTINCT ta.id) AS task_count,
                t.task_count AS no_of_work_pages,
                COALESCE(DATE_FORMAT(wr.requested_at, '%Y-%m-%d'), 'N/A') AS request_date,
                COALESCE(wr.priority, 'N/A') AS scale,
                COALESCE(DATE_FORMAT(t.start_date, '%Y-%m-%d'), 'N/A') AS task_start_date,
                COALESCE(DATE_FORMAT(t.end_date, '%Y-%m-%d'), 'N/A') AS task_end_date,
                CASE
                    WHEN t.start_date IS NULL AND t.end_date IS NULL THEN 'upcoming'
                    WHEN t.start_date IS NOT NULL AND t.end_date IS NOT NULL THEN 'completed'
                    ELSE 'ongoing'
                END AS task_status
            FROM tasks t
            LEFT JOIN work_requests wr ON t.work_request_id = wr.id
            LEFT JOIN request_type rt ON wr.request_type_id = rt.id
            LEFT JOIN task_type tt ON t.task_type_id = tt.id
            LEFT JOIN task_project_reference tpr ON tt.id = tpr.task_id
            LEFT JOIN project_type pt ON tpr.project_id = pt.id
            LEFT JOIN project_request_reference prr ON pt.id = prr.project_id
            LEFT JOIN request_type rt2 ON prr.request_id = rt2.id
            LEFT JOIN request_division_reference rdr2 ON rt2.id = rdr2.request_id
            LEFT JOIN division tdiv ON rdr2.division_id = tdiv.id
            LEFT JOIN users ru ON wr.user_id = ru.id
            LEFT JOIN user_divisions rud ON ru.id = rud.user_id
            LEFT JOIN division rdiv ON rud.division_id = rdiv.id
            LEFT JOIN work_request_managers wrm ON wr.id = wrm.work_request_id
            LEFT JOIN users mu ON wrm.manager_id = mu.id
            LEFT JOIN task_assignments ta ON t.id = ta.task_id
            LEFT JOIN users au ON ta.user_id = au.id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` GROUP BY wr.id, wr.project_name, rt.request_type, ru.name, t.id, t.task_name, tt.task_type, t.task_count, t.start_date, t.end_date, wr.requested_at, wr.priority ORDER BY t.id DESC`;

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ data: results });

    } catch (error) {
        console.error('Error fetching task details data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getIssueDetailsData = async (req, res) => {
    try {
        const { issueStatus } = req.query;

        const replacements = {};
        const whereClauses = [];

        if (issueStatus) {
            whereClauses.push('ia.status = :issueStatus');
            replacements.issueStatus = issueStatus;
        }

        let query = `
            SELECT
                wr.id AS work_request_id,
                COALESCE(wr.project_name, 'N/A') AS project_name,
                COALESCE(GROUP_CONCAT(DISTINCT pt.project_type SEPARATOR ', '), 'N/A') AS project_type,
                COALESCE(rt.request_type, 'N/A') AS request_type,
                COALESCE(GROUP_CONCAT(DISTINCT rdiv.title SEPARATOR ', '), 'N/A') AS requester_division,
                COALESCE(ru.name, 'N/A') AS requester_name,
                COALESCE(tdiv.title, 'N/A') AS user_division,
                COALESCE(GROUP_CONCAT(DISTINCT mu.name ORDER BY mu.name SEPARATOR ', '), 'N/A') AS manager_name,
                ia.id AS issue_id,
                t.id AS task_id,
                t.task_name,
                tt.task_type,
                ia.description,
                ia.version,
                ia.task_count AS no_of_work_pages,
                COALESCE(DATE_FORMAT(wr.requested_at, '%Y-%m-%d'), 'N/A') AS request_date,
                COALESCE(wr.priority, 'N/A') AS scale,
                COALESCE(DATE_FORMAT(ia.start_date, '%Y-%m-%d'), 'N/A') AS issue_start_date,
                COALESCE(DATE_FORMAT(ia.end_date, '%Y-%m-%d'), 'N/A') AS issue_end_date,
                CASE
                    WHEN ia.start_date IS NULL AND ia.end_date IS NULL THEN 'upcoming'
                    WHEN ia.start_date IS NOT NULL AND ia.end_date IS NOT NULL THEN 'completed'
                    ELSE 'ongoing'
                END AS issue_status,
                ia.assignment_type,
                COALESCE(GROUP_CONCAT(DISTINCT au.name SEPARATOR ', '), 'N/A') AS assigned_user
            FROM issue_assignments ia
            LEFT JOIN tasks t ON ia.task_id = t.id
            LEFT JOIN work_requests wr ON t.work_request_id = wr.id
            LEFT JOIN request_type rt ON wr.request_type_id = rt.id
            LEFT JOIN task_type tt ON t.task_type_id = tt.id
            LEFT JOIN task_project_reference tpr ON tt.id = tpr.task_id
            LEFT JOIN project_type pt ON tpr.project_id = pt.id
            LEFT JOIN project_request_reference prr ON pt.id = prr.project_id
            LEFT JOIN request_type rt2 ON prr.request_id = rt2.id
            LEFT JOIN request_division_reference rdr2 ON rt2.id = rdr2.request_id
            LEFT JOIN division tdiv ON rdr2.division_id = tdiv.id
            LEFT JOIN users ru ON wr.user_id = ru.id
            LEFT JOIN user_divisions rud ON ru.id = rud.user_id
            LEFT JOIN division rdiv ON rud.division_id = rdiv.id
            LEFT JOIN work_request_managers wrm ON wr.id = wrm.work_request_id
            LEFT JOIN users mu ON wrm.manager_id = mu.id
            LEFT JOIN issue_user_assignments iua ON ia.id = iua.issue_assignment_id
            LEFT JOIN users au ON iua.user_id = au.id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` GROUP BY wr.id, wr.project_name, rt.request_type, ru.name, ia.id, ia.description, ia.version, ia.task_count, ia.start_date, ia.end_date, ia.assignment_type, t.id, t.task_name, tt.task_type, wr.requested_at, wr.priority ORDER BY ia.id DESC`;

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ data: results });

    } catch (error) {
        console.error('Error fetching issue details data:', error);
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

const getWorkRequestTasksData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const replacements = {};
        const whereClauses = ['wr.id IN (SELECT work_request_id FROM work_request_managers)'];

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
                wr.user_id AS work_request_user_id,
                wr.project_name,
                wr.brand,
                wr.request_type_id AS work_request_type_id,
                wr.project_id AS work_request_project_id,
                wr.description AS work_request_description,
                wr.about_project,
                wr.priority,
                wr.status AS work_request_status,
                wr.requested_at,
                wr.remarks,
                wr.created_at AS work_request_created_at,
                wr.updated_at AS work_request_updated_at,
                
                rt.id AS request_type_id,
                rt.request_type AS request_type_name,
                rt.description AS request_type_description,
                
                pt.id AS project_type_id,
                pt.project_type AS project_type_name,
                pt.description AS project_type_description,
                
                creator.id AS request_creator_id,
                creator.name AS request_creator_name,
                creator.email AS request_creator_email,
                creator.phone AS request_creator_phone,
                creator_dept.department_name AS request_creator_department,
                creator_desig.designation_name AS request_creator_designation,
                creator_job.role_title AS request_creator_job_role,
                creator_loc.location_name AS request_creator_location,
                
                (SELECT GROUP_CONCAT(u.name SEPARATOR ', ')
                 FROM work_request_managers wrm
                 JOIN users u ON u.id = wrm.manager_id
                 WHERE wrm.work_request_id = wr.id) AS manager_names,
                
                (SELECT GROUP_CONCAT(wrm.manager_id SEPARATOR ', ')
                 FROM work_request_managers wrm
                 WHERE wrm.work_request_id = wr.id) AS manager_ids,
                
                t.id AS task_id,
                t.task_name,
                t.description AS task_description,
                t.request_type_id AS task_request_type_id,
                t.task_type_id,
                t.work_request_id AS task_work_request_id,
                t.deadline AS task_deadline,
                t.status AS task_status,
                t.version AS task_version,
                t.review AS task_review,
                t.review_stage AS task_review_stage,
                t.assignment_type AS task_assignment_type,
                t.intimate_team AS task_intimate_team,
                t.intimate_client AS task_intimate_client,
                t.shared_with_client_at AS task_shared_with_client_at,
                t.task_count AS task_count,
                t.link AS task_link,
                t.start_date AS task_start_date,
                t.end_date AS task_end_date,
                t.no_of_options_provided AS task_no_of_options_provided,
                t.no_of_words_written AS task_no_of_words_written,
                t.options_submitted AS task_options_submitted,
                t.concept_work AS task_concept_work,
                t.resize_work AS task_resize_work,
                t.no_of_concepts AS task_no_of_concepts,
                t.duration_minutes AS task_duration_minutes,
                t.duration_seconds AS task_duration_seconds,
                t.product_shoot AS task_product_shoot,
                t.no_of_products_shot AS task_no_of_products_shot,
                t.shoot_setup AS task_shoot_setup,
                t.no_of_resize AS task_no_of_resize,
                t.responsive_screen AS task_responsive_screen,
                t.no_of_responsive_screen AS task_no_of_responsive_screen,
                t.created_at AS task_created_at,
                t.updated_at AS task_updated_at,
                t.comments AS task_comments,
                
                tt.id AS task_type_id,
                tt.task_type AS task_type_name,
                tt.description AS task_type_description,
                
                task_rt.id AS task_request_type_id,
                task_rt.request_type AS task_request_type_name,
                
                ta.id AS task_assignment_id,
                ta.user_id AS assigned_user_id,
                assignee.name AS assigned_user_name,
                assignee.email AS assigned_user_email,
                assignee.phone AS assigned_user_phone,
                assignee_dept.department_name AS assigned_user_department,
                assignee_desig.designation_name AS assigned_user_designation,
                assignee_job.role_title AS assigned_user_job_role,
                assignee_loc.location_name AS assigned_user_location,
                
                ia.id AS issue_id,
                ia.issue_id AS issue_parent_id,
                ia.task_id AS issue_task_id,
                ia.requested_by_user_id AS issue_requested_by_user_id,
                ia.assignment_type AS issue_assignment_type,
                ia.version AS issue_version,
                ia.description AS issue_description,
                ia.deadline AS issue_deadline,
                ia.intimate_team AS issue_intimate_team,
                ia.intimate_client AS issue_intimate_client,
                ia.shared_with_client_at AS issue_shared_with_client_at,
                ia.task_count AS issue_task_count,
                ia.start_date AS issue_start_date,
                ia.end_date AS issue_end_date,
                ia.link AS issue_link,
                CASE
                    WHEN ia.id IS NULL THEN NULL
                    WHEN ia.start_date IS NULL AND ia.end_date IS NULL THEN 'upcoming'
                    WHEN ia.start_date IS NOT NULL AND ia.end_date IS NOT NULL THEN 'completed'
                    ELSE 'ongoing'
                END AS issue_status,
                ia.review AS issue_review,
                ia.review_stage AS issue_review_stage,
                ia.no_of_options_provided AS issue_no_of_options_provided,
                ia.no_of_words_written AS issue_no_of_words_written,
                ia.options_submitted AS issue_options_submitted,
                ia.concept_work AS issue_concept_work,
                ia.resize_work AS issue_resize_work,
                ia.no_of_concepts AS issue_no_of_concepts,
                ia.duration_minutes AS issue_duration_minutes,
                ia.duration_seconds AS issue_duration_seconds,
                ia.product_shoot AS issue_product_shoot,
                ia.no_of_products_shot AS issue_no_of_products_shot,
                ia.shoot_setup AS issue_shoot_setup,
                ia.no_of_resize AS issue_no_of_resize,
                ia.responsive_screen AS issue_responsive_screen,
                ia.no_of_responsive_screen AS issue_no_of_responsive_screen,
                ia.created_at AS issue_created_at,
                ia.updated_at AS issue_updated_at,
                ia.comments AS issue_comments,
                
                issue_requester.id AS issue_requester_id,
                issue_requester.name AS issue_requester_name,
                issue_requester.email AS issue_requester_email,
                issue_requester.phone AS issue_requester_phone,
                issue_requester_dept.department_name AS issue_requester_department,
                issue_requester_desig.designation_name AS issue_requester_designation,
                issue_requester_job.role_title AS issue_requester_job_role,
                issue_requester_loc.location_name AS issue_requester_location,
                
                (SELECT GROUP_CONCAT(ir.change_issue_type SEPARATOR ', ')
                 FROM issue_assignment_types iat
                 JOIN issue_register ir ON ir.id = iat.issue_register_id
                 WHERE iat.issue_assignment_id = ia.id) AS issue_types,
                
                (SELECT GROUP_CONCAT(ir.id SEPARATOR ', ')
                 FROM issue_assignment_types iat
                 JOIN issue_register ir ON ir.id = iat.issue_register_id
                 WHERE iat.issue_assignment_id = ia.id) AS issue_register_ids,
                
                (SELECT GROUP_CONCAT(CONCAT(ir.change_issue_type, ' - ', ir.description) SEPARATOR ' | ')
                 FROM issue_assignment_types iat
                 JOIN issue_register ir ON ir.id = iat.issue_register_id
                 WHERE iat.issue_assignment_id = ia.id) AS issue_types_with_description

            FROM work_requests wr
            LEFT JOIN request_type rt ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt ON pt.id = wr.project_id
            LEFT JOIN users creator ON creator.id = wr.user_id
            LEFT JOIN department creator_dept ON creator_dept.id = creator.department_id
            LEFT JOIN designation creator_desig ON creator_desig.id = creator.designation_id
            LEFT JOIN job_role creator_job ON creator_job.id = creator.job_role_id
            LEFT JOIN location creator_loc ON creator_loc.id = creator.location_id
            LEFT JOIN tasks t ON t.work_request_id = wr.id
            LEFT JOIN task_type tt ON tt.id = t.task_type_id
            LEFT JOIN request_type task_rt ON task_rt.id = t.request_type_id
            LEFT JOIN task_assignments ta ON ta.task_id = t.id
            LEFT JOIN users assignee ON assignee.id = ta.user_id
            LEFT JOIN department assignee_dept ON assignee_dept.id = assignee.department_id
            LEFT JOIN designation assignee_desig ON assignee_desig.id = assignee.designation_id
            LEFT JOIN job_role assignee_job ON assignee_job.id = assignee.job_role_id
            LEFT JOIN location assignee_loc ON assignee_loc.id = assignee.location_id
            LEFT JOIN issue_assignments ia ON ia.task_id = t.id
            LEFT JOIN users issue_requester ON issue_requester.id = ia.requested_by_user_id
            LEFT JOIN department issue_requester_dept ON issue_requester_dept.id = issue_requester.department_id
            LEFT JOIN designation issue_requester_desig ON issue_requester_desig.id = issue_requester.designation_id
            LEFT JOIN job_role issue_requester_job ON issue_requester_job.id = issue_requester.job_role_id
            LEFT JOIN location issue_requester_loc ON issue_requester_loc.id = issue_requester.location_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` ORDER BY wr.id DESC, t.id ASC, ta.id ASC, ia.id ASC`;

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ data: results });

    } catch (error) {
        console.error('Error fetching work request tasks data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getAdminData,
    getTaskDetailsData,
    getIssueDetailsData,
    getTasksForWorkRequest,
    getWorkRequestTasksData
};
