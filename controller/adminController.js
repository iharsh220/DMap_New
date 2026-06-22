const { sequelize } = require('../config/databaseConfig');

const getClientUsersByDivision = async (userId) => {
    return sequelize.query(
        `SELECT DISTINCT u.id, u.name, u.email, u.phone
         FROM users u
         JOIN user_divisions ud ON ud.user_id = u.id
         WHERE ud.division_id IN (SELECT division_id FROM user_divisions WHERE user_id = :userId)
           AND u.account_status = 'active'
         ORDER BY u.name ASC`,
        { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
    );
};

const getClientDeleteQueries = async (req, res, transaction) => {
    const { id } = req.params;
    const taskIds = await sequelize.query(
        `SELECT id FROM tasks WHERE work_request_id = :id`,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction }
    );
    if (taskIds.length) {
        const ids = taskIds.map(r => r.id);
        await sequelize.query(`DELETE iat FROM issue_assignment_types iat INNER JOIN issue_assignments ia ON iat.issue_assignment_id = ia.id WHERE ia.task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE iua FROM issue_user_assignments iua INNER JOIN issue_assignments ia ON iua.issue_assignment_id = ia.id WHERE ia.task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM issue_assignments WHERE task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM task_assignments WHERE task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM task_review_history WHERE task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE td FROM task_documents td INNER JOIN task_assignments ta ON td.task_assignment_id = ta.id WHERE ta.task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM task_dependencies WHERE task_id IN (:ids) OR dependency_task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM task_project_reference WHERE task_id IN (:ids)`, { replacements: { ids }, transaction });
        await sequelize.query(`DELETE FROM tasks WHERE work_request_id = :id`, { replacements: { id }, transaction });
    }
    await sequelize.query(`DELETE FROM work_request_managers WHERE work_request_id = :id`, { replacements: { id }, transaction });
    await sequelize.query(`DELETE FROM work_request_documents WHERE work_request_id = :id`, { replacements: { id }, transaction });
    await sequelize.query(`DELETE FROM project_request_reference WHERE work_request_id = :id`, { replacements: { id }, transaction });
    await sequelize.query(`DELETE FROM request_division_reference WHERE work_request_id = :id`, { replacements: { id }, transaction });
    await sequelize.query(`DELETE FROM work_requests WHERE id = :id`, { replacements: { id }, transaction });
};

const getEditData = async (req, res) => {
    try {
        const { type, id } = req.params;
        let record = {};

        if (type === 'project') {
            const [row] = await sequelize.query(
                `SELECT id, project_name, brand, priority, status, remarks, description, about_project, requested_at FROM work_requests WHERE id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            record = row;
        } else if (type === 'client') {
            const [row] = await sequelize.query(
                `SELECT wr.id, wr.user_id, wr.project_name, wr.brand, wr.priority, wr.status, wr.remarks,
                        wr.description, wr.about_project, wr.requested_at,
                        ru.name AS client_name, ru.email AS client_email,
                        COALESCE(
                            NULLIF(
                                (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                                 FROM user_divisions ud
                                 JOIN division d ON d.id = ud.division_id
                                 WHERE ud.user_id = wr.user_id),
                            ''),
                        'N/A') AS client_division
                 FROM work_requests wr
                 LEFT JOIN users ru ON ru.id = wr.user_id
                 WHERE wr.id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            if (row) {
                const clientUsers = await getClientUsersByDivision(row.user_id);
                res.json({ record: row, clientUsers });
                return;
            }
            record = row;
        } else if (type === 'task') {
            const [row] = await sequelize.query(
                `SELECT t.id, t.task_name, t.status, t.review, t.review_stage, t.deadline, t.start_date, t.end_date,
                    t.comments, t.description, t.assignment_type, t.version, t.task_count,
                    t.no_of_options_provided, t.concept_work, t.no_of_concepts, t.resize_work, t.no_of_resize,
                    t.no_of_images_videos_audio, t.duration_minutes, t.duration_seconds,
                    t.no_of_products_shot, t.shoot_setup, t.no_of_words_written, t.no_of_responsive_screen,
                    t.link, t.intimate_team, t.intimate_client
                 FROM tasks t WHERE t.id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            record = row;
        } else if (type === 'issue') {
            const [row] = await sequelize.query(
                `SELECT ia.id, ia.status, ia.review, ia.review_stage, ia.deadline, ia.start_date, ia.end_date,
                    ia.comments, ia.description, ia.assignment_type, ia.version, ia.task_count,
                    ia.no_of_options_provided, ia.concept_work, ia.no_of_concepts, ia.resize_work, ia.no_of_resize,
                    ia.no_of_images_videos_audio, ia.duration_minutes, ia.duration_seconds,
                    ia.no_of_products_shot, ia.shoot_setup, ia.no_of_words_written, ia.responsive_screen,
                    ia.link, ia.intimate_team, ia.intimate_client
                 FROM issue_assignments ia WHERE ia.id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            record = row;
        }

        res.json({ record });
    } catch (error) {
        console.error('Error fetching edit data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateProject = async (req, res) => {
    try {
        const { id } = req.params;
        const { project_name, brand, priority, status, remarks, description } = req.body;
        await sequelize.query(
            `UPDATE work_requests SET project_name=:project_name, brand=:brand, priority=:priority, status=:status, remarks=:remarks, description=:description, updated_at=NOW() WHERE id=:id`,
            { replacements: { id, project_name, brand, priority, status, remarks, description }, type: sequelize.QueryTypes.UPDATE }
        );
        res.json({ success: true, message: 'Project updated successfully' });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateClient = async (req, res) => {
    try {
        const { id } = req.params;
        const { user_id } = req.body;
        const userId = Number.parseInt(user_id, 10);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid client user' });
        }

        const [workRequest] = await sequelize.query(
            `SELECT wr.id, wr.user_id AS current_user_id,
                    (SELECT GROUP_CONCAT(division_id) FROM user_divisions WHERE user_id = wr.user_id) AS division_ids
             FROM work_requests wr
             WHERE wr.id = :id`,
            { replacements: { id }, type: sequelize.QueryTypes.SELECT }
        );

        if (!workRequest) {
            return res.status(404).json({ success: false, error: 'Client request not found' });
        }

        if (!workRequest.division_ids) {
            return res.status(400).json({ success: false, error: 'Current client has no division mapping' });
        }

        const [match] = await sequelize.query(
            `SELECT COUNT(*) AS match_count
             FROM user_divisions ud
             WHERE ud.user_id = :user_id AND FIND_IN_SET(ud.division_id, :division_ids) > 0`,
            {
                replacements: { user_id: userId, division_ids: workRequest.division_ids },
                type: sequelize.QueryTypes.SELECT
            }
        );

        if (!match.match_count) {
            return res.status(400).json({ success: false, error: 'Selected user does not belong to this client division' });
        }

        await sequelize.query(
            `UPDATE work_requests SET user_id=:user_id, updated_at=NOW() WHERE id=:id`,
            { replacements: { id, user_id: userId }, type: sequelize.QueryTypes.UPDATE }
        );
        res.json({ success: true, message: 'Client updated successfully' });
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { task_name, status, review, review_stage, deadline, start_date, end_date, comments, description,
            assignment_type, version, task_count, no_of_options_provided, concept_work, no_of_concepts,
            resize_work, no_of_resize, no_of_images_videos_audio, duration_minutes, duration_seconds,
            no_of_products_shot, shoot_setup, no_of_words_written, no_of_responsive_screen, link,
            intimate_team, intimate_client } = req.body;
        await sequelize.query(
            `UPDATE tasks SET task_name=:task_name, status=:status, review=:review, review_stage=:review_stage,
                deadline=:deadline, start_date=:start_date, end_date=:end_date, comments=:comments, description=:description,
                assignment_type=:assignment_type, version=:version, task_count=:task_count,
                no_of_options_provided=:no_of_options_provided, concept_work=:concept_work, no_of_concepts=:no_of_concepts,
                resize_work=:resize_work, no_of_resize=:no_of_resize, no_of_images_videos_audio=:no_of_images_videos_audio,
                duration_minutes=:duration_minutes, duration_seconds=:duration_seconds,
                no_of_products_shot=:no_of_products_shot, shoot_setup=:shoot_setup,
                no_of_words_written=:no_of_words_written, no_of_responsive_screen=:no_of_responsive_screen,
                link=:link, intimate_team=:intimate_team, intimate_client=:intimate_client, updated_at=NOW()
             WHERE id=:id`,
            {
                replacements: {
                    id, task_name, status, review, review_stage,
                    deadline: deadline || null, start_date: start_date || null, end_date: end_date || null,
                    comments, description, assignment_type, version, task_count: task_count || 0,
                    no_of_options_provided: no_of_options_provided || 0, concept_work: concept_work || 0,
                    no_of_concepts: no_of_concepts || 0, resize_work: resize_work || 0, no_of_resize: no_of_resize || 0,
                    no_of_images_videos_audio: no_of_images_videos_audio || 0,
                    duration_minutes: duration_minutes || 0, duration_seconds: duration_seconds || 0,
                    no_of_products_shot: no_of_products_shot || 0, shoot_setup: shoot_setup || 0,
                    no_of_words_written: no_of_words_written || 0, no_of_responsive_screen: no_of_responsive_screen || 0,
                    link: link || null, intimate_team: intimate_team || 0, intimate_client: intimate_client || 0
                }, type: sequelize.QueryTypes.UPDATE
            }
        );
        res.json({ success: true, message: 'Task updated successfully' });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateIssue = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, review, review_stage, deadline, start_date, end_date, comments, description,
            assignment_type, version, task_count, no_of_options_provided, concept_work, no_of_concepts,
            resize_work, no_of_resize, no_of_images_videos_audio, duration_minutes, duration_seconds,
            no_of_products_shot, shoot_setup, no_of_words_written, responsive_screen, link,
            intimate_team, intimate_client } = req.body;
        await sequelize.query(
            `UPDATE issue_assignments SET status=:status, review=:review, review_stage=:review_stage,
                deadline=:deadline, start_date=:start_date, end_date=:end_date, comments=:comments, description=:description,
                assignment_type=:assignment_type, version=:version, task_count=:task_count,
                no_of_options_provided=:no_of_options_provided, concept_work=:concept_work, no_of_concepts=:no_of_concepts,
                resize_work=:resize_work, no_of_resize=:no_of_resize, no_of_images_videos_audio=:no_of_images_videos_audio,
                duration_minutes=:duration_minutes, duration_seconds=:duration_seconds,
                no_of_products_shot=:no_of_products_shot, shoot_setup=:shoot_setup,
                no_of_words_written=:no_of_words_written, responsive_screen=:responsive_screen,
                link=:link, intimate_team=:intimate_team, intimate_client=:intimate_client, updated_at=NOW()
             WHERE id=:id`,
            {
                replacements: {
                    id, status, review, review_stage,
                    deadline: deadline || null, start_date: start_date || null, end_date: end_date || null,
                    comments, description, assignment_type, version, task_count: task_count || 0,
                    no_of_options_provided: no_of_options_provided || 0, concept_work: concept_work || 0,
                    no_of_concepts: no_of_concepts || 0, resize_work: resize_work || 0, no_of_resize: no_of_resize || 0,
                    no_of_images_videos_audio: no_of_images_videos_audio || 0,
                    duration_minutes: duration_minutes || 0, duration_seconds: duration_seconds || 0,
                    no_of_products_shot: no_of_products_shot || 0, shoot_setup: shoot_setup || 0,
                    no_of_words_written: no_of_words_written || 0, responsive_screen: responsive_screen || 0,
                    link: link || null, intimate_team: intimate_team || 0, intimate_client: intimate_client || 0
                }, type: sequelize.QueryTypes.UPDATE
            }
        );
        res.json({ success: true, message: 'Issue updated successfully' });
    } catch (error) {
        console.error('Error updating issue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getDeletePreview = async (req, res) => {
    try {
        const { type, id } = req.params;
        let preview = {};

        if (type === 'project') {
            const [wr] = await sequelize.query(
                `SELECT wr.id, wr.project_name, wr.brand, wr.status,
                    COUNT(DISTINCT t.id) AS task_count,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM work_requests wr
                 LEFT JOIN tasks t ON t.work_request_id = wr.id
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE wr.id = :id GROUP BY wr.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            const tasks = await sequelize.query(
                `SELECT t.id, t.task_name, t.status,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM tasks t
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE t.work_request_id = :id GROUP BY t.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: wr, tasks };
        } else if (type === 'client') {
            const [wr] = await sequelize.query(
                `SELECT wr.id, wr.project_name, wr.brand, wr.status,
                        ru.name AS client_name, ru.email AS client_email,
                        COALESCE(
                            NULLIF(
                                (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                                 FROM user_divisions ud
                                 JOIN division d ON d.id = ud.division_id
                                 WHERE ud.user_id = wr.user_id),
                            ''),
                        'N/A') AS client_division,
                        COUNT(DISTINCT t.id) AS task_count,
                        COUNT(DISTINCT ia.id) AS issue_count
                 FROM work_requests wr
                 LEFT JOIN users ru ON ru.id = wr.user_id
                 LEFT JOIN tasks t ON t.work_request_id = wr.id
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE wr.id = :id GROUP BY wr.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            const tasks = await sequelize.query(
                `SELECT t.id, t.task_name, t.status,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM tasks t
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE t.work_request_id = :id GROUP BY t.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: wr, tasks };
        } else if (type === 'task') {
            const [task] = await sequelize.query(
                `SELECT t.id, t.task_name, t.status,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM tasks t
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE t.id = :id GROUP BY t.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            const issues = await sequelize.query(
                `SELECT ia.id, ia.version, ia.status, ia.assignment_type
                 FROM issue_assignments ia WHERE ia.task_id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: task, issues };
        } else if (type === 'issue') {
            const [issue] = await sequelize.query(
                `SELECT ia.id, ia.version, ia.status, ia.assignment_type,
                    t.task_name, wr.project_name
                 FROM issue_assignments ia
                 LEFT JOIN tasks t ON t.id = ia.task_id
                 LEFT JOIN work_requests wr ON wr.id = t.work_request_id
                 WHERE ia.id = :id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: issue };
        }

        res.json({ preview });
    } catch (error) {
        console.error('Error fetching delete preview:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteProject = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        await getClientDeleteQueries(req, res, t);
        await t.commit();
        res.json({ success: true, message: 'Project and all related data deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteClient = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        await getClientDeleteQueries(req, res, t);
        await t.commit();
        res.json({ success: true, message: 'Client request and all related data deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error deleting client request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteTask = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        await sequelize.query(`DELETE iat FROM issue_assignment_types iat INNER JOIN issue_assignments ia ON iat.issue_assignment_id = ia.id WHERE ia.task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE iua FROM issue_user_assignments iua INNER JOIN issue_assignments ia ON iua.issue_assignment_id = ia.id WHERE ia.task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM issue_assignments WHERE task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM task_assignments WHERE task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM task_review_history WHERE task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE td FROM task_documents td INNER JOIN task_assignments ta ON td.task_assignment_id = ta.id WHERE ta.task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM task_dependencies WHERE task_id = :id OR dependency_task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM task_project_reference WHERE task_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM tasks WHERE id = :id`, { replacements: { id }, transaction: t });
        await t.commit();
        res.json({ success: true, message: 'Task and all related issues deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error deleting task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteIssue = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        await sequelize.query(`DELETE FROM issue_assignment_types WHERE issue_assignment_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM issue_user_assignments WHERE issue_assignment_id = :id`, { replacements: { id }, transaction: t });
        await sequelize.query(`DELETE FROM issue_assignments WHERE id = :id`, { replacements: { id }, transaction: t });
        await t.commit();
        res.json({ success: true, message: 'Issue deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error deleting issue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

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
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                         FROM user_divisions ud
                         JOIN division d ON d.id = ud.division_id
                         WHERE ud.user_id = ru.id),
                    ''),
                'N/A')                                                       AS client_division,
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
                COALESCE((SELECT SUM(COALESCE(t2.no_of_options_provided, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_options_provided,
                COALESCE((SELECT SUM(COALESCE(t2.concept_work, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_concept_work,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_resize, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_resize,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_images_videos_audio, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_ai_page,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_products_shot, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_products_shot,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_words_written, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_words_written,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_responsive_screen, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_no_of_responsive_screen,
                COALESCE((SELECT SUM(COALESCE(t2.resize_work, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_resize_work,
                COALESCE((SELECT SUM(COALESCE(t2.no_of_images_videos_audio, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_ai,
                COALESCE((SELECT SUM(COALESCE(t2.shoot_setup, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS task_shoot_setup,
                COALESCE((SELECT SUM(COALESCE(t2.duration_minutes, 0) * 60 + COALESCE(t2.duration_seconds, 0)) FROM tasks t2 WHERE t2.work_request_id = wr.id), 0) AS video_duration,

                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A')               AS project_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS project_request_accept_at_cm,
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

const getClientsData = async (req, res) => {
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
                COALESCE(NULLIF(TRIM(wr.project_name), ''), 'N/A') AS project_name,
                COALESCE(NULLIF(TRIM(rt.request_type), ''), 'N/A') AS request_type_name,
                COALESCE(NULLIF(TRIM(pt.project_type), ''), 'N/A') AS project_type_name,
                COALESCE(NULLIF(TRIM(wr.priority), ''), 'N/A') AS project_priority,
                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A') AS project_requester_name,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                         FROM user_divisions ud
                         JOIN division d ON d.id = ud.division_id
                         WHERE ud.user_id = ru.id),
                    ''),
                'N/A') AS client_division,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT mu2.name ORDER BY mu2.name SEPARATOR ', ')
                         FROM work_request_managers wrm2
                         JOIN users mu2 ON mu2.id = wrm2.manager_id
                         WHERE wrm2.work_request_id = wr.id),
                    ''),
                'N/A') AS digi_vertical_manager_name,
                1 AS project_count,
                COALESCE(NULLIF(TRIM(wr.status), ''), 'N/A') AS project_status,
                COALESCE(NULLIF(TRIM(wr.remarks), ''), 'N/A') AS description,
                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A') AS project_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS response_timestamp,
                COALESCE(DATE_FORMAT(wr.requested_at, '%M'), 'N/A') AS month,
                CASE
                    WHEN wr.created_at IS NOT NULL AND MONTH(wr.created_at) >= 4
                        THEN CONCAT('FY ', YEAR(wr.created_at), '-', RIGHT(YEAR(wr.created_at) + 1, 2))
                    WHEN wr.created_at IS NOT NULL
                        THEN CONCAT('FY ', YEAR(wr.created_at) - 1, '-', RIGHT(YEAR(wr.created_at), 2))
                    ELSE 'N/A'
                END AS financial_year,
                CASE
                    WHEN wr.requested_at IS NOT NULL
                     AND (SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id) IS NOT NULL
                    THEN CONCAT(
                        FLOOR(TIMESTAMPDIFF(MINUTE, wr.requested_at, (SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id)) / 60),
                        'h ',
                        MOD(TIMESTAMPDIFF(MINUTE, wr.requested_at, (SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id)), 60),
                        'm'
                    )
                    ELSE 'N/A'
                END AS request_to_response_tat
            FROM work_requests wr
            LEFT JOIN request_type rt ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt ON pt.id = wr.project_id
            LEFT JOIN users ru ON ru.id = wr.user_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += ` ORDER BY wr.requested_at DESC`;

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({ data: results });

    } catch (error) {
        console.error('Error fetching clients data:', error);
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
                wr.id                                                           AS work_request_id,
                t.id                                                            AS task_id,
                COALESCE(MIN(ia.id), NULL)                                      AS issue_id,
                COALESCE(NULLIF(TRIM(t.task_name), ''), 'N/A')                 AS task_name,
                COALESCE(NULLIF(TRIM(wr.brand), ''), 'N/A')                    AS brand,
                COALESCE(NULLIF(TRIM(rt.request_type), ''), 'N/A')             AS task_request_type_name,

                COALESCE(NULLIF(TRIM(tt.task_type), ''), 'N/A')                AS task_type_name,
                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A')                     AS task_requester_name,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                         FROM user_divisions ud
                         JOIN division d ON d.id = ud.division_id
                         WHERE ud.user_id = ru.id),
                    ''),
                'N/A')                                                          AS client_division,
                COALESCE(NULLIF(TRIM(t.assignment_type), ''), 'N/A')           AS task_assignment_type,

                COALESCE(
                     NULLIF(GROUP_CONCAT(DISTINCT au.name ORDER BY au.name SEPARATOR ', '), ''),
                 'N/A')                                                          AS task_assigned_user_name,

                 COALESCE(NULLIF(TRIM(d.title), ''), 'N/A')                     AS vertical_name,

                 COALESCE(NULLIF(TRIM(t.version), ''), 'N/A')                   AS task_version,

                 1                                                               AS project_count,
                1                                                               AS task_count,
                (SELECT COUNT(DISTINCT ia2.id) FROM issue_assignments ia2 WHERE ia2.task_id = t.id) AS issue_task_count,
                t.task_count                                                    AS task_no_of_work_pages,
                COALESCE(SUM(DISTINCT ia.task_count), 0)                       AS issue_no_of_work_pages,

                COALESCE(t.no_of_options_provided, 0)                          AS task_no_of_options_provided,
                t.concept_work                                                  AS task_concept_work,
                COALESCE(t.no_of_concepts, 0)                                  AS task_no_of_concepts,
                t.resize_work                                                   AS task_resize_work,
                COALESCE(t.no_of_resize, 0)                                    AS task_no_of_resize,
                COALESCE(t.no_of_images_videos_audio, 0)                       AS task_ai,
                COALESCE(t.no_of_images_videos_audio, 0)                       AS task_no_of_ai_page,
                COALESCE(t.duration_minutes, 0)                                AS task_duration_minutes,
                COALESCE(t.duration_seconds, 0)                                AS task_duration_seconds,
                COALESCE(t.duration_minutes, 0) * 60 + COALESCE(t.duration_seconds, 0) AS video_duration,
                COALESCE(t.no_of_products_shot, 0)                             AS task_no_of_products_shot,
                t.shoot_setup                                                   AS task_shoot_setup,
                COALESCE(t.no_of_words_written, 0)                             AS task_no_of_words_written,
                COALESCE(t.no_of_responsive_screen, 0)                         AS task_no_of_responsive_screen,

                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A')                        AS project_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS project_requested_accept_at_cm,

                COALESCE(DATE_FORMAT(MIN(ta.created_at), '%d-%b-%Y %H:%i'), 'N/A')                     AS task_requested_at_assign_intimate_cu,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS task_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(t.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A')                AS task_shared_with_cm_at,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS task_respond_on_output_cm,

                COALESCE(DATE_FORMAT(t.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A')                AS task_output_shared_with_client_at,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS task_output_client_responded_approved,

                COALESCE(DATE_FORMAT(t.start_date, '%d-%b-%Y %H:%i'), 'N/A')   AS task_start_date,
                COALESCE(DATE_FORMAT(t.end_date, '%d-%b-%Y %H:%i'), 'N/A')     AS task_end_date,
                COALESCE(DATE_FORMAT(t.deadline, '%d-%b-%Y %H:%i'), 'N/A')     AS task_deadline,

                COALESCE(NULLIF(TRIM(t.review), ''), 'N/A')                    AS task_review,
                COALESCE(NULLIF(TRIM(t.review_stage), ''), 'N/A')              AS task_review_stage,
                COALESCE(NULLIF(TRIM(t.status), ''), 'N/A')                    AS task_status,

                COALESCE(DATE_FORMAT(t.created_at, '%d-%b-%Y %H:%i'), 'N/A')   AS task_created_at,
                COALESCE(DATE_FORMAT(t.updated_at, '%d-%b-%Y %H:%i'), 'N/A')   AS task_updated_at,

                'N/A'                                                           AS na,

                COALESCE(NULLIF(TRIM(tt.description), ''), 'N/A')              AS task_type_description,
                COALESCE(NULLIF(TRIM(t.comments), ''), 'N/A')                  AS task_digi_comments,
                COALESCE(NULLIF(TRIM(t.description), ''), 'N/A')               AS task_requester_description,
                COALESCE(NULLIF(TRIM(wr.about_project), ''), 'N/A')            AS about_task,
                COALESCE(NULLIF(TRIM(dept.department_name), ''), 'N/A')        AS task_requester_department,

                DATE_FORMAT(t.created_at, '%M')                                AS month,
                CASE
                    WHEN MONTH(t.created_at) >= 4
                        THEN CONCAT('FY ', YEAR(t.created_at), '-', RIGHT(YEAR(t.created_at) + 1, 2))
                    ELSE
                        CONCAT('FY ', YEAR(t.created_at) - 1, '-', RIGHT(YEAR(t.created_at), 2))
                END                                                             AS fy

            FROM tasks t
            LEFT JOIN work_requests wr          ON wr.id = t.work_request_id
            LEFT JOIN request_type rt           ON rt.id = t.request_type_id
            LEFT JOIN task_type tt              ON tt.id = t.task_type_id
            LEFT JOIN users ru                  ON ru.id = wr.user_id
            LEFT JOIN department dept           ON dept.id = ru.department_id
            LEFT JOIN task_assignments ta       ON ta.task_id = t.id
             LEFT JOIN users au                  ON au.id = ta.user_id
             LEFT JOIN user_divisions ud         ON ud.user_id = au.id
             LEFT JOIN division d               ON d.id = ud.division_id
             LEFT JOIN issue_assignments ia      ON ia.task_id = t.id
         `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
             GROUP BY
                 wr.id, wr.brand, wr.requested_at, wr.about_project,
                 t.id, t.task_name, t.assignment_type, t.version, t.task_count,
                 t.no_of_options_provided, t.concept_work, t.no_of_concepts,
                 t.resize_work, t.no_of_resize, t.no_of_images_videos_audio,
                 t.duration_minutes, t.duration_seconds, t.no_of_products_shot,
                 t.shoot_setup, t.no_of_words_written, t.no_of_responsive_screen,
                 t.shared_with_client_at, t.start_date, t.end_date, t.deadline,
                 t.review, t.review_stage, t.status, t.created_at, t.updated_at,
                 t.comments, t.description,
                  rt.request_type,
                  tt.task_type, tt.description,
                  ru.id, ru.name,
                  dept.department_name,
                 d.title
             ORDER BY t.id DESC
        `;

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
                wr.id                                                           AS work_request_id,
                t.id                                                            AS task_id,
                ia.id                                                           AS issue_id,
                COALESCE(NULLIF(TRIM(t.task_name), ''), 'N/A')                 AS task_name,
                COALESCE(NULLIF(TRIM(wr.brand), ''), 'N/A')                    AS brand,
                COALESCE(NULLIF(TRIM(rt.request_type), ''), 'N/A')             AS issue_request_type_name,

                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT mu2.name ORDER BY mu2.name SEPARATOR ', ')
                         FROM work_request_managers wrm2
                         JOIN users mu2 ON mu2.id = wrm2.manager_id
                         WHERE wrm2.work_request_id = wr.id),
                    ''),
                'N/A')                                                          AS vertical_manger_name,

                COALESCE(NULLIF(TRIM(tt.task_type), ''), 'N/A')                AS task_type_name,
                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A')                     AS issue_requester_name,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                         FROM user_divisions ud
                         JOIN division d ON d.id = ud.division_id
                         WHERE ud.user_id = wr.user_id),
                    ''),
                'N/A')                                                          AS client_division,
                COALESCE(NULLIF(TRIM(ia.assignment_type), ''), 'N/A')          AS issue_assignment_type,

                COALESCE(
                    NULLIF(GROUP_CONCAT(DISTINCT au.name ORDER BY au.name SEPARATOR ', '), ''),
                'N/A')                                                          AS assigned_user_name,

                COALESCE(NULLIF(TRIM(d.title), ''), 'N/A')                     AS vertical_name,

                COALESCE(NULLIF(TRIM(ia.version), ''), 'N/A')                  AS issue_version,

                1                                                               AS project_count,
                1                                                               AS task_count,
                1                                                               AS issue_task_count,
                t.task_count                                                    AS task_no_of_work_pages,
                COALESCE(ia.task_count, 0)                                      AS issue_no_of_work_pages,

                COALESCE(ia.no_of_options_provided, 0)                         AS issue_no_of_options_provided,
                ia.concept_work                                                 AS issue_concept_work,
                COALESCE(ia.no_of_concepts, 0)                                 AS issue_no_of_concepts,
                ia.resize_work                                                  AS issue_resize_work,
                COALESCE(ia.no_of_resize, 0)                                   AS issue_no_of_resize,
                COALESCE(ia.no_of_images_videos_audio, 0)                      AS issue_ai,
                COALESCE(ia.no_of_images_videos_audio, 0)                      AS issue_no_of_ai_page,
                COALESCE(ia.duration_minutes, 0)                               AS issue_duration_minutes,
                COALESCE(ia.duration_seconds, 0)                               AS issue_duration_seconds,
                COALESCE(ia.duration_minutes, 0) * 60 + COALESCE(ia.duration_seconds, 0) AS issue_video_duration,
                COALESCE(ia.no_of_products_shot, 0)                            AS issue_no_of_products_shot,
                ia.shoot_setup                                                  AS issue_shoot_setup,
                COALESCE(ia.no_of_words_written, 0)                            AS issue_no_of_words_written,
                ia.responsive_screen                                            AS issue_responsive_screen,

                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A')                         AS issue_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS issue_requested_accept_at_cm,

                COALESCE(DATE_FORMAT(MIN(iua.created_at), '%d-%b-%Y %H:%i'), 'N/A')                     AS issue_requested_at_assign_intimate_cu,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS issue_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(ia.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A')                AS issue_shared_with_cm_at,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS issue_respond_on_output_cm,

                COALESCE(DATE_FORMAT(ia.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A')                AS issue_output_shared_with_client_at,

                COALESCE(
                    DATE_FORMAT(
                        (SELECT MIN(trh.created_at) FROM task_review_history trh
                         WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                    '%d-%b-%Y %H:%i'),
                'N/A')                                                          AS issue_output_client_responded_approve,

                COALESCE(DATE_FORMAT(ia.start_date, '%d-%b-%Y %H:%i'), 'N/A')  AS issue_start_date,
                COALESCE(DATE_FORMAT(ia.end_date, '%d-%b-%Y %H:%i'), 'N/A')    AS issue_end_date,
                COALESCE(DATE_FORMAT(ia.deadline, '%d-%b-%Y %H:%i'), 'N/A')    AS issue_deadline,

                COALESCE(NULLIF(TRIM(ia.review), ''), 'N/A')                   AS issue_review,
                COALESCE(NULLIF(TRIM(ia.review_stage), ''), 'N/A')             AS issue_review_stage,
                COALESCE(NULLIF(TRIM(ia.status), ''), 'N/A')                   AS issue_status,

                COALESCE(DATE_FORMAT(ia.created_at, '%d-%b-%Y %H:%i'), 'N/A')  AS issue_created_at,
                COALESCE(DATE_FORMAT(ia.updated_at, '%d-%b-%Y %H:%i'), 'N/A')  AS issue_updated_at,

                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(ir.change_issue_type SEPARATOR ', ')
                         FROM issue_assignment_types iat
                         JOIN issue_register ir ON ir.id = iat.issue_register_id
                         WHERE iat.issue_assignment_id = ia.id),
                    ''),
                'N/A')                                                          AS issue_types,

                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(CONCAT(ir.change_issue_type, ' - ', ir.description) SEPARATOR ' | ')
                         FROM issue_assignment_types iat
                         JOIN issue_register ir ON ir.id = iat.issue_register_id
                         WHERE iat.issue_assignment_id = ia.id),
                    ''),
                'N/A')                                                          AS issue_types_with_description,

                COALESCE(NULLIF(TRIM(ia.comments), ''), 'N/A')                 AS issue_digi_comments,
                COALESCE(NULLIF(TRIM(ia.description), ''), 'N/A')              AS issue_requester_description,
                COALESCE(NULLIF(TRIM(wr.about_project), ''), 'N/A')            AS about_issue,
                COALESCE(NULLIF(TRIM(dept.department_name), ''), 'N/A')        AS issue_requester_department,

                DATE_FORMAT(ia.created_at, '%M')                               AS month,
                CASE
                    WHEN MONTH(ia.created_at) >= 4
                        THEN CONCAT('FY ', YEAR(ia.created_at), '-', RIGHT(YEAR(ia.created_at) + 1, 2))
                    ELSE
                        CONCAT('FY ', YEAR(ia.created_at) - 1, '-', RIGHT(YEAR(ia.created_at), 2))
                END                                                             AS fy

            FROM issue_assignments ia
            LEFT JOIN tasks t               ON t.id = ia.task_id
            LEFT JOIN work_requests wr      ON wr.id = t.work_request_id
            LEFT JOIN request_type rt       ON rt.id = wr.request_type_id
            LEFT JOIN task_type tt          ON tt.id = t.task_type_id
            LEFT JOIN users ru              ON ru.id = ia.requested_by_user_id
            LEFT JOIN department dept       ON dept.id = ru.department_id
            LEFT JOIN issue_user_assignments iua ON iua.issue_assignment_id = ia.id
            LEFT JOIN users au              ON au.id = iua.user_id
            LEFT JOIN user_divisions ud         ON ud.user_id = au.id
            LEFT JOIN division d               ON d.id = ud.division_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            GROUP BY
                wr.id, wr.brand, wr.requested_at, wr.about_project,
                t.id, t.task_name, t.task_count,
                ia.id, ia.assignment_type, ia.version, ia.task_count,
                ia.no_of_options_provided, ia.concept_work, ia.no_of_concepts,
                ia.resize_work, ia.no_of_resize, ia.no_of_images_videos_audio,
                ia.duration_minutes, ia.duration_seconds, ia.no_of_products_shot,
                ia.shoot_setup, ia.no_of_words_written, ia.responsive_screen,
                ia.shared_with_client_at, ia.start_date, ia.end_date, ia.deadline,
                ia.review, ia.review_stage, ia.status,
                ia.created_at, ia.updated_at, ia.comments, ia.description,
                rt.request_type,
                tt.task_type,
                ru.id, ru.name,
                dept.department_name,
                d.title
            ORDER BY ia.id DESC
        `;

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
                wr.remarks AS work_request_digi_comments,
                rt.request_type AS request_type_name,
                rt.description AS request_type_description,
                
                pt.id AS project_type_id,
                pt.project_type AS project_type_name,
                pt.description AS project_type_description,
                
                creator.id AS request_creator_id,
                creator.name AS request_creator_name,
                COALESCE(NULLIF((SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                                 FROM user_divisions ud
                                 JOIN division d ON d.id = ud.division_id
                                 WHERE ud.user_id = creator.id), ''), 'N/A') AS request_creator_division,
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

                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS project_requested_accept_at_cm,

                (SELECT DATE_FORMAT(MIN(t2.start_date), '%d-%b-%Y %H:%i')
                 FROM tasks t2 WHERE t2.work_request_id = wr.id) AS project_start_date,

                (SELECT DATE_FORMAT(MAX(t2.end_date), '%d-%b-%Y %H:%i')
                 FROM tasks t2 WHERE t2.work_request_id = wr.id) AS project_end_date,

                (SELECT DATE_FORMAT(MAX(t2.deadline), '%d-%b-%Y %H:%i')
                 FROM tasks t2 WHERE t2.work_request_id = wr.id) AS project_deadline,

                (SELECT
                    CASE
                        WHEN COUNT(t2.id) = 0 THEN NULL
                        WHEN SUM(CASE WHEN t2.review = 'approved' THEN 1 ELSE 0 END) = COUNT(t2.id) THEN 'approved'
                        WHEN SUM(CASE WHEN t2.review = 'change_request' THEN 1 ELSE 0 END) > 0 THEN 'change_request'
                        ELSE 'pending'
                    END
                 FROM tasks t2 WHERE t2.work_request_id = wr.id) AS project_review,

                (SELECT
                    CASE
                        WHEN COUNT(t2.id) = 0 THEN NULL
                        WHEN SUM(CASE WHEN t2.review_stage = 'final_approved' THEN 1 ELSE 0 END) = COUNT(t2.id) THEN 'final_approved'
                        WHEN SUM(CASE WHEN t2.review_stage = 'pm_review' THEN 1 ELSE 0 END) > 0 THEN 'pm_review'
                        WHEN SUM(CASE WHEN t2.review_stage = 'manager_review' THEN 1 ELSE 0 END) > 0 THEN 'manager_review'
                        WHEN SUM(CASE WHEN t2.review_stage = 'change_requested' THEN 1 ELSE 0 END) > 0 THEN 'change_requested'
                        ELSE 'not_started'
                    END
                 FROM tasks t2 WHERE t2.work_request_id = wr.id) AS project_stage,
                
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
                1 AS task_count,
                t.task_count AS task_no_of_work_pages,
                (SELECT COUNT(DISTINCT ia2.id) FROM issue_assignments ia2 WHERE ia2.task_id = t.id) AS issue_task_count,
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
                COALESCE(t.duration_minutes, 0) * 60 + COALESCE(t.duration_seconds, 0) AS task_video_duration,
                t.product_shoot AS task_product_shoot,
                t.no_of_products_shot AS task_no_of_products_shot,
                t.shoot_setup AS task_shoot_setup,
                t.no_of_resize AS task_no_of_resize,
                t.no_of_images_videos_audio AS task_ai,
                t.no_of_images_videos_audio AS task_no_of_ai_page,
                t.responsive_screen AS task_responsive_screen,
                t.no_of_responsive_screen AS task_no_of_responsive_screen,
                t.created_at AS task_created_at,
                t.updated_at AS task_updated_at,
                t.comments AS task_digi_comments,
                t.description AS task_requester_description,

                DATE_FORMAT(t.created_at, '%M') AS month,
                CASE
                    WHEN MONTH(t.created_at) >= 4
                        THEN CONCAT('FY ', YEAR(t.created_at), '-', RIGHT(YEAR(t.created_at) + 1, 2))
                    ELSE
                        CONCAT('FY ', YEAR(t.created_at) - 1, '-', RIGHT(YEAR(t.created_at), 2))
                END AS fy,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(ta2.created_at) FROM task_assignments ta2 WHERE ta2.task_id = t.id),
                '%d-%b-%Y %H:%i'), 'N/A') AS task_requested_at_assign_intimate_cu,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS task_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(t.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A') AS task_shared_with_cm_at,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS task_respond_on_output_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS task_output_client_responded_approved,

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
                CASE
                    WHEN ia.id IS NULL THEN NULL
                    ELSE COALESCE(NULLIF(TRIM(task_rt.request_type), ''), 'N/A')
                END AS issue_request_type_name,
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
                ia.task_count AS issue_task_count_pages,
                ia.task_count AS issue_no_of_work_pages,
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
                COALESCE(ia.duration_minutes, 0) * 60 + COALESCE(ia.duration_seconds, 0) AS issue_video_duration,
                ia.product_shoot AS issue_product_shoot,
                ia.no_of_products_shot AS issue_no_of_products_shot,
                ia.shoot_setup AS issue_shoot_setup,
                ia.no_of_resize AS issue_no_of_resize,
                ia.no_of_images_videos_audio AS issue_ai,
                ia.no_of_images_videos_audio AS issue_no_of_ai_page,
                ia.responsive_screen AS issue_responsive_screen,
                ia.no_of_responsive_screen AS issue_no_of_responsive_screen,
                ia.created_at AS issue_created_at,
                ia.updated_at AS issue_updated_at,
                ia.comments AS issue_comments,

                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), 'N/A') AS issue_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), 'N/A') AS issue_requested_accept_at_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(iua2.created_at) FROM issue_user_assignments iua2 WHERE iua2.issue_assignment_id = ia.id),
                '%d-%b-%Y %H:%i'), 'N/A') AS issue_requested_at_assign_intimate_cu,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS issue_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(ia.shared_with_client_at, '%d-%b-%Y %H:%i'), 'N/A') AS issue_shared_with_cm_at,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS issue_respond_on_output_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                '%d-%b-%Y %H:%i'), 'N/A') AS issue_output_client_responded_approve,
                
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
    getClientsData,
    getTaskDetailsData,
    getIssueDetailsData,
    getTasksForWorkRequest,
    getWorkRequestTasksData,
    getDeletePreview,
    deleteProject,
    deleteClient,
    deleteTask,
    deleteIssue,
    getEditData,
    updateProject,
    updateClient,
    updateTask,
    updateIssue
};
