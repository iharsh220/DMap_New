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

const getClientDeleteQueries = async (req, res) => {
    const { id } = req.params;
    const taskIds = await sequelize.query(
        `SELECT id FROM tasks WHERE work_request_id = :id AND is_deleted = 0`,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT }
    );
    if (taskIds.length) {
        const ids = taskIds.map(r => r.id);
        await sequelize.query(`DELETE iat FROM issue_assignment_types iat INNER JOIN issue_assignments ia ON iat.issue_assignment_id = ia.id WHERE ia.task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE iua FROM issue_user_assignments iua INNER JOIN issue_assignments ia ON iua.issue_assignment_id = ia.id WHERE ia.task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE FROM issue_assignments WHERE task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE FROM task_assignments WHERE task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE FROM task_review_history WHERE task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE td FROM task_documents td INNER JOIN task_assignments ta ON td.task_assignment_id = ta.id WHERE ta.task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE FROM task_dependencies WHERE task_id IN (:ids) OR dependency_task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`DELETE FROM task_project_reference WHERE task_id IN (:ids)`, { replacements: { ids } });
        await sequelize.query(`UPDATE tasks SET is_deleted = 1 WHERE work_request_id = :id AND is_deleted = 0`, { replacements: { id } });
    }
    await sequelize.query(`UPDATE work_requests SET is_deleted = 1 WHERE id = :id`, { replacements: { id } });
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
                 FROM issue_assignments ia WHERE ia.id = :id AND ia.is_deleted = 0`,
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
                 WHERE t.work_request_id = :id AND t.is_deleted = 0 GROUP BY t.id`,
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
                 LEFT JOIN tasks t ON t.work_request_id = wr.id AND t.is_deleted = 0
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id AND ia.is_deleted = 0
                 WHERE wr.id = :id GROUP BY wr.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            const tasks = await sequelize.query(
                `SELECT t.id, t.task_name, t.status,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM tasks t
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE t.work_request_id = :id AND t.is_deleted = 0 GROUP BY t.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: wr, tasks };
        } else if (type === 'task') {
            const [task] = await sequelize.query(
                `SELECT t.id, t.task_name, t.status,
                    COUNT(DISTINCT ia.id) AS issue_count
                 FROM tasks t
                 LEFT JOIN issue_assignments ia ON ia.task_id = t.id
                 WHERE t.id = :id AND t.is_deleted = 0 GROUP BY t.id`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            const issues = await sequelize.query(
                `SELECT ia.id, ia.version, ia.status, ia.assignment_type
                 FROM issue_assignments ia WHERE ia.task_id = :id AND ia.is_deleted = 0`,
                { replacements: { id }, type: sequelize.QueryTypes.SELECT }
            );
            preview = { record: task, issues };
        } else if (type === 'issue') {
            const [issue] = await sequelize.query(
                `SELECT ia.id, ia.version, ia.status, ia.assignment_type,
                    t.task_name, wr.project_name
                 FROM issue_assignments ia
                 LEFT JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
                 LEFT JOIN work_requests wr ON wr.id = t.work_request_id
                 WHERE ia.id = :id AND ia.is_deleted = 0`,
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
    try {
        await getClientDeleteQueries(req, res);
        res.json({ success: true, message: 'Project and all related data deleted successfully' });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteClient = async (req, res) => {
    try {
        await getClientDeleteQueries(req, res);
        res.json({ success: true, message: 'Client request and all related data deleted successfully' });
    } catch (error) {
        console.error('Error deleting client request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        await Tasks.update({ is_deleted: 1 }, { where: { id } });
        await IssueAssignments.update({ is_deleted: 1 }, { where: { task_id: id } });
        res.json({ success: true, message: 'Task soft deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteIssue = async (req, res) => {
    try {
        const { id } = req.params;
        await IssueAssignments.update({ is_deleted: 1 }, { where: { id } });
        res.json({ success: true, message: 'Issue soft deleted successfully' });
    } catch (error) {
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
                COALESCE(NULLIF(TRIM(wr.status), ''), '00h 00m') AS project_request_status,
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
                'N/A') AS request_accepted_by,
                1 AS project_count,
                COUNT(DISTINCT t.id) AS task_count,
                COUNT(DISTINCT ia.id) AS change_count,
                COALESCE(DATE_FORMAT(MIN(t.start_date), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_start_date,
                COALESCE(
                    CASE
                        WHEN wr.status = 'completed'
                            AND NOT EXISTS (
                                SELECT 1 FROM tasks t2
                                WHERE t2.work_request_id = wr.id
                                  AND (t2.status <> 'completed' OR t2.review <> 'approved' OR t2.review_stage <> 'final_approved')
                            )
                        THEN COALESCE(
                            (SELECT DATE_FORMAT(MAX(ia2.end_date), '%d-%b-%Y %H:%i')
                             FROM issue_assignments ia2
                             JOIN tasks t3 ON t3.id = ia2.task_id
                             WHERE t3.work_request_id = wr.id
                               AND ia2.status = 'completed'),
                            (SELECT DATE_FORMAT(MAX(t2.end_date), '%d-%b-%Y %H:%i')
                             FROM tasks t2
                             WHERE t2.work_request_id = wr.id),
                            '00-00-0000 00:00'
                        )
                        ELSE '00-00-0000 00:00'
                    END,
                '00-00-0000 00:00') AS project_end_date,
                (SELECT COUNT(*) FROM issue_history ih WHERE ih.work_request_id = wr.id AND ih.action = 'created') AS client_change_requested_counter,
                COUNT(DISTINCT CASE WHEN th.actor_id IN (SELECT manager_id FROM work_request_managers WHERE work_request_id = wr.id) THEN th.id END) AS cm_change_requested_counter,
                COALESCE(SUM(t.task_count), 0) AS task_no_of_work_pages,
                COALESCE(SUM(ia.task_count), 0) AS issue_no_of_work_pages,
                COALESCE(SUM(t.no_of_options_provided), 0) AS task_no_of_options_provided,
                COALESCE(SUM(t.concept_work), 0) AS task_concept_work,
                COALESCE(SUM(t.no_of_resize), 0) AS task_no_of_resize,
                COALESCE(SUM(t.no_of_images_videos_audio), 0) AS task_no_of_ai_page,
                COALESCE(SUM(t.duration_minutes * 60 + t.duration_seconds), 0) AS video_duration,
                COALESCE(SUM(t.no_of_products_shot), 0) AS task_no_of_products_shot,
                COALESCE(SUM(t.no_of_words_written), 0) AS task_no_of_words_written,
                COALESCE(SUM(t.no_of_responsive_screen), 0) AS task_no_of_responsive_screen,
                COALESCE(SUM(t.resize_work), 0) AS task_resize_work,
                COALESCE(SUM(t.no_of_images_videos_audio), 0) AS task_ai,
                COALESCE(SUM(t.shoot_setup), 0) AS task_shoot_setup,
                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_request_timestamp,
                COALESCE(DATE_FORMAT((SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'manager_accepted'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_acceptance_timestamp,
                COALESCE(DATE_FORMAT((SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_marked_completed_timestamp,
                COALESCE((SELECT wrh.actor_name FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed' ORDER BY wrh.created_at ASC LIMIT 1), 'N/A') AS project_marked_completed_by,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created') IS NOT NULL
                          AND (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created'),
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created'),
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS internal_project_tat,
                COALESCE(
                    CASE
                        WHEN
                            (SELECT MIN(th1.created_at) FROM task_history th1 JOIN tasks t1 ON t1.id = th1.task_id AND t1.is_deleted = 0 WHERE t1.work_request_id = wr.id AND th1.action = 'created') IS NOT NULL
                            AND GREATEST(
                                COALESCE((SELECT MAX(th2.created_at) FROM task_history th2 JOIN tasks t2 ON t2.id = th2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND th2.action = 'completed'), '1970-01-01'),
                                COALESCE((SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed'), '1970-01-01')
                            ) > '1970-01-01'
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(th1.created_at) FROM task_history th1 JOIN tasks t1 ON t1.id = th1.task_id AND t1.is_deleted = 0 WHERE t1.work_request_id = wr.id AND th1.action = 'created'),
                                GREATEST(
                                    COALESCE((SELECT MAX(th2.created_at) FROM task_history th2 JOIN tasks t2 ON t2.id = th2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND th2.action = 'completed'), '1970-01-01'),
                                    COALESCE((SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed'), '1970-01-01')
                                )
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(th1.created_at) FROM task_history th1 JOIN tasks t1 ON t1.id = th1.task_id AND t1.is_deleted = 0 WHERE t1.work_request_id = wr.id AND th1.action = 'created'),
                                GREATEST(
                                    COALESCE((SELECT MAX(th2.created_at) FROM task_history th2 JOIN tasks t2 ON t2.id = th2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND th2.action = 'completed'), '1970-01-01'),
                                    COALESCE((SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'completed'), '1970-01-01')
                                )
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS project_tat,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created') IS NOT NULL
                          AND (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'manager_accepted') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created'),
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'manager_accepted')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'created'),
                                (SELECT MIN(wrh.created_at) FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'manager_accepted')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS project_request_to_response_tat,
                COALESCE(
                    (
                        SELECT
                            CASE
                                WHEN AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) IS NOT NULL
                                THEN CONCAT(
                                    FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) / 60), 'h ',
                                    MOD(ROUND(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at))), 60), 'm'
                                )
                                ELSE NULL
                            END
                        FROM tasks t_tat
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'created' AND actor_type = 'manager'
                            GROUP BY task_id
                        ) th_start ON th_start.task_id = t_tat.id
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'accepted' AND actor_type = 'user'
                            GROUP BY task_id
                        ) th_end ON th_end.task_id = t_tat.id
                        WHERE t_tat.work_request_id = wr.id AND t_tat.is_deleted = 0
                    ),
                '00h 00m') AS task_request_to_response_tat_avg,
                COALESCE(
                    (
                        SELECT
                            CASE
                                WHEN AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) IS NOT NULL
                                THEN CONCAT(
                                    FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) / 60), 'h ',
                                    MOD(ROUND(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at))), 60), 'm'
                                )
                                ELSE NULL
                            END
                        FROM tasks t_tat
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'accepted'
                            GROUP BY task_id
                        ) th_start ON th_start.task_id = t_tat.id
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'submitted'
                            GROUP BY task_id
                        ) th_end ON th_end.task_id = t_tat.id
                        WHERE t_tat.work_request_id = wr.id AND t_tat.is_deleted = 0
                    ),
                '00h 00m') AS task_acceptance_to_completion_tat_by_cu_avg,
                COALESCE(
                    (
                        SELECT
                            CASE
                                WHEN AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) IS NOT NULL
                                THEN CONCAT(
                                    FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) / 60), 'h ',
                                    MOD(ROUND(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at))), 60), 'm'
                                )
                                ELSE NULL
                            END
                        FROM tasks t_tat
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'submitted'
                            GROUP BY task_id
                        ) th_start ON th_start.task_id = t_tat.id
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action IN ('manager_approved', 'manager_change_requested')
                            GROUP BY task_id
                        ) th_end ON th_end.task_id = t_tat.id
                        WHERE t_tat.work_request_id = wr.id AND t_tat.is_deleted = 0
                    ),
                '00h 00m') AS task_output_shared_to_response_by_cm_tat_avg,
                COALESCE(
                    (
                        SELECT
                            CASE
                                WHEN AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) IS NOT NULL
                                THEN CONCAT(
                                    FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) / 60), 'h ',
                                    MOD(ROUND(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at))), 60), 'm'
                                )
                                ELSE NULL
                            END
                        FROM tasks t_tat
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'accepted'
                            GROUP BY task_id
                        ) th_start ON th_start.task_id = t_tat.id
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'manager_approved'
                            GROUP BY task_id
                        ) th_end ON th_end.task_id = t_tat.id
                        WHERE t_tat.work_request_id = wr.id AND t_tat.is_deleted = 0
                    ),
                '00h 00m') AS task_internal_tat_avg,
                COALESCE(
                    (
                        SELECT
                            CASE
                                WHEN AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) IS NOT NULL
                                THEN CONCAT(
                                    FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at)) / 60), 'h ',
                                    MOD(ROUND(AVG(TIMESTAMPDIFF(MINUTE, th_start.created_at, th_end.created_at))), 60), 'm'
                                )
                                ELSE NULL
                            END
                        FROM tasks t_tat
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'accepted'
                            GROUP BY task_id
                        ) th_start ON th_start.task_id = t_tat.id
                        JOIN (
                            SELECT task_id, MIN(created_at) AS created_at
                            FROM task_history
                            WHERE action = 'completed'
                            GROUP BY task_id
                        ) th_end ON th_end.task_id = t_tat.id
                        WHERE t_tat.work_request_id = wr.id AND t_tat.is_deleted = 0
                    ),
                '00h 00m') AS task_whole_tat_avg,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS change_request_to_response_tat,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS change_acceptance_to_completion_tat_by_cu,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'manager_approved' AND actor_type = 'manager') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'manager_approved' AND actor_type = 'manager')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'manager_approved' AND actor_type = 'manager')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS change_output_shared_to_response_by_cm_tat,
                '00h 00m' AS change_internal_tat,
                '00h 00m' AS change_whole_tat,
                0 AS project_request_response_reminder_counter_to_cm,
                0 AS task_request_response_reminder_counter_to_cu,
                0 AS task_output_response_reminder_counter_to_cm,
                0 AS task_output_response_reminder_counter_to_client,
                0 AS change_request_response_reminder_counter_to_cu,
                0 AS chnage_output_response_reminder_counter_to_cm,
                0 AS change_output_response_reminder_counter_to_client,
                0 AS project_closure_reminder_counter_to_client,
                COALESCE(DATE_FORMAT(
                    COALESCE(
                        (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                        (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                    )
                , '%M'), '00') AS month,
                COALESCE(
                    CASE
                        WHEN MONTH(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) >= 4
                        THEN CONCAT('FY ', YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )), '-', RIGHT(YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) + 1, 2))
                        ELSE CONCAT('FY ', YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) - 1, '-', RIGHT(YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )), 2))
                    END,
                '00') AS fy
            FROM work_requests wr
            LEFT JOIN request_type rt ON rt.id = wr.request_type_id
            LEFT JOIN project_type pt ON pt.id = wr.project_id
            LEFT JOIN users ru ON ru.id = wr.user_id
LEFT JOIN tasks t ON t.work_request_id = wr.id AND t.is_deleted = 0
             LEFT JOIN issue_assignments ia ON ia.task_id = t.id AND ia.is_deleted = 0
             LEFT JOIN task_history th ON th.work_request_id = wr.id AND th.action = 'manager_change_requested'
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            GROUP BY
                wr.id,
                wr.project_name,
                rt.request_type,
                rt.description,
                ru.name,
                ru.email,
                ru.phone,
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
                COALESCE(NULLIF(TRIM(wr.status), ''), '00h 00m') AS project_status,
                COALESCE(NULLIF(TRIM(wr.description), ''), 'N/A') AS description,
                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT wrh.created_at FROM work_request_history wrh WHERE wrh.work_request_id = wr.id AND wrh.action = 'manager_accepted' LIMIT 1), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS response_timestamp,
                COALESCE(DATE_FORMAT(
                    COALESCE(
                        (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                        (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                    )
                , '%M'), '00') AS month,
                COALESCE(
                    CASE
                        WHEN MONTH(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) >= 4
                        THEN CONCAT('FY ', YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )), '-', RIGHT(YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) + 1, 2))
                        ELSE CONCAT('FY ', YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )) - 1, '-', RIGHT(YEAR(COALESCE(
                            (SELECT ia2.deadline FROM issue_assignments ia2 JOIN tasks t2 ON t2.id = ia2.task_id AND t2.is_deleted = 0 WHERE t2.work_request_id = wr.id AND ia2.is_deleted = 0 AND t2.id = (SELECT MAX(t3.id) FROM tasks t3 WHERE t3.work_request_id = wr.id AND t3.is_deleted = 0) ORDER BY ia2.id DESC LIMIT 1),
                            (SELECT t2.deadline FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0 ORDER BY t2.id DESC LIMIT 1)
                        )), 2))
                    END,
                '00') AS financial_year,
                CASE
                    WHEN wr.requested_at IS NOT NULL
                     AND (SELECT wrh2.created_at FROM work_request_history wrh2 WHERE wrh2.work_request_id = wr.id AND wrh2.action = 'manager_accepted' LIMIT 1) IS NOT NULL
                    THEN CONCAT(
                        FLOOR(TIMESTAMPDIFF(MINUTE, wr.requested_at, (SELECT wrh3.created_at FROM work_request_history wrh3 WHERE wrh3.work_request_id = wr.id AND wrh3.action = 'manager_accepted' LIMIT 1)) / 60),
                        'h ',
                        MOD(TIMESTAMPDIFF(MINUTE, wr.requested_at, (SELECT wrh4.created_at FROM work_request_history wrh4 WHERE wrh4.work_request_id = wr.id AND wrh4.action = 'manager_accepted' LIMIT 1)), 60),
                        'm'
                    )
                    ELSE '00h 00m'
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
                COALESCE(NULLIF(TRIM(t.status), ''), '00h 00m') AS task_status,
                wr.id AS work_request_id,
                t.id AS task_id,
                GROUP_CONCAT(DISTINCT ia.id ORDER BY ia.id SEPARATOR ', ') AS change_id,
                COALESCE(NULLIF(TRIM(t.task_name), ''), 'N/A') AS task_name,
                COALESCE(NULLIF(TRIM(tt.task_type), ''), 'N/A') AS task_type_name,
                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A') AS task_requester_name,
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
                'N/A') AS task_manager,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT au.name ORDER BY au.name SEPARATOR ', ')
                         FROM task_assignments ta2
                         JOIN users au ON au.id = ta2.user_id
                         WHERE ta2.task_id = t.id),
                    ''),
                'N/A') AS assigned_creative_user,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d2.title ORDER BY d2.title SEPARATOR ', ')
                         FROM task_assignments ta3
                         JOIN user_divisions ud2 ON ud2.user_id = ta3.user_id
                         JOIN division d2 ON d2.id = ud2.division_id
                         WHERE ta3.task_id = t.id),
                    ''),
                'N/A') AS cu_vertical,
                COALESCE(DATE_FORMAT(t.start_date, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_start_date,
                COALESCE(DATE_FORMAT(t.end_date, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_end_date,
                COALESCE(DATE_FORMAT(t.deadline, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_deadline,
                COALESCE(t.task_count, 0) AS task_no_of_work_pages,
                COALESCE(SUM(DISTINCT ia.task_count), 0) AS issue_no_of_work_pages,
                COALESCE(t.no_of_options_provided, 0) AS task_no_of_options_provided,
                COALESCE(t.concept_work, 0) AS task_concept_work,
                COALESCE(t.no_of_resize, 0) AS task_no_of_resize,
                COALESCE(t.no_of_images_videos_audio, 0) AS task_no_of_ai_page,
                COALESCE(t.duration_minutes * 60 + t.duration_seconds, 0) AS video_duration,
                COALESCE(t.no_of_products_shot, 0) AS task_no_of_products_shot,
                COALESCE(t.no_of_words_written, 0) AS task_no_of_words_written,
                COALESCE(t.no_of_responsive_screen, 0) AS task_no_of_responsive_screen,
                COALESCE(t.resize_work, 0) AS task_resize_work,
                COALESCE(t.no_of_images_videos_audio, 0) AS task_ai,
                COALESCE(t.shoot_setup, 0) AS task_shoot_setup,
                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_request_timestamp,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_request_response_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created' AND actor_type = 'manager') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted' AND actor_type = 'user') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted' AND actor_type = 'user')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted' AND actor_type = 'user')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS task_request_to_response_tat,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_output_shared_with_cm_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS task_acceptance_to_completion_tat_by_cu,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'shared_for_client_review'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_output_response_by_cm_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested')) IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'submitted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS task_output_shared_to_response_by_cm_tat,
                COALESCE(DATE_FORMAT(t.shared_with_client_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_output_shared_with_client_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested')) IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS task_internal_tat,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action IN ('completed', 'change_request_created')), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_output_response_by_client_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'completed') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'completed')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'created'),
                                (SELECT MIN(created_at) FROM task_history WHERE task_id = t.id AND action = 'completed')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS task_whole_tat,
                0 AS task_request_response_reminder_counter_to_cu,
                0 AS task_output_response_reminder_counter_to_cm,
                0 AS task_output_response_reminder_counter_to_client,
                (SELECT COUNT(*) FROM issue_history ih WHERE ih.task_id = t.id AND ih.action = 'created') AS client_change_requested_counter,
                (SELECT COUNT(*) FROM task_history th WHERE th.task_id = t.id AND th.action = 'manager_change_requested') AS cm_change_requested_counter,
                GROUP_CONCAT(DISTINCT ia.version ORDER BY ia.version SEPARATOR ', ') AS change_version,
                COALESCE(DATE_FORMAT(t.deadline, '%M'), '00') AS month,
                COALESCE(
                    CASE
                        WHEN MONTH(t.deadline) >= 4
                            THEN CONCAT('FY ', YEAR(t.deadline), '-', RIGHT(YEAR(t.deadline) + 1, 2))
                        ELSE CONCAT('FY ', YEAR(t.deadline) - 1, '-', RIGHT(YEAR(t.deadline), 2))
                    END,
                '00') AS fy
             FROM tasks t
             LEFT JOIN work_requests wr ON wr.id = t.work_request_id
             LEFT JOIN task_type tt ON tt.id = t.task_type_id
             LEFT JOIN users ru ON ru.id = wr.user_id
             LEFT JOIN issue_assignments ia ON ia.task_id = t.id AND ia.is_deleted = 0
           `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')} AND t.is_deleted = 0`;
        } else {
            query += ` WHERE t.is_deleted = 0`;
        }

        query += `
             GROUP BY
                 t.id, wr.id, wr.requested_at,
                 t.task_name, t.status, t.start_date, t.end_date, t.deadline,
                 t.task_count, t.no_of_options_provided, t.concept_work,
                 t.no_of_resize, t.no_of_images_videos_audio,
                 t.duration_minutes, t.duration_seconds,
                 t.no_of_products_shot, t.no_of_words_written, t.no_of_responsive_screen,
                 t.resize_work, t.shoot_setup,
                 t.shared_with_client_at, t.created_at,
                 tt.task_type, ru.name
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
                COALESCE(NULLIF(TRIM(ia.status), ''), '00h 00m') AS issue_status,
                wr.id AS work_request_id,
                t.id AS task_id,
                ia.id AS issue_id,
                COALESCE(NULLIF(TRIM(t.task_name), ''), 'N/A') AS task_name,
                COALESCE(NULLIF(TRIM(tt.task_type), ''), 'N/A') AS task_type_name,
                COALESCE(NULLIF(TRIM(ru.name), ''), 'N/A') AS issue_requester_name,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d.title ORDER BY d.title SEPARATOR ', ')
                         FROM user_divisions ud
                         JOIN division d ON d.id = ud.division_id
                         WHERE ud.user_id = wr.user_id),
                    ''),
                'N/A') AS client_division,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT mu2.name ORDER BY mu2.name SEPARATOR ', ')
                         FROM work_request_managers wrm2
                         JOIN users mu2 ON mu2.id = wrm2.manager_id
                         WHERE wrm2.work_request_id = wr.id),
                    ''),
                'N/A') AS task_manager,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT au2.name ORDER BY au2.name SEPARATOR ', ')
                         FROM issue_user_assignments iua2
                         JOIN users au2 ON au2.id = iua2.user_id
                         WHERE iua2.issue_assignment_id = ia.id),
                    ''),
                'N/A') AS assigned_creative_user,
                COALESCE(
                    NULLIF(
                        (SELECT GROUP_CONCAT(DISTINCT d2.title ORDER BY d2.title SEPARATOR ', ')
                         FROM issue_user_assignments iua3
                         JOIN user_divisions ud2 ON ud2.user_id = iua3.user_id
                         JOIN division d2 ON d2.id = ud2.division_id
                         WHERE iua3.issue_assignment_id = ia.id),
                    ''),
                'N/A') AS cu_vertical,
                COALESCE(DATE_FORMAT(ia.start_date, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_start_date,
                COALESCE(DATE_FORMAT(ia.end_date, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_end_date,
                COALESCE(DATE_FORMAT(ia.deadline, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_deadline,
                COALESCE(t.task_count, 0) AS task_no_of_work_pages,
                COALESCE(ia.task_count, 0) AS issue_no_of_work_pages,
                COALESCE(ia.no_of_options_provided, 0) AS issue_no_of_options_provided,
                COALESCE(ia.concept_work, 0) AS issue_concept_work,
                COALESCE(ia.no_of_resize, 0) AS issue_no_of_resize,
                COALESCE(ia.no_of_images_videos_audio, 0) AS issue_no_of_ai_page,
                COALESCE(ia.duration_minutes * 60 + ia.duration_seconds, 0) AS issue_video_duration,
                COALESCE(ia.no_of_products_shot, 0) AS issue_no_of_products_shot,
                COALESCE(ia.no_of_words_written, 0) AS issue_no_of_words_written,
                COALESCE(ia.responsive_screen, 0) AS issue_no_of_responsive_screen,
                COALESCE(ia.resize_work, 0) AS issue_resize_work,
                COALESCE(ia.no_of_images_videos_audio, 0) AS issue_ai,
                COALESCE(ia.shoot_setup, 0) AS issue_shoot_setup,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_request_timestamp,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_request_response_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'assigned' AND actor_type = 'manager'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS issue_request_to_response_tat,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_output_shared_with_cm_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted' AND actor_type = 'user'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted' AND actor_type = 'user')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS issue_acceptance_to_completion_tat_by_cu,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'manager_approved' AND actor_type = 'manager'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_output_response_by_cm_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested')) IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'submitted'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS issue_output_shared_to_response_by_cm_tat,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'shared_for_client_review'), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_output_shared_with_client_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested')) IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'accepted'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('manager_approved', 'manager_change_requested'))
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS issue_internal_tat,
                COALESCE(DATE_FORMAT((SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action IN ('completed', 'change_request_created')), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_output_response_by_client_timestamp,
                COALESCE(
                    CASE
                        WHEN (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'created') IS NOT NULL
                          AND (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'completed') IS NOT NULL
                        THEN CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'created'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'completed')
                            ) / 60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE,
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'created'),
                                (SELECT MIN(created_at) FROM issue_history WHERE issue_assignment_id = ia.id AND action = 'completed')
                            ), 60), 'm'
                        )
                        ELSE NULL
                    END,
                '00h 00m') AS issue_whole_tat,
                0 AS issue_request_response_reminder_counter_to_cu,
                0 AS issue_output_response_reminder_counter_to_cm,
                0 AS issue_output_response_reminder_counter_to_client,
                (SELECT COUNT(*) FROM issue_history ih WHERE ih.issue_assignment_id = ia.id AND ih.action = 'created') AS client_change_requested_counter,
                (SELECT COUNT(*) FROM issue_history ih WHERE ih.issue_assignment_id = ia.id AND ih.action = 'manager_change_requested') AS cm_change_requested_counter,
                GROUP_CONCAT(DISTINCT ia.version ORDER BY ia.version SEPARATOR ', ') AS change_version,
                COALESCE(DATE_FORMAT(ia.deadline, '%M'), '00') AS month,
                COALESCE(
                    CASE
                        WHEN MONTH(ia.deadline) >= 4
                            THEN CONCAT('FY ', YEAR(ia.deadline), '-', RIGHT(YEAR(ia.deadline) + 1, 2))
                        ELSE CONCAT('FY ', YEAR(ia.deadline) - 1, '-', RIGHT(YEAR(ia.deadline), 2))
                    END,
                '00') AS fy
FROM issue_assignments ia
             LEFT JOIN tasks t ON t.id = ia.task_id AND t.is_deleted = 0
             LEFT JOIN work_requests wr ON wr.id = t.work_request_id
             LEFT JOIN task_type tt ON tt.id = t.task_type_id
             LEFT JOIN users ru ON ru.id = wr.user_id
             LEFT JOIN issue_user_assignments iua ON iua.issue_assignment_id = ia.id
             LEFT JOIN users au ON au.id = iua.user_id
             LEFT JOIN user_divisions ud ON ud.user_id = au.id
LEFT JOIN division d ON d.id = ud.division_id
           `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')} AND ia.is_deleted = 0`;
        } else {
            query += ` WHERE ia.is_deleted = 0`;
        }

        query += `
             GROUP BY
                 ia.id, t.id, wr.id, ia.created_at,
                 t.task_name, t.status, t.task_count,
                 t.start_date, t.end_date, t.deadline,
                 tt.task_type, ru.name
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
            WHERE t.work_request_id = :workRequestId AND t.is_deleted = 0
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

                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS project_requested_accept_at_cm,

(SELECT DATE_FORMAT(MIN(t2.start_date), '%d-%b-%Y %H:%i')
                  FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0) AS project_start_date,

                 (SELECT DATE_FORMAT(MAX(t2.end_date), '%d-%b-%Y %H:%i')
                  FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0) AS project_end_date,

                 (SELECT DATE_FORMAT(MAX(t2.deadline), '%d-%b-%Y %H:%i')
                  FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0) AS project_deadline,

                 (SELECT
                     CASE
                         WHEN COUNT(t2.id) = 0 THEN NULL
                         WHEN SUM(CASE WHEN t2.review = 'approved' THEN 1 ELSE 0 END) = COUNT(t2.id) THEN 'approved'
                         WHEN SUM(CASE WHEN t2.review = 'change_request' THEN 1 ELSE 0 END) > 0 THEN 'change_request'
                         ELSE 'pending'
                     END
                  FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0) AS project_review,

                 (SELECT
                     CASE
                         WHEN COUNT(t2.id) = 0 THEN NULL
                         WHEN SUM(CASE WHEN t2.review_stage = 'final_approved' THEN 1 ELSE 0 END) = COUNT(t2.id) THEN 'final_approved'
                         WHEN SUM(CASE WHEN t2.review_stage = 'pm_review' THEN 1 ELSE 0 END) > 0 THEN 'pm_review'
                         WHEN SUM(CASE WHEN t2.review_stage = 'manager_review' THEN 1 ELSE 0 END) > 0 THEN 'manager_review'
                         WHEN SUM(CASE WHEN t2.review_stage = 'change_requested' THEN 1 ELSE 0 END) > 0 THEN 'change_requested'
                         ELSE 'not_started'
                     END
                  FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0) AS project_stage,
                
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
                (SELECT COUNT(DISTINCT ia2.id) FROM issue_assignments ia2 WHERE ia2.task_id = t.id AND ia2.is_deleted = 0) AS issue_task_count,
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
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_requested_at_assign_intimate_cu,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(t.shared_with_client_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_shared_with_cm_at,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_respond_on_output_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS task_output_client_responded_approved,

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

                COALESCE(DATE_FORMAT(wr.requested_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_requested_at_client,
                COALESCE(DATE_FORMAT((SELECT MIN(wrm2.created_at) FROM work_request_managers wrm2 WHERE wrm2.work_request_id = wr.id), '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_requested_accept_at_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(iua2.created_at) FROM issue_user_assignments iua2 WHERE iua2.issue_assignment_id = ia.id),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_requested_at_assign_intimate_cu,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_requested_accept_at_cu,

                COALESCE(DATE_FORMAT(ia.shared_with_client_at, '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_shared_with_cm_at,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.reviewer_type = 'manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_respond_on_output_cm,

                COALESCE(DATE_FORMAT(
                    (SELECT MIN(trh.created_at) FROM task_review_history trh
                     WHERE trh.task_id = t.id AND trh.action = 'approved' AND trh.reviewer_type = 'project_manager'),
                '%d-%b-%Y %H:%i'), '00-00-0000 00:00') AS issue_output_client_responded_approve,
                
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
LEFT JOIN tasks t ON t.work_request_id = wr.id AND t.is_deleted = 0
             LEFT JOIN task_type tt ON tt.id = t.task_type_id
             LEFT JOIN request_type task_rt ON task_rt.id = t.request_type_id
             LEFT JOIN task_assignments ta ON ta.task_id = t.id
             LEFT JOIN users assignee ON assignee.id = ta.user_id
             LEFT JOIN department assignee_dept ON assignee_dept.id = assignee.department_id
             LEFT JOIN designation assignee_desig ON assignee_desig.id = assignee.designation_id
             LEFT JOIN job_role assignee_job ON assignee_job.id = assignee.job_role_id
             LEFT JOIN location assignee_loc ON assignee_loc.id = assignee.location_id
             LEFT JOIN issue_assignments ia ON ia.task_id = t.id AND ia.is_deleted = 0
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
