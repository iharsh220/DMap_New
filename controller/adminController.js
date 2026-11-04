const { sequelize } = require('../config/databaseConfig');
const { Op } = require('sequelize');
const { parseGridFilters, applyGridFilters, selectAliases, resolveSort, orderSql, runOuterQuery, statusCountSql, statusCountsFrom, tatHoursSql } = require('../services/adminGridService');

// Status values per entity (schema ENUMs), used for the KPI status breakdowns
const WORK_REQUEST_STATUSES = ['draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred', 'cancelled'];
const TASK_STATUSES = ['draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred', 'cancelled'];
const ISSUE_STATUSES = ['m_pending', 'm_accepted', 'u_pending', 'u_accepted', 'in_progress', 'completed', 'rejected', 'on_hold', 'cancelled'];

// Cost columns are only returned (and only filterable / sortable) for Super Admin
const TASK_COST_KEYS = ['task_cost', 'concept_work_cost', 'ai_charges_cost', 'resize_work_cost', 'change_cost', 'total_cost'];
const ISSUE_COST_KEYS = ['issue_cost', 'concept_work_cost', 'ai_charges_cost', 'resize_work_cost', 'total_cost'];

// Full cost of one change request (alias ia_c) at rate card `mc`: change pages, concepts,
// resize and AI work. The Changes page shows it per change as total_cost; the Tasks page adds
// it up over the task's changes as change_cost.
const changeCostSql = (ia, mc) => `(
                    COALESCE(${ia}.task_count * ${mc}.changes_rate, 0)
                    + COALESCE(${ia}.concept_work * ${ia}.no_of_concepts * ${mc}.concept_charge, 0)
                    + COALESCE(${ia}.resize_work * ${mc}.changes_rate * (1 + ${mc}.no_of_resize_pages / 100) * ${ia}.no_of_resize, 0)
                    + COALESCE(${ia}.no_of_images_videos_audio * ${mc}.ai_charges, 0)
                )`;

async function isAdminRequest(req) {
    if (req.user && req.user.jobRole) return req.user.jobRole.id === 1;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return false;
    try {
        const payload = await decryptToken(token, process.env.JWT_ENCRYPTION_KEY);
        return !!(payload && payload.jobRole && payload.jobRole.id === 1);
    } catch (e) {
        return false;
    }
}

function omitKeys(row, keys) {
    const copy = { ...row };
    keys.forEach(key => { delete copy[key]; });
    return copy;
}
const { TaskType, User, Feedbacks, Leave, Division, Tasks, IssueAssignments } = require('../models');
const ExcelJS = require('exceljs');
const csvParser = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { clearAdminCache } = require('../services/adminCacheService');
const { decryptToken } = require('../middleware/jwtMiddleware');
const { parseId } = require('../utils/validators');

let sseClients = {};

function sendProgress(jobId, progress, message, total) {
    const client = sseClients[jobId];
    if (client) {
        try {
            client.res.write(`data: ${JSON.stringify({ progress, message, total })}\n\n`);
            if (typeof client.res.flush === 'function') {
                client.res.flush();
            }
        } catch (e) {
            delete sseClients[jobId];
        }
    }
}

function parseCSVRows(fileBuf) {
    return new Promise((resolve, reject) => {
        const rows = [];
        const stream = require('stream');
        const readable = new stream.Readable();
        readable._write = () => {};
        readable.push(fileBuf);
        readable.push(null);
        readable
            .pipe(csvParser())
            .on('data', (data) => rows.push(data))
            .on('end', () => resolve(rows))
            .on('error', (err) => reject(err));
    });
}

function parseExcelRows(fileBuf) {
    return new Promise((resolve, reject) => {
        const wb = new ExcelJS.Workbook();
        const rows = [];
        wb.xlsx
            .load(fileBuf)
            .then(() => {
                const ws = wb.worksheets[0];
                if (!ws) { return resolve([]); }
                let header = null;
                ws.eachRow((row, rowNumber) => {
                    const vals = row.values.slice(1).map(v => (v && v.value !== undefined ? v.value : v));
                    const val = vals.map(v => (v && v.raw ? v.raw : v));
                    if (rowNumber === 1) {
                        header = val.map(String);
                    } else {
                        const obj = {};
                        header.forEach((h, i) => { obj[h] = val[i]; });
                        rows.push(obj);
                    }
                });
                resolve(rows);
            })
            .catch((err) => reject(err));
    });
}

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
                `SELECT id, project_name, brand, priority, status, remarks, description, about_project, requested_at, project_id, user_id, request_type_id FROM work_requests WHERE id = :id`,
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

const getRequestTypes = async (req, res) => {
    try {
        const requestTypes = await sequelize.query(
            `SELECT id, request_type, description FROM request_type ORDER BY request_type ASC`,
            { type: sequelize.QueryTypes.SELECT }
        );
        res.json({ success: true, data: requestTypes });
    } catch (error) {
        console.error('Error fetching request types:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getProjectTypesByProject = async (req, res) => {
    try {
        const { id } = req.params;
        const { request_type_id } = req.query;

        let sql = `
            SELECT DISTINCT pt.id, pt.project_type, pt.description
            FROM work_requests wr
            JOIN project_request_reference prr ON prr.request_id = wr.request_type_id
            JOIN project_type pt ON pt.id = prr.project_id
            WHERE wr.id = :id`;
        const replacements = { id };

        if (request_type_id) {
            sql = `
                SELECT DISTINCT pt.id, pt.project_type, pt.description
                FROM project_request_reference prr
                JOIN project_type pt ON pt.id = prr.project_id
                WHERE prr.request_id = :request_type_id
                ORDER BY pt.project_type ASC`;
            replacements.request_type_id = request_type_id;
        }

        const projectTypes = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
        res.json({ success: true, data: projectTypes });
    } catch (error) {
        console.error('Error fetching project types:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getCreativeManagerByProject = async (req, res) => {
    try {
        const { id } = req.params;
        const { request_type_id } = req.query;

        let sql;
        let replacements;

        if (request_type_id) {
            sql = `
                SELECT DISTINCT u.id, u.name, u.email
                FROM request_division_reference rdr
                JOIN user_divisions ud ON ud.division_id = rdr.division_id
                JOIN users u ON u.id = ud.user_id
                WHERE rdr.request_id = :request_type_id
                  AND u.job_role_id = 2
                  AND u.account_status = 'active'
                ORDER BY u.name ASC
                LIMIT 1`;
            replacements = { request_type_id };
        } else {
            sql = `
                SELECT DISTINCT u.id, u.name, u.email
                FROM work_requests wr
                JOIN request_division_reference rdr ON rdr.request_id = wr.request_type_id
                JOIN user_divisions ud ON ud.division_id = rdr.division_id
                JOIN users u ON u.id = ud.user_id
                WHERE wr.id = :id
                  AND u.job_role_id = 2
                  AND u.account_status = 'active'
                ORDER BY u.name ASC
                LIMIT 1`;
            replacements = { id };
        }

        const managers = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
        res.json({ success: true, data: managers });
    } catch (error) {
        console.error('Error fetching creative manager:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateProject = async (req, res) => {
    try {
        const { id } = req.params;
        const { project_name, brand, priority, status, remarks, description, project_id, request_type_id } = req.body;

        const [existing] = await sequelize.query(
            `SELECT request_type_id FROM work_requests WHERE id = :id`,
            { replacements: { id }, type: sequelize.QueryTypes.SELECT }
        );
        const oldRequestTypeId = existing ? existing.request_type_id : null;

        let setClause = 'project_name=:project_name, brand=:brand, priority=:priority, status=:status, remarks=:remarks, description=:description';
        const replacements = { id, project_name, brand, priority, status, remarks, description };

        if (request_type_id !== undefined && request_type_id !== '') {
            setClause += ', request_type_id=:request_type_id';
            replacements.request_type_id = request_type_id;
        }

        if (project_id !== undefined && project_id !== '') {
            setClause += ', project_id=:project_id';
            replacements.project_id = project_id;
        }

        setClause += ', updated_at=NOW()';

        await sequelize.query(
            `UPDATE work_requests SET ${setClause} WHERE id=:id`,
            { replacements, type: sequelize.QueryTypes.UPDATE }
        );

        if (request_type_id !== undefined && request_type_id !== '' && String(oldRequestTypeId) !== String(request_type_id)) {
            const manager = await sequelize.query(
                `SELECT DISTINCT u.id, u.name, u.email
                 FROM request_division_reference rdr
                 JOIN user_divisions ud ON ud.division_id = rdr.division_id
                 JOIN users u ON u.id = ud.user_id
                 WHERE rdr.request_id = :request_type_id
                   AND u.job_role_id = 2
                   AND u.account_status = 'active'
                 ORDER BY u.name ASC
                 LIMIT 1`,
                { replacements: { request_type_id }, type: sequelize.QueryTypes.SELECT }
            );

            await sequelize.query(`DELETE FROM work_request_managers WHERE work_request_id = :id`, { replacements: { id } });

            if (manager.length > 0 && manager[0].id) {
                await sequelize.query(
                    `INSERT INTO work_request_managers (work_request_id, manager_id, created_at, updated_at) VALUES (:work_request_id, :manager_id, NOW(), NOW())`,
                    { replacements: { work_request_id: id, manager_id: manager[0].id }, type: sequelize.QueryTypes.INSERT }
                );
            }
        }

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

const getAllLeaves = async (req, res) => {
    try {
        const { startDate, endDate, userId, leaveDayType, leaveType, status, leaveReason, vertical, year, month } = req.query;
        const { page, limit, offset } = req.pagination;

        const where = { is_deleted: 0 };
        if (startDate) where.from_date = { ...where.from_date, [Op.gte]: startDate };
        if (endDate) where.to_date = { ...where.to_date, [Op.lte]: endDate };
        if (userId) where.user_id = userId;
        if (leaveDayType) where.leave_day_type = leaveDayType;
        if (leaveType) where.leave_type = leaveType;
        if (status) where.status = status;
        if (leaveReason) where.leave_reason = leaveReason;
        if (vertical) where.vertical = vertical;
        if (year) where.year = year;
        if (month) where.month = month;

        // Count before adding search (for recordsTotal); same user join as the listed rows
        const recordsTotal = await Leave.count({
            where,
            include: [{ model: User, as: 'user', attributes: [], where: { department_id: 9, account_status: 'active' }, required: true }]
        });

        // ---------------------------------------
        // SEARCH FILTER (DataTables global search)
        // ---------------------------------------

        const searchTerm = req.query.search ? req.query.search : '';

        const conditions = [];
        if (searchTerm) {
            const likeTerm = '%' + searchTerm + '%';
            conditions.push({
                [Op.or]: ['leave_day_type', 'leave_type', 'status', 'leave_reason', 'vertical', 'reason', 'remark', 'checker_remark', 'month', 'year', 'day']
                    .map(field => ({ [field]: { [Op.like]: likeTerm } }))
                    .concat([{ '$user.name$': { [Op.like]: likeTerm } }, { '$user.email$': { [Op.like]: likeTerm } }])
            });
        }
        conditions.push(...sequelizeGridConditions(parseGridFilters(req.query), {
            id: 'id',
            user_id: 'user_id',
            name: '$user.name$',
            from_date: 'from_date',
            to_date: 'to_date',
            day: 'day',
            leave_day_type: 'leave_day_type',
            leave_type: 'leave_type',
            status: 'status',
            leave_reason: 'leave_reason',
            vertical: 'vertical',
            days_count: 'days_count',
            reason: 'reason',
            remark: 'remark',
            checker_remark: 'checker_remark',
            month: 'month',
            year: 'year'
        }));
        if (conditions.length) where[Op.and] = conditions;

        const dir = String(req.query.order_dir || '').toUpperCase();
        const sortable = ['id', 'user_id', 'from_date', 'to_date', 'day', 'leave_day_type', 'leave_type', 'status',
            'leave_reason', 'vertical', 'days_count', 'reason', 'remark', 'checker_remark', 'month', 'year'];
        let orderClause = [['from_date', 'DESC'], ['id', 'DESC']];
        if (['ASC', 'DESC'].includes(dir)) {
            if (req.query.order_column === 'name') orderClause = [[{ model: User, as: 'user' }, 'name', dir], ['id', 'DESC']];
            else if (sortable.includes(req.query.order_column)) orderClause = [[req.query.order_column, dir], ['id', 'DESC']];
        }

        // Only leaves of active users in department 9 are listed; count with the same join so
        // pagination matches the rows
        const userInclude = {
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'email'],
            where: {
                department_id: 9,
                account_status: 'active'
            },
            required: true
        };
        const countInclude = { ...userInclude, attributes: [] };

        const [total, summaryRows, leaves] = await Promise.all([
            Leave.count({ where, include: [countInclude] }),
            Leave.findAll({
                attributes: ['leave_day_type', 'leave_type', 'status', [sequelize.fn('COUNT', sequelize.col('Leave.id')), 'count'], [sequelize.fn('SUM', sequelize.col('days_count')), 'days']],
                where,
                include: [countInclude],
                group: ['leave_day_type', 'leave_type', 'status'],
                raw: true
            }),
            Leave.findAll({
                where,
                include: [userInclude],
                order: orderClause,
                ...(limit !== -1 ? { limit, offset } : {})
            })
        ]);

        // KPI summary over all filtered leaves
        const sumWhere = test => summaryRows.filter(test).reduce((acc, row) => acc + Number(row.count || 0), 0);
        const summary = {
            total,
            days: Math.round(summaryRows.reduce((acc, row) => acc + Number(row.days || 0), 0) * 10) / 10,
            full_day: sumWhere(row => row.leave_day_type === 'Full day'),
            half_day: sumWhere(row => row.leave_day_type === 'Half day'),
            short_hours: sumWhere(row => row.leave_day_type === 'Short Hours'),
            wfh: sumWhere(row => row.leave_day_type === 'WFH'),
            planned: sumWhere(row => row.leave_type === 'Planned'),
            unplanned: sumWhere(row => row.leave_type === 'Unplanned'),
            informed: sumWhere(row => row.status === 'Inform'),
            not_informed: sumWhere(row => row.status === 'Not Inform')
        };

        res.json({ success: true, data: leaves, total: total, recordsTotal: recordsTotal, recordsFiltered: total, summary });
    } catch (error) {
        console.error('Error fetching leaves:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const exportLeavesCsv = async (req, res) => {
    try {
        const { startDate, endDate, userId, leaveDayType, leaveType, status, leaveReason, vertical, year, month } = req.query;

        const where = { is_deleted: 0 };
        if (startDate) where.from_date = { ...where.from_date, [Op.gte]: startDate };
        if (endDate) where.to_date = { ...where.to_date, [Op.lte]: endDate };
        if (userId) where.user_id = userId;
        if (leaveDayType) where.leave_day_type = leaveDayType;
        if (leaveType) where.leave_type = leaveType;
        if (status) where.status = status;
        if (leaveReason) where.leave_reason = leaveReason;
        if (vertical) where.vertical = vertical;
        if (year) where.year = year;
        if (month) where.month = month;

        const leaves = await Leave.findAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email'],
                    where: {
                        department_id: 9,
                        account_status: 'active'
                    },
                    required: true
                }
            ],
            order: [['from_date', 'DESC']]
        });

        let csv = 'From Date,To Date,Name,Email,Day,Leave Day Type,Leave Type,Status,Leave Reason,Vertical,Days Count,Reason,Remark,Checker Remark,Month,Year\n';

        leaves.forEach(function (leave) {
            csv += [
                leave.from_date,
                leave.to_date,
                leave.user ? leave.user.name : '',
                leave.user ? leave.user.email : '',
                leave.day || '',
                leave.leave_day_type,
                leave.leave_type,
                leave.status,
                leave.leave_reason,
                leave.vertical || '',
                leave.days_count || 1,
                leave.reason || '',
                (leave.remark || '').replace(/"/g, '""'),
                (leave.checker_remark || '').replace(/"/g, '""'),
                leave.month || '',
                leave.year || ''
            ].map(function (v) {
                if (typeof v === 'string' && v.includes(',')) return '"' + v + '"';
                return v;
            }).join(',') + '\n';
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('leaves_export.csv');
        res.send(csv);
    } catch (error) {
        console.error('Error exporting leaves CSV:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const exportLeavesExcel = async (req, res) => {
    try {
        const { startDate, endDate, userId, leaveDayType, leaveType, status, leaveReason, vertical, year, month } = req.query;

        const where = { is_deleted: 0 };
        if (startDate) where.from_date = { ...where.from_date, [Op.gte]: startDate };
        if (endDate) where.to_date = { ...where.to_date, [Op.lte]: endDate };
        if (userId) where.user_id = userId;
        if (leaveDayType) where.leave_day_type = leaveDayType;
        if (leaveType) where.leave_type = leaveType;
        if (status) where.status = status;
        if (leaveReason) where.leave_reason = leaveReason;
        if (vertical) where.vertical = vertical;
        if (year) where.year = year;
        if (month) where.month = month;

        const leaves = await Leave.findAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email'],
                    where: {
                        department_id: 9,
                        account_status: 'active'
                    },
                    required: true
                }
            ],
            order: [['from_date', 'DESC']]
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Leaves');

        worksheet.columns = [
            { header: 'From Date', key: 'from_date', width: 15 },
            { header: 'To Date', key: 'to_date', width: 15 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Day', key: 'day', width: 15 },
            { header: 'Leave Day Type', key: 'leave_day_type', width: 18 },
            { header: 'Leave Type', key: 'leave_type', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Leave Reason', key: 'leave_reason', width: 20 },
            { header: 'Division', key: 'vertical', width: 20 },
            { header: 'Days Count', key: 'days_count', width: 12 },
            { header: 'Reason', key: 'reason', width: 30 },
            { header: 'Remark', key: 'remark', width: 40 },
            { header: 'Month', key: 'month', width: 15 },
            { header: 'Year', key: 'year', width: 10 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF6366F1' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        leaves.forEach(function (leave) {
            worksheet.addRow({
                from_date: leave.from_date,
                to_date: leave.to_date,
                name: leave.user ? leave.user.name : '',
                email: leave.user ? leave.user.email : '',
                day: leave.day || '',
                leave_day_type: leave.leave_day_type,
                leave_type: leave.leave_type,
                status: leave.status,
                leave_reason: leave.leave_reason,
                vertical: leave.vertical || '',
                days_count: leave.days_count || 1,
                reason: leave.reason || '',
                remark: leave.remark || '',
                month: leave.month || '',
                year: leave.year || ''
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment('leaves_export.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exporting leaves Excel:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getLeaveById = async (req, res) => {
    try {
        const { id } = req.params;
        const leave = await Leave.findOne({
            where: { id, is_deleted: 0 },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email']
                }
            ]
        });

        if (!leave) {
            return res.status(404).json({ success: false, error: 'Leave not found' });
        }

        res.json({ success: true, data: leave });
    } catch (error) {
        console.error('Error fetching leave:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const createLeave = async (req, res) => {
    try {
        const { from_date, to_date, user_id, leave_day_type, leave_type, status, leave_reason, remark, checker_remark, vertical, days_count, reason } = req.body;

        let effectiveToDate = to_date;
        if (leave_day_type !== 'Full day' && leave_day_type !== 'WFH' && from_date) {
            effectiveToDate = from_date;
        }

        // WFH max 2 days validation
        if (leave_day_type === 'WFH' && from_date && to_date) {
            const from = new Date(from_date);
            const to = new Date(to_date);
            const wfhDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
            if (wfhDays > 2) {
                return res.status(400).json({ success: false, error: 'WFH is allowed for a maximum of 2 days' });
            }
        }

        const calcDate = new Date(from_date);
        const month = calcDate.toLocaleString('default', { month: 'long' });
        const year = calcDate.getFullYear();
        const day = calcDate.toLocaleString('default', { weekday: 'long' });

        let calculatedDays = days_count;
        if (from_date && effectiveToDate) {
            const from = new Date(from_date);
            const to = new Date(effectiveToDate);
            const deltaDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
            if (leave_day_type === 'Half day' || leave_day_type === 'Short Hours') {
                calculatedDays = deltaDays * 0.5;
            } else {
                calculatedDays = deltaDays;
            }
        }

        const leave = await Leave.create({
            from_date,
            to_date: effectiveToDate,
            user_id,
            leave_day_type,
            leave_type,
            status,
            leave_reason,
            remark,
            day,
            checker_remark,
            month,
            year,
            vertical,
            days_count: calculatedDays,
            reason
        });

        res.json({ success: true, data: leave, message: 'Leave created successfully' });
    } catch (error) {
        console.error('Error creating leave:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateLeave = async (req, res) => {
    try {
        const { id } = req.params;
        const { from_date, to_date, user_id, leave_day_type, leave_type, status, leave_reason, remark, checker_remark, vertical, days_count, reason } = req.body;

        let effectiveToDate = to_date;
        if (leave_day_type !== 'Full day' && leave_day_type !== 'WFH' && from_date) {
            effectiveToDate = from_date;
        }

        // WFH max 2 days validation
        if (leave_day_type === 'WFH' && from_date && to_date) {
            const from = new Date(from_date);
            const to = new Date(to_date);
            const wfhDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
            if (wfhDays > 2) {
                return res.status(400).json({ success: false, error: 'WFH is allowed for a maximum of 2 days' });
            }
        }

        const calcDate = new Date(from_date);
        const month = calcDate ? calcDate.toLocaleString('default', { month: 'long' }) : undefined;
        const year = calcDate ? calcDate.getFullYear() : undefined;
        const day = calcDate ? calcDate.toLocaleString('default', { weekday: 'long' }) : undefined;

        let calculatedDays = days_count;
        if (from_date && effectiveToDate) {
            const from = new Date(from_date);
            const to = new Date(effectiveToDate);
            const deltaDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
            if (leave_day_type === 'Half day' || leave_day_type === 'Short Hours') {
                calculatedDays = deltaDays * 0.5;
            } else {
                calculatedDays = deltaDays;
            }
        }

        const [affectedRows] = await Leave.update(
            {
                from_date,
                to_date: effectiveToDate,
                user_id,
                leave_day_type,
                leave_type,
                status,
                leave_reason,
                remark,
                day,
                checker_remark,
                month,
                year,
                vertical,
                days_count: calculatedDays,
                reason
            },
            { where: { id, is_deleted: 0 } }
        );

        if (affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Leave not found' });
        }

        const updatedLeave = await Leave.findByPk(id);
        res.json({ success: true, data: updatedLeave, message: 'Leave updated successfully' });
    } catch (error) {
        console.error('Error updating leave:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deleteLeave = async (req, res) => {
    try {
        const { id } = req.params;
        await Leave.update({ is_deleted: 1 }, { where: { id } });
        res.json({ success: true, message: 'Leave soft deleted successfully' });
    } catch (error) {
        console.error('Error deleting leave:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getLeaveKpis = async (req, res) => {
    try {
        const { startDate, endDate, vertical, year, month } = req.query;

        const where = { is_deleted: 0 };
        if (startDate) where.from_date = { ...where.from_date, [Op.gte]: startDate };
        if (endDate) where.to_date = { ...where.to_date, [Op.lte]: endDate };
        if (vertical) where.vertical = vertical;
        if (year) where.year = year;
        if (month) where.month = month;

        const totalLeaves = await Leave.count({ where });
        const fullDayLeaves = await Leave.count({ where: { ...where, leave_day_type: 'Full day' } });
        const halfDayLeaves = await Leave.count({ where: { ...where, leave_day_type: 'Half day' } });
        const shortLeaves = await Leave.count({ where: { ...where, leave_day_type: 'Short Hours' } });
        const wfhLeaves = await Leave.count({ where: { ...where, leave_day_type: 'WFH' } });
        const plannedLeaves = await Leave.count({ where: { ...where, leave_type: 'Planned' } });
        const unplannedLeaves = await Leave.count({ where: { ...where, leave_type: 'Unplanned' } });
        const informedLeaves = await Leave.count({ where: { ...where, status: 'Inform' } });
        const notInformedLeaves = await Leave.count({ where: { ...where, status: 'Not Inform' } });

        const verticalStats = await Leave.findAll({
            where,
            attributes: [
                'vertical',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['vertical'],
            raw: true
        });

        res.json({
            success: true,
            data: {
                totalLeaves,
                fullDayLeaves,
                halfDayLeaves,
                 shortLeaves,
                 wfhLeaves,
                plannedLeaves,
                unplannedLeaves,
                informedLeaves,
                notInformedLeaves,
                verticalStats
            }
        });
    } catch (error) {
        console.error('Error fetching leave KPIs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getLeaveUsers = async (req, res) => {
    try {
        const { page, limit, offset } = req.pagination;

        const where = {
            department_id: 9,
            account_status: 'active'
        };

        // Count before adding search (for recordsTotal)
        const recordsTotal = await User.count({ where });

        const searchTerm = req.query.search ? req.query.search : '';

        if (searchTerm) {
            where[Op.or] = [
                { name: { [Op.like]: '%' + searchTerm + '%' } },
                { email: { [Op.like]: '%' + searchTerm + '%' } }
            ];
        }

        if (req.query.col_searches) {
            try {
                const colSearches = JSON.parse(req.query.col_searches);
                if (colSearches.name) { where.name = { [Op.like]: '%' + colSearches.name + '%' }; }
                if (colSearches.email) { where.email = { [Op.like]: '%' + colSearches.email + '%' }; }
            } catch(e) {
            }
        }

        const allowedSortColumns = ['id', 'name', 'email'];
        let orderByClause = [['name', 'ASC']];
        const orderCol = req.query.order_column;
        const orderDir = req.query.order_dir;
        if (orderCol && allowedSortColumns.includes(orderCol) && orderDir && ['ASC','DESC'].includes(orderDir.toUpperCase())) {
            orderByClause = [[orderCol, orderDir.toUpperCase()]];
        }

        const total = await User.count({ where });

        const users = await User.findAll({
            where,
            attributes: ['id', 'name', 'email'],
            order: orderByClause,
            ...(limit !== -1 ? { limit, offset } : {})
        });

        res.json({ success: true, data: users, total: total, recordsTotal: recordsTotal, recordsFiltered: total });
    } catch (error) {
        console.error('Error fetching leave users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getUserDivision = async (req, res) => {
    try {
        const { userId } = req.params;

        const [divisions] = await sequelize.query(
            `SELECT d.id, d.title as division_name
             FROM user_divisions ud
             JOIN division d ON d.id = ud.division_id
             WHERE ud.user_id = :userId
             LIMIT 1`,
            { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
        );

        if (divisions) {
            res.json({ success: true, data: { division_name: divisions.division_name } });
        } else {
            res.json({ success: true, data: { division_name: '' } });
        }
    } catch (error) {
        console.error('Error fetching user division:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getAdminData = async (req, res) => {
    try {
        const { startDate, endDate, status, priority, requestType, projectType, requester, brand } = req.query;

        const { page, limit, offset } = req.pagination;

        const whereClauses = [];
        const replacements = {};

        // ---------------------------------------
        // WORK REQUEST FILTERS
        // ---------------------------------------

        whereClauses.push(`wr.is_deleted = 0`);

        if (startDate) {
            whereClauses.push(`DATE(wr.created_at) >= :startDate`);
            replacements.startDate = startDate;
        }

        if (endDate) {
            whereClauses.push(`DATE(wr.created_at) <= :endDate`);
            replacements.endDate = endDate;
        }

        if (status) {
            whereClauses.push(`wr.status = :status`);
            replacements.status = status;
        }

        if (priority) {
            whereClauses.push(`wr.priority = :priority`);
            replacements.priority = priority;
        }

        if (requestType) {
            whereClauses.push(`wr.request_type_id = :requestType`);
            replacements.requestType = requestType;
        }

        if (projectType) {
            whereClauses.push(`wr.project_id = :projectType`);
            replacements.projectType = projectType;
        }

        if (requester) {
            whereClauses.push(`wr.user_id = :requester`);
            replacements.requester = requester;
        }

        if (brand) {
            whereClauses.push(`wr.brand = :brand`);
            replacements.brand = brand;
        }


        // ---------------------------------------
        // SEARCH FILTER (DataTables global search)
        // ---------------------------------------

        const searchTerm = req.query.search ? req.query.search : '';

        const colSearchMap = {
            "project_request_status": "wr.status",
            "work_request_id": "CAST(wr.id AS CHAR)",
            "project_name": "wr.project_name",
            "brand": "wr.brand",
            "request_type_name": "rt.request_type",
            "project_type_name": "pt.project_type",
            "project_priority": "wr.priority",
            "project_requester_name": "ru.name",
            // client_division, request_accepted_by, project dates, TATs, counters... are
            // select aliases: they are filtered through the outer query
            "project_count": "CAST(1 AS CHAR)",
            "task_count": "CAST((SELECT COUNT(*) FROM tasks WHERE work_request_id = wr.id AND is_deleted = 0) AS CHAR)",
            "issue_task_count": "CAST((SELECT COUNT(*) FROM issue_assignments ia2 INNER JOIN tasks t4 ON t4.id = ia2.task_id WHERE t4.work_request_id = wr.id AND ia2.is_deleted = 0) AS CHAR)",
            "change_count": "CAST((SELECT COUNT(*) FROM task_history WHERE work_request_id = wr.id AND action = 'manager_change_requested') AS CHAR)",
            "project_deadline": "(SELECT MAX(t2.deadline) FROM tasks t2 WHERE t2.work_request_id = wr.id AND t2.is_deleted = 0)",
            "description": "wr.description",
            "about_project": "wr.about_project",
            "remarks": "wr.remarks",
            "work_request_created_at": "wr.created_at",
            "work_request_updated_at": "wr.updated_at"
        };

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            const searchColumns = [
                'wr.project_name',
                'rt.request_type',
                'pt.project_type',
                'wr.priority',
                'ru.name',
                'wr.status',
                'wr.brand',
                'wr.description',
                'CAST(wr.id AS CHAR)'
            ];
            const searchConditions = searchColumns.map(col => `${col} LIKE :searchTerm`);
            whereClauses.push(`(${searchConditions.join(' OR ')})`);
            replacements.searchTerm = likeTerm;
        }

        // Column filters and sorting are applied once the select list is known (below)
        const gridFilters = parseGridFilters(req.query);

        let query = `
            SELECT

                /* ==================================================
                   PROJECT STATUS
                   ================================================== */
                wr.status AS project_request_status,

                /* ==================================================
                   PROJECT REQUEST ID
                   ================================================== */
                wr.id AS work_request_id,

                /* ==================================================
                   PROJECT NAME
                   ================================================== */
                wr.project_name AS project_name,

                /* ==================================================
                   REQUESTED VERTICAL
                   ================================================== */
                rt.request_type AS request_type_name,

                /* ==================================================
                   PROJECT TYPE
                   ================================================== */
                pt.project_type AS project_type_name,

                /* ==================================================
                   PROJECT PRIORITY
                   ================================================== */
                wr.priority AS project_priority,

                /* ==================================================
                   CLIENT NAME
                   ================================================== */
                ru.name AS project_requester_name,

                /* ==================================================
                   CLIENT DIVISION
                   ================================================== */
                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d.title
                                ORDER BY d.title
                                SEPARATOR ', '
                            )
                            FROM user_divisions ud
                            INNER JOIN division d
                                ON d.id = ud.division_id
                            WHERE ud.user_id = wr.user_id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS client_division,

                /* ==================================================
                   REQUEST ACCEPTED BY / PROJECT MANAGER
                   ================================================== */
                COALESCE(
                    NULLIF(
                        (
                            SELECT COALESCE(
                                NULLIF(TRIM(wrh_accept.actor_name), ''),
                                u_accept.name
                            )
                            FROM work_request_history wrh_accept
                            LEFT JOIN users u_accept
                                ON u_accept.id = wrh_accept.actor_id
                            WHERE wrh_accept.work_request_id = wr.id
                              AND wrh_accept.action = 'manager_accepted'
                              AND wrh_accept.actor_type = 'manager'
                            ORDER BY wrh_accept.created_at ASC
                            LIMIT 1
                        ),
                        ''
                    ),
                    'N/A'
                ) AS request_accepted_by,


                /* ==================================================
                   TASK COUNT / WORK PAGES
                   IMPORTANT:
                   Do NOT SUM(t.task_count) from the main JOIN.
                   It can duplicate because of issue_assignments
                   and task_history joins.
                   ================================================== */

                /* ==================================================
                   NO. OF WORK PAGES
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t2.task_count, 0)
                        )
                        FROM tasks t2
                        WHERE t2.work_request_id = wr.id
                          AND t2.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_work_pages,


                /* ==================================================
                   TOTAL TASKS
                   ================================================== */

                (
                    SELECT COUNT(*)
                    FROM tasks t3
                    WHERE t3.work_request_id = wr.id
                      AND t3.is_deleted = 0
                ) AS task_count,


                /* ==================================================
                   ISSUE WORK PAGES
                   ================================================== */

                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(ia2.task_count, 0)
                        )
                        FROM issue_assignments ia2
                        INNER JOIN tasks t4
                            ON t4.id = ia2.task_id
                           AND t4.is_deleted = 0
                        WHERE t4.work_request_id = wr.id
                          AND ia2.is_deleted = 0
                    ),
                    0
                ) AS issue_no_of_work_pages,


                /* ==================================================
                   PROJECT COUNT
                   ================================================== */

                1 AS project_count,


                /* ==================================================
                   CHANGE COUNT
                   ================================================== */

                (
                    SELECT COUNT(*)
                    FROM task_history th2
                    WHERE th2.work_request_id = wr.id
                      AND th2.action = 'manager_change_requested'
                ) AS change_count,


                /* ==================================================
                   PROJECT START DATE
                   ================================================== */

                (
                    SELECT MIN(t5.start_date)
                    FROM tasks t5
                    WHERE t5.work_request_id = wr.id
                      AND t5.is_deleted = 0
                      AND t5.start_date IS NOT NULL
                ) AS project_start_date,


                /* ==================================================
                   PROJECT END DATE
                   ================================================== */

                (
                    SELECT MAX(
                        CASE
                            WHEN t6.end_date IS NOT NULL
                                 AND ia3.end_date IS NOT NULL
                            THEN GREATEST(
                                t6.end_date,
                                ia3.end_date
                            )

                            WHEN t6.end_date IS NOT NULL
                            THEN t6.end_date

                            WHEN ia3.end_date IS NOT NULL
                            THEN ia3.end_date
                        END
                    )
                    FROM tasks t6
                    LEFT JOIN issue_assignments ia3
                        ON ia3.task_id = t6.id
                       AND ia3.is_deleted = 0
                    WHERE t6.work_request_id = wr.id
                      AND t6.is_deleted = 0
                ) AS project_end_date,

                /* ==================================================
                   CLIENT CHANGE REQUESTED COUNTER
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM issue_history ih
                        WHERE ih.work_request_id = wr.id
                          AND ih.action = 'child_change_request_created'
                          AND ih.actor_type = 'user'
                    ),
                    0
                ) AS client_change_requested_counter,

                /* ==================================================
                   CM CHANGE REQUESTED COUNTER
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM issue_history ih
                        WHERE ih.work_request_id = wr.id
                          AND ih.action = 'child_change_request_created'
                          AND ih.actor_type = 'manager'
                    ),
                    0
                ) AS cm_change_requested_counter,

                /* ==================================================
                   OTHER TASK METRICS
                   ================================================== */

                /* ==================================================
                   NO. OF OPTIONS
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t7.no_of_options_provided, 0)
                        )
                        FROM tasks t7
                        WHERE t7.work_request_id = wr.id
                          AND t7.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_options_provided,


                /* ==================================================
                   NO. OF CONCEPT CREATED
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t8.concept_work, 0)
                        )
                        FROM tasks t8
                        WHERE t8.work_request_id = wr.id
                          AND t8.is_deleted = 0
                    ),
                    0
                ) AS task_concept_work,


                /* ==================================================
                   NO. OF RESIZE PAGES
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t9.no_of_resize, 0)
                        )
                        FROM tasks t9
                        WHERE t9.work_request_id = wr.id
                          AND t9.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_resize,


                /* ==================================================
                   NO. OF WORDS WRITTEN
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t10.no_of_words_written, 0)
                        )
                        FROM tasks t10
                        WHERE t10.work_request_id = wr.id
                          AND t10.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_words_written,


                /* ==================================================
                   NO. OF RESPONSIVE UI CREATED
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t11.no_of_responsive_screen, 0)
                        )
                        FROM tasks t11
                        WHERE t11.work_request_id = wr.id
                          AND t11.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_responsive_screen,


                /* ==================================================
                   NO. OF PRODUCTS USED
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t12.no_of_products_shot, 0)
                        )
                        FROM tasks t12
                        WHERE t12.work_request_id = wr.id
                          AND t12.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_products_shot,


                /* ==================================================
                   INCLUDES SHOOT SETUP
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t13.shoot_setup, 0)
                        )
                        FROM tasks t13
                        WHERE t13.work_request_id = wr.id
                          AND t13.is_deleted = 0
                    ),
                    0
                ) AS task_shoot_setup,


                /* ==================================================
                   NO. OF AI PAGES
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(COALESCE(t_ai_cnt.no_of_images_videos_audio, 0))
                        FROM tasks t_ai_cnt
                        WHERE t_ai_cnt.work_request_id = wr.id
                          AND t_ai_cnt.is_deleted = 0
                    ),
                    0
                ) AS task_no_of_ai_page,


                /* ==================================================
                   VIDEO DURATION
                   ================================================== */
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(t_dur.duration_minutes, 0) * 60
                            + COALESCE(t_dur.duration_seconds, 0)
                        )
                        FROM tasks t_dur
                        WHERE t_dur.work_request_id = wr.id
                          AND t_dur.is_deleted = 0
                    ),
                    0
                )
                +
                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(ia_dur.duration_minutes, 0) * 60
                            + COALESCE(ia_dur.duration_seconds, 0)
                        )
                        FROM issue_assignments ia_dur
                        INNER JOIN tasks t_ia
                            ON t_ia.id = ia_dur.task_id
                           AND t_ia.is_deleted = 0
                        WHERE t_ia.work_request_id = wr.id
                          AND ia_dur.is_deleted = 0
                    ),
                    0
                ) AS video_duration,


                /* ==================================================
                   INCLUDES RESIZE WORK
                   ================================================== */
                COALESCE(
                    (
                        SELECT IF(SUM(COALESCE(t_resize.resize_work, 0)) > 0, 1, 0)
                        FROM tasks t_resize
                        WHERE t_resize.work_request_id = wr.id
                          AND t_resize.is_deleted = 0
                    ),
                    0
                ) AS task_resize_work,


                /* ==================================================
                   INCLUDES AI WORK
                   ================================================== */
                COALESCE(
                    (
                        SELECT IF(SUM(COALESCE(t_ai.no_of_images_videos_audio, 0)) > 0, 1, 0)
                        FROM tasks t_ai
                        WHERE t_ai.work_request_id = wr.id
                          AND t_ai.is_deleted = 0
                    ),
                    0
                ) AS task_ai,


                /* ==================================================
                   PROJECT REQUEST TIMESTAMP
                   ================================================== */
                wr.requested_at AS project_request_timestamp,


                /* ==================================================
                   PROJECT ACCEPTANCE TIMESTAMP
                   ================================================== */
                COALESCE(
                    (
                        SELECT wrh_acc.created_at
                        FROM work_request_history wrh_acc
                        WHERE wrh_acc.work_request_id = wr.id
                          AND wrh_acc.action = 'manager_accepted'
                          AND wrh_acc.actor_type = 'manager'
                        ORDER BY wrh_acc.created_at ASC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_acceptance_timestamp,


                /* ==================================================
                   PROJECT MARKED COMPLETED TIMESTAMP
                   ================================================== */
                COALESCE(
                    (
                        SELECT wrh_comp.created_at
                        FROM work_request_history wrh_comp
                        WHERE wrh_comp.work_request_id = wr.id
                          AND wrh_comp.action = 'completed'
                        ORDER BY wrh_comp.created_at DESC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_marked_completed_timestamp,

                /* ==================================================
                   PROJECT MARKED COMPLETED BY
                   ================================================== */
                COALESCE(
                    (
                        SELECT COALESCE(NULLIF(TRIM(wrh_comp2.actor_name), ''), u_comp.name)
                        FROM work_request_history wrh_comp2
                        LEFT JOIN users u_comp ON u_comp.id = wrh_comp2.actor_id
                        WHERE wrh_comp2.work_request_id = wr.id
                          AND wrh_comp2.action = 'completed'
                        ORDER BY wrh_comp2.created_at DESC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_marked_completed_by,

                /* ==================================================
                   PROJECT COMPLETION TIMESTAMP
                   ================================================== */
                COALESCE(
                    (
                        SELECT wrh_comp_ts.created_at
                        FROM work_request_history wrh_comp_ts
                        WHERE wrh_comp_ts.work_request_id = wr.id
                          AND wrh_comp_ts.action = 'completed'
                        ORDER BY wrh_comp_ts.created_at DESC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_completion_timestamp,


                /* ==================================================
                   PROJECT INTERNAL TAT
                   ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE, wrh_ptat2.created_at, wrh_ptat3.created_at)/60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE, wrh_ptat2.created_at, wrh_ptat3.created_at), 60), 'm'
                        )
                        FROM work_request_history wrh_ptat2
                        JOIN work_request_history wrh_ptat3 ON wrh_ptat3.work_request_id = wrh_ptat2.work_request_id
                        WHERE wrh_ptat2.work_request_id = wr.id
                          AND wrh_ptat2.action = 'manager_accepted'
                          AND wrh_ptat2.actor_type = 'manager'
                          AND wrh_ptat3.action = 'completed'
                        ORDER BY wrh_ptat2.created_at ASC, wrh_ptat3.created_at DESC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS internal_project_tat,


                /* ==================================================
                   PROJECT TAT
                   ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE, wr.requested_at, wrh_ptat.created_at)/60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE, wr.requested_at, wrh_ptat.created_at), 60), 'm'
                        )
                        FROM work_request_history wrh_ptat
                        WHERE wrh_ptat.work_request_id = wr.id
                          AND wrh_ptat.action = 'completed'
                        ORDER BY wrh_ptat.created_at DESC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_tat,


                /* ==================================================
                    PROJECT REQUEST TO RESPONSE TAT
                    ================================================== */
                COALESCE(
                    (
                        /* requested -> first manager acceptance (same as the Clients page);
                           the history has no 'create' / 'pm_approved' actions */
                        SELECT CONCAT(
                            FLOOR(TIMESTAMPDIFF(MINUTE, wr.requested_at, wrh_acc.created_at)/60), 'h ',
                            MOD(TIMESTAMPDIFF(MINUTE, wr.requested_at, wrh_acc.created_at), 60), 'm'
                        )
                        FROM work_request_history wrh_acc
                        WHERE wrh_acc.work_request_id = wr.id
                          AND wrh_acc.action = 'manager_accepted'
                        ORDER BY wrh_acc.created_at ASC
                        LIMIT 1
                    ),
                    'N/A'
                ) AS project_request_to_response_tat,


                /* ==================================================
                    TASK REQUEST TO RESPONSE TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at)), 60), 'm'
                        )
                        FROM task_history th1
                        JOIN task_history th2 ON th2.task_id = th1.task_id
                        JOIN tasks t_t ON t_t.id = th1.task_id
                        WHERE t_t.work_request_id = wr.id
                          AND th1.action = 'created'
                          AND th2.action = 'submitted'
                    ),
                    'N/A'
                ) AS task_request_to_response_tat_avg,


                /* ==================================================
                    TASK ACCEPTANCE TO COMPLETION TAT BY CU AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at)), 60), 'm'
                        )
                        FROM task_history th1
                        JOIN task_history th2 ON th2.task_id = th1.task_id
                        JOIN tasks t_t ON t_t.id = th1.task_id
                        WHERE t_t.work_request_id = wr.id
                          AND th1.action = 'accepted'
                          AND th2.action = 'submitted'
                    ),
                    'N/A'
                ) AS task_acceptance_to_completion_tat_by_cu_avg,


                /* ==================================================
                    TASK OUTPUT SHARED TO RESPONSE BY CM TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at)), 60), 'm'
                        )
                        FROM task_history th1
                        JOIN task_history th2 ON th2.task_id = th1.task_id
                        JOIN tasks t_t ON t_t.id = th1.task_id
                        WHERE t_t.work_request_id = wr.id
                          AND th1.action = 'submitted'
                          AND th1.actor_type = 'user'
                          AND th2.action = 'manager_approved'
                          AND th2.actor_type = 'manager'
                    ),
                    'N/A'
                ) AS task_output_shared_to_response_by_cm_tat_avg,


                /* ==================================================
                    TASK INTERNAL TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at)), 60), 'm'
                        )
                        FROM task_history th1
                        JOIN task_history th2 ON th2.task_id = th1.task_id
                        JOIN tasks t_t ON t_t.id = th1.task_id
                        WHERE t_t.work_request_id = wr.id
                          AND th1.action = 'accepted'
                          AND th2.action = 'submitted'
                    ),
                    'N/A'
                ) AS task_internal_tat_avg,


                /* ==================================================
                    TASK WHOLE TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, th1.created_at, th2.created_at)), 60), 'm'
                        )
                        FROM task_history th1
                        JOIN task_history th2 ON th2.task_id = th1.task_id
                        JOIN tasks t_t ON t_t.id = th1.task_id
                        WHERE t_t.work_request_id = wr.id
                          AND th1.action = 'accepted'
                          AND th2.action = 'pm_approved'
                    ),
                    'N/A'
                ) AS task_whole_tat_avg,


                /* ==================================================
                    CHANGE REQUEST TO RESPONSE TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at)), 60), 'm'
                        )
                        FROM issue_history ih1
                        JOIN issue_history ih2 ON ih2.issue_assignment_id = ih1.issue_assignment_id
                        JOIN issue_assignments ia_ih ON ia_ih.id = ih1.issue_assignment_id
                        JOIN tasks t_ih ON t_ih.id = ia_ih.task_id
                        WHERE t_ih.work_request_id = wr.id
                          AND ih1.action = 'created'
                          AND ih2.action = 'submitted'
                    ),
                    'N/A'
                ) AS change_request_to_response_tat_avg,


                /* ==================================================
                    CHANGE ACCEPTANCE TO COMPLETION TAT BY CU AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at)), 60), 'm'
                        )
                        FROM issue_history ih1
                        JOIN issue_history ih2 ON ih2.issue_assignment_id = ih1.issue_assignment_id
                        JOIN issue_assignments ia_ih ON ia_ih.id = ih1.issue_assignment_id
                        JOIN tasks t_ih ON t_ih.id = ia_ih.task_id
                        WHERE t_ih.work_request_id = wr.id
                          AND ih1.action = 'accepted'
                          AND ih2.action = 'submitted'
                    ),
                    'N/A'
                ) AS change_acceptance_to_completion_tat_by_cu_avg,


                /* ==================================================
                   CHANGE OUTPUT SHARED TO RESPONSE BY CM TAT AVG
                   ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at)), 60), 'm'
                        )
                        FROM issue_history ih1
                        JOIN issue_history ih2 ON ih2.issue_assignment_id = ih1.issue_assignment_id
                        JOIN issue_assignments ia_ih ON ia_ih.id = ih1.issue_assignment_id
                        JOIN tasks t_ih ON t_ih.id = ia_ih.task_id
                        WHERE t_ih.work_request_id = wr.id
                          AND ih1.action = 'shared_for_client_review'
                          AND ih2.action = 'client_approved_issue'
                    ),
                    'N/A'
                ) AS change_output_shared_to_response_by_cm_tat_avg,


                /* ==================================================
                    CHANGE INTERNAL TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at)), 60), 'm'
                        )
                        FROM issue_history ih1
                        JOIN issue_history ih2 ON ih2.issue_assignment_id = ih1.issue_assignment_id
                        JOIN issue_assignments ia_ih ON ia_ih.id = ih1.issue_assignment_id
                        JOIN tasks t_ih ON t_ih.id = ia_ih.task_id
                        WHERE t_ih.work_request_id = wr.id
                          AND ih1.action = 'accepted'
                          AND ih2.action = 'submitted'
                    ),
                    'N/A'
                ) AS change_internal_tat_avg,


                /* ==================================================
                    CHANGE WHOLE TAT AVG
                    ================================================== */
                COALESCE(
                    (
                        SELECT CONCAT(
                            FLOOR(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at))/60), 'h ',
                            MOD(AVG(TIMESTAMPDIFF(MINUTE, ih1.created_at, ih2.created_at)), 60), 'm'
                        )
                        FROM issue_history ih1
                        JOIN issue_history ih2 ON ih2.issue_assignment_id = ih1.issue_assignment_id
                        JOIN issue_assignments ia_ih ON ia_ih.id = ih1.issue_assignment_id
                        JOIN tasks t_ih ON t_ih.id = ia_ih.task_id
                        WHERE t_ih.work_request_id = wr.id
                          AND ih1.action = 'accepted'
                          AND ih2.action = 'pm_approved'
                    ),
                    'N/A'
                ) AS change_whole_tat_avg,


                /* ==================================================
                   PROJECT REQUEST RESPONSE REMINDER COUNTER TO CM
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        WHERE prrh.work_request_id = wr.id
                          AND prrh.task_id IS NULL
                          AND prrh.issue_assignment_id IS NULL
                    ),
                    0
                ) AS project_request_response_reminder_counter_to_cm,

                /* ==================================================
                   TASK REQUEST RESPONSE REMINDER COUNTER TO CU
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN tasks t_tr ON t_tr.id = prrh.task_id
                        WHERE t_tr.work_request_id = wr.id
                          AND prrh.issue_assignment_id IS NULL
                    ),
                    0
                ) AS task_request_response_reminder_counter_to_cu,

                /* ==================================================
                   TASK OUTPUT RESPONSE REMINDER COUNTER TO CM
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN tasks t_tr ON t_tr.id = prrh.task_id
                        WHERE t_tr.work_request_id = wr.id
                          AND prrh.issue_assignment_id IS NULL
                    ),
                    0
                ) AS task_output_response_reminder_counter_to_cm,

                /* ==================================================
                   TASK OUTPUT RESPONSE REMINDER COUNTER TO CLIENT
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN tasks t_tr ON t_tr.id = prrh.task_id
                        WHERE t_tr.work_request_id = wr.id
                          AND prrh.issue_assignment_id IS NULL
                    ),
                    0
                ) AS task_output_response_reminder_counter_to_client,

                /* ==================================================
                   CHANGE REQUEST RESPONSE REMINDER COUNTER TO CU
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN issue_assignments ia_r ON ia_r.id = prrh.issue_assignment_id
                        JOIN tasks t_ir ON t_ir.id = ia_r.task_id
                        WHERE t_ir.work_request_id = wr.id
                    ),
                    0
                ) AS change_request_response_reminder_counter_to_cu,

                /* ==================================================
                   CHNAGE OUTPUT RESPONSE REMINDER COUNTER TO CM
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN issue_assignments ia_r ON ia_r.id = prrh.issue_assignment_id
                        JOIN tasks t_ir ON t_ir.id = ia_r.task_id
                        WHERE t_ir.work_request_id = wr.id
                    ),
                    0
                ) AS chnage_output_response_reminder_counter_to_cm,

                /* ==================================================
                   CHANGE OUTPUT RESPONSE REMINDER COUNTER TO CLIENT
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        JOIN issue_assignments ia_r ON ia_r.id = prrh.issue_assignment_id
                        JOIN tasks t_ir ON t_ir.id = ia_r.task_id
                        WHERE t_ir.work_request_id = wr.id
                    ),
                    0
                ) AS change_output_response_reminder_counter_to_client,

                /* ==================================================
                   PROJECT CLOSURE REMINDER COUNTER TO CLIENT
                   ================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pm_review_reminder_history prrh
                        WHERE prrh.work_request_id = wr.id
                          AND prrh.task_id IS NULL
                          AND prrh.issue_assignment_id IS NULL
                    ),
                    0
                ) AS project_closure_reminder_counter_to_client,


                /* ==================================================
                   MONTH
                   ================================================== */

                CASE
                    WHEN MONTH(wr.created_at) = 1 THEN 'January'
                    WHEN MONTH(wr.created_at) = 2 THEN 'February'
                    WHEN MONTH(wr.created_at) = 3 THEN 'March'
                    WHEN MONTH(wr.created_at) = 4 THEN 'April'
                    WHEN MONTH(wr.created_at) = 5 THEN 'May'
                    WHEN MONTH(wr.created_at) = 6 THEN 'June'
                    WHEN MONTH(wr.created_at) = 7 THEN 'July'
                    WHEN MONTH(wr.created_at) = 8 THEN 'August'
                    WHEN MONTH(wr.created_at) = 9 THEN 'September'
                    WHEN MONTH(wr.created_at) = 10 THEN 'October'
                    WHEN MONTH(wr.created_at) = 11 THEN 'November'
                    WHEN MONTH(wr.created_at) = 12 THEN 'December'
                    ELSE '00'
                END AS month,


                /* ==================================================
                   FINANCIAL YEAR
                   ================================================== */

                CASE
                    WHEN MONTH(wr.created_at) >= 4 THEN
                        CONCAT(
                            'FY ',
                            YEAR(wr.created_at),
                            '-',
                            RIGHT(
                                YEAR(wr.created_at) + 1,
                                2
                            )
                        )

                    ELSE
                        CONCAT(
                            'FY ',
                            YEAR(wr.created_at) - 1,
                            '-',
                            RIGHT(
                                YEAR(wr.created_at),
                                2
                            )
                        )
                END AS fy


            FROM work_requests wr


            LEFT JOIN request_type rt
                ON rt.id = wr.request_type_id


            LEFT JOIN project_type pt
                ON pt.id = wr.project_id


            LEFT JOIN users ru
                ON ru.id = wr.user_id
        `;


        // ---------------------------------------
        // COLUMN FILTERS + SORT
        // Plain columns go into WHERE; computed columns (division, manager, TATs, counters...)
        // are filtered on an outer query over the full select. Any output column can be sorted.
        // ---------------------------------------

        const outputKeys = selectAliases(query.slice(0, query.lastIndexOf('\n            FROM work_requests wr\n')));
        // opened from the Overview: the same team / division / person scope as its cards
        const overviewScope = await gridOverviewScope(req);
        if (overviewScope && overviewScope.error) return res.status(overviewScope.status).json({ success: false, error: overviewScope.error });
        if (overviewScope && overviewScope.sql) {
            whereClauses.push(overviewScope.sql.wr);
            Object.assign(replacements, overviewScope.replacements);
        }
        const outerConditions = applyGridFilters({ filters: gridFilters, directMap: colSearchMap, outerKeys: outputKeys, whereClauses, replacements });
        const sort = resolveSort(req.query, outputKeys);
        const orderByClause = sort ? `${orderSql(sort)}, wr.id DESC` : 'wr.created_at DESC';


        // ---------------------------------------
        // WHERE
        // ---------------------------------------

        if (whereClauses.length > 0) {
            query += `
                WHERE ${whereClauses.join(' AND ')}
            `;
        }

        // Status counts for the KPI cards (same keys in both query paths)
        const statusSummary = (status) => ({
            completed_count: `SUM(CASE WHEN ${status} = 'completed' THEN 1 ELSE 0 END)`,
            in_progress_count: `SUM(CASE WHEN ${status} = 'in_progress' THEN 1 ELSE 0 END)`,
            pending_count: `SUM(CASE WHEN ${status} = 'pending' THEN 1 ELSE 0 END)`,
            ...statusCountSql(status, WORK_REQUEST_STATUSES)
        });

        let total, completedCount, inProgressCount, pendingCount, statusRow, results;

        if (outerConditions.length > 0) {
            const outer = await runOuterQuery({
                innerSql: query,
                replacements,
                outerConditions,
                sort,
                defaultOrder: 'x.project_request_timestamp DESC, x.work_request_id DESC',
                limit,
                offset,
                summary: statusSummary('x.project_request_status')
            });
            total = outer.total;
            statusRow = outer.summary;
            // keep the count types of the plain path (MySQL SUM returns strings there)
            completedCount = String(statusRow.completed_count);
            inProgressCount = String(statusRow.in_progress_count);
            pendingCount = String(statusRow.pending_count);
            results = outer.rows;
        } else {

            // ---------------------------------------
            // ORDER
            // ---------------------------------------

            query += `
                ORDER BY ${orderByClause}
            `;

            if (limit !== -1) {
                query += `
                    LIMIT :limit OFFSET :offset
                `;
                replacements.limit = limit;
                replacements.offset = offset;
            }


            // ---------------------------------------
            // COUNT QUERY (total filtered rows + status summary)
            // ---------------------------------------

            // Count for filtered data (with search + column filters)
            const countQuery = `
                SELECT
                    COUNT(*) AS total,
                    ${Object.entries(statusSummary('wr.status')).map(([key, sql]) => `${sql} AS ${key}`).join(',\n                    ')}
                FROM work_requests wr
                LEFT JOIN request_type rt ON rt.id = wr.request_type_id
                LEFT JOIN project_type pt ON pt.id = wr.project_id
                LEFT JOIN users ru ON ru.id = wr.user_id
                ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''}
            `;

            const countResult = await sequelize.query(countQuery, {
                replacements,
                type: sequelize.QueryTypes.SELECT
            });

            statusRow = countResult[0] || {};
            total = statusRow.total || 0;
            completedCount = statusRow.completed_count || 0;
            inProgressCount = statusRow.in_progress_count || 0;
            pendingCount = statusRow.pending_count || 0;


            // ---------------------------------------
            // EXECUTE QUERY
            // ---------------------------------------

            results = await sequelize.query(query, {
                replacements,
                type: sequelize.QueryTypes.SELECT
            });
        }

        // Count for total data (only is_deleted filter)
        const totalResult = await sequelize.query(`
            SELECT COUNT(*) AS total FROM work_requests wr WHERE wr.is_deleted = 0
        `, {
            replacements: {},
            type: sequelize.QueryTypes.SELECT
        });

        const recordsTotal = totalResult[0]?.total || 0;

        const columnOrder = [
            'project_request_status',
            'work_request_id',
            'project_name',
            'request_type_name',
            'project_type_name',
            'project_priority',
            'project_requester_name',
            'client_division',
            'request_accepted_by',
            'project_count',
            'task_count',
            'change_count',
            'project_start_date',
            'project_end_date',
            'client_change_requested_counter',
            'cm_change_requested_counter',
            'task_no_of_work_pages',
            'issue_no_of_work_pages',
            'task_no_of_options_provided',
            'task_concept_work',
            'task_no_of_resize',
            'task_no_of_ai_page',
            'video_duration',
            'task_no_of_products_shot',
            'task_no_of_words_written',
            'task_no_of_responsive_screen',
            'task_resize_work',
            'task_ai',
            'task_shoot_setup',
            'project_request_timestamp',
            'project_acceptance_timestamp',
            'project_marked_completed_timestamp',
            'project_marked_completed_by',
            'internal_project_tat',
            'project_tat',
            'project_request_to_response_tat',
            'task_request_to_response_tat_avg',
            'task_acceptance_to_completion_tat_by_cu_avg',
            'task_output_shared_to_response_by_cm_tat_avg',
            'task_internal_tat_avg',
            'task_whole_tat_avg',
            'change_request_to_response_tat_avg',
            'change_acceptance_to_completion_tat_by_cu_avg',
            'change_output_shared_to_response_by_cm_tat_avg',
            'change_internal_tat_avg',
            'change_whole_tat_avg',
            'project_request_response_reminder_counter_to_cm',
            'task_request_response_reminder_counter_to_cu',
            'task_output_response_reminder_counter_to_cm',
            'task_output_response_reminder_counter_to_client',
            'change_request_response_reminder_counter_to_cu',
            'chnage_output_response_reminder_counter_to_cm',
            'change_output_response_reminder_counter_to_client',
            'project_closure_reminder_counter_to_client',
            'month',
            'fy'
        ];

        const orderedResults = results.map(function (row) {
            const orderedRow = {};

            columnOrder.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(row, key)) {
                    orderedRow[key] = row[key];
                }
            });

            Object.keys(row).forEach(function (key) {
                if (!Object.prototype.hasOwnProperty.call(orderedRow, key)) {
                    orderedRow[key] = row[key];
                }
            });

            return orderedRow;
        });


        // ---------------------------------------
        // RESPONSE
        // ---------------------------------------

        res.json({
            data: orderedResults,
            total: total,
            page: page,
            limit: limit,
            totalPages: limit === -1 ? 1 : Math.ceil(total / limit),
            recordsTotal: recordsTotal,
            recordsFiltered: total,
            summary: {
                completed: completedCount,
                in_progress: inProgressCount,
                pending: pendingCount,
                total: Number(total),
                status_counts: statusCountsFrom(statusRow, WORK_REQUEST_STATUSES)
            }
        });


    } catch (error) {

        console.error(
            'Error fetching admin data:',
            error
        );

        res.status(500).json({
            error: 'Internal server error'
        });
    }
};

const getClientsData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const { page, limit, offset } = req.pagination;

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

        // ==========================================
        // SEARCH FILTER (DataTables global search)
        // ==========================================

        const searchTerm = req.query.search ? req.query.search : '';

        const colSearchMap = {
            "work_request_created_at": "wr.created_at",
            "work_request_id": "CAST(wr.id AS CHAR)",
            "project_name": "wr.project_name",
            "request_type_name": "rt.request_type",
            "project_type_name": "pt.project_type",
            "project_priority": "wr.priority",
            "project_requester_name": "ru.name",
            "project_count": "CAST(1 AS CHAR)",
            "project_status": "wr.status",
            "description": "wr.description",
            "project_requested_at_client": "wr.requested_at"
            // client_division, manager, deferral_count, response time, TAT, month and
            // financial_year are select aliases: filtered through the outer query
        };

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            const searchColumns = [
                'wr.project_name',
                'rt.request_type',
                'pt.project_type',
                'wr.priority',
                'ru.name',
                'wr.status',
                'wr.description',
                'CAST(wr.id AS CHAR)'
            ];
            const searchConditions = searchColumns.map(col => `${col} LIKE :searchTerm`);
            whereClauses.push(`(${searchConditions.join(' OR ')})`);
            replacements.searchTerm = likeTerm;
        }

        // Column filters and sorting are applied once the select list is known (below)
        const gridFilters = parseGridFilters(req.query);

        let query = `
            SELECT
                /* =====================================================
                   PROJECT REQUEST ID
                   ===================================================== */
                wr.id AS work_request_id,

                /* =====================================================
                   PROJECT NAME
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(wr.project_name), ''),
                    'N/A'
                ) AS project_name,

                /* =====================================================
                   REQUESTED VERTICAL
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(rt.request_type), ''),
                    'N/A'
                ) AS request_type_name,

                /* =====================================================
                   PROJECT TYPE
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(pt.project_type), ''),
                    'N/A'
                ) AS project_type_name,

                /* =====================================================
                   PROJECT PRIORITY
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(wr.priority), ''),
                    'N/A'
                ) AS project_priority,

                /* =====================================================
                   CLIENT NAME
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(ru.name), ''),
                    'N/A'
                ) AS project_requester_name,

                /* =====================================================
                   CLIENT DIVISION
                   ===================================================== */
                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d.title
                                ORDER BY d.title
                                SEPARATOR ', '
                            )
                            FROM user_divisions ud
                            JOIN division d
                                ON d.id = ud.division_id
                            WHERE ud.user_id = ru.id
                        ),
                    ''),
                    'N/A'
                ) AS client_division,

                /* =====================================================
                   REQUEST ACCEPTED BY / PROJECT MANAGER
                   ===================================================== */
                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT mu2.name
                                ORDER BY mu2.name
                                SEPARATOR ', '
                            )
                            FROM work_request_managers wrm2
                            JOIN users mu2
                                ON mu2.id = wrm2.manager_id
                            WHERE wrm2.work_request_id = wr.id
                        ),
                    ''),
                    'N/A'
                ) AS digi_vertical_manager_name,

                /* =====================================================
                   PROJECT COUNT
                   ===================================================== */
                1 AS project_count,

                /* =====================================================
                   DEFERRAL COUNT
                   ===================================================== */
                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM work_request_history wrh_deferral
                        WHERE wrh_deferral.work_request_id = wr.id
                          AND wrh_deferral.action = 'manager_deferred_reassigned'
                          AND wrh_deferral.actor_type = 'manager'
                    ),
                    0
                ) AS deferral_count,

                /* =====================================================
                   PROJECT STATUS
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(wr.status), ''),
                    '00h 00m'
                ) AS project_status,

                /* =====================================================
                   STATUS DESCRIPTION
                   ===================================================== */
                COALESCE(
                    NULLIF(TRIM(wr.description), ''),
                    'N/A'
                ) AS description,

                /* =====================================================
                   PROJECT END DATE
                   ===================================================== */

                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM tasks t2
                        WHERE t2.work_request_id = wr.id
                          AND t2.is_deleted = 0
                          AND t2.end_date IS NULL
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM issue_assignments ia2
                        JOIN tasks t3
                            ON t3.id = ia2.task_id
                           AND t3.is_deleted = 0
                        WHERE t3.work_request_id = wr.id
                          AND ia2.is_deleted = 0
                          AND ia2.end_date IS NULL
                    )
                    THEN NULL
                    ELSE COALESCE(
                        (
                            SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                            FROM tasks t2
                            LEFT JOIN issue_assignments ia2
                                ON ia2.task_id = t2.id
                               AND ia2.is_deleted = 0
                            WHERE t2.work_request_id = wr.id
                              AND t2.is_deleted = 0
                        ),
                        NULL
                    )
                END AS project_end_date,

                /* =====================================================
                   POWER BI DATE/TIME
                   Return actual DATETIME or NULL
                   ===================================================== */

                wr.requested_at AS project_requested_at_client,

                /* =====================================================
                   RESPONSE TIMESTAMP
                   ===================================================== */

                (
                    SELECT wrh.created_at
                    FROM work_request_history wrh
                    WHERE wrh.work_request_id = wr.id
                      AND wrh.action = 'manager_accepted'
                    ORDER BY wrh.created_at ASC
                    LIMIT 1
                 ) AS response_timestamp,

                /* =====================================================
                   MONTH
                   ===================================================== */

                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM tasks t2
                        WHERE t2.work_request_id = wr.id
                          AND t2.is_deleted = 0
                          AND t2.end_date IS NULL
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM issue_assignments ia2
                        JOIN tasks t3
                            ON t3.id = ia2.task_id
                           AND t3.is_deleted = 0
                        WHERE t3.work_request_id = wr.id
                          AND ia2.is_deleted = 0
                          AND ia2.end_date IS NULL
                    )
                    THEN '00'
                    ELSE COALESCE(
                        DATE_FORMAT(
                            (
                                SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                FROM tasks t2
                                LEFT JOIN issue_assignments ia2
                                    ON ia2.task_id = t2.id
                                   AND ia2.is_deleted = 0
                                WHERE t2.work_request_id = wr.id
                                  AND t2.is_deleted = 0
                            ),
                            '%M'
                        ),
                        '00'
                    )
                END AS month,

                 /* =====================================================
                    FINANCIAL YEAR
                    ===================================================== */

                COALESCE(
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM tasks t2
                            WHERE t2.work_request_id = wr.id
                              AND t2.is_deleted = 0
                              AND t2.end_date IS NULL
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM issue_assignments ia2
                            JOIN tasks t3
                                ON t3.id = ia2.task_id
                               AND t3.is_deleted = 0
                            WHERE t3.work_request_id = wr.id
                              AND ia2.is_deleted = 0
                              AND ia2.end_date IS NULL
                        )
                        THEN '00'
                        ELSE (
                            CASE
                                WHEN MONTH(
                                    (
                                        SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                        FROM tasks t2
                                        LEFT JOIN issue_assignments ia2
                                            ON ia2.task_id = t2.id
                                           AND ia2.is_deleted = 0
                                        WHERE t2.work_request_id = wr.id
                                          AND t2.is_deleted = 0
                                    )
                                ) >= 4

                                THEN CONCAT(
                                    'FY ',
                                    YEAR(
                                        (
                                            SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                            FROM tasks t2
                                            LEFT JOIN issue_assignments ia2
                                                ON ia2.task_id = t2.id
                                               AND ia2.is_deleted = 0
                                            WHERE t2.work_request_id = wr.id
                                              AND t2.is_deleted = 0
                                        )
                                    ),
                                    '-',
                                    RIGHT(
                                        YEAR(
                                            (
                                                SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                                FROM tasks t2
                                                LEFT JOIN issue_assignments ia2
                                                    ON ia2.task_id = t2.id
                                                   AND ia2.is_deleted = 0
                                                WHERE t2.work_request_id = wr.id
                                                  AND t2.is_deleted = 0
                                            )
                                        ) + 1,
                                        2
                                    )
                                )

                                ELSE CONCAT(
                                    'FY ',
                                    YEAR(
                                        (
                                            SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                            FROM tasks t2
                                            LEFT JOIN issue_assignments ia2
                                                ON ia2.task_id = t2.id
                                               AND ia2.is_deleted = 0
                                            WHERE t2.work_request_id = wr.id
                                              AND t2.is_deleted = 0
                                        )
                                    ) - 1,
                                    '-',
                                    RIGHT(
                                        YEAR(
                                            (
                                                SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                                                FROM tasks t2
                                                LEFT JOIN issue_assignments ia2
                                                    ON ia2.task_id = t2.id
                                                   AND ia2.is_deleted = 0
                                                WHERE t2.work_request_id = wr.id
                                                  AND t2.is_deleted = 0
                                            )
                                        ),
                                        2
                                    )
                                )
                            END
                        )
                    END,
                    '00'
                ) AS financial_year,

                /* =====================================================
                   REQUEST TO RESPONSE TAT
                   Duration field - kept as text
                   ===================================================== */

                CASE
                    WHEN wr.requested_at IS NOT NULL
                     AND (
                        SELECT wrh2.created_at
                        FROM work_request_history wrh2
                        WHERE wrh2.work_request_id = wr.id
                          AND wrh2.action = 'manager_accepted'
                        ORDER BY wrh2.created_at ASC
                        LIMIT 1
                     ) IS NOT NULL

                    THEN CONCAT(
                        FLOOR(
                            TIMESTAMPDIFF(
                                MINUTE,
                                wr.requested_at,
                                (
                                    SELECT wrh3.created_at
                                    FROM work_request_history wrh3
                                    WHERE wrh3.work_request_id = wr.id
                                      AND wrh3.action = 'manager_accepted'
                                    ORDER BY wrh3.created_at ASC
                                    LIMIT 1
                                )
                            ) / 60
                        ),
                        'h ',
                        MOD(
                            TIMESTAMPDIFF(
                                MINUTE,
                                wr.requested_at,
                                (
                                    SELECT wrh4.created_at
                                    FROM work_request_history wrh4
                                    WHERE wrh4.work_request_id = wr.id
                                      AND wrh4.action = 'manager_accepted'
                                    ORDER BY wrh4.created_at ASC
                                    LIMIT 1
                                )
                            ),
                            60
                        ),
                        'm'
                    )

                    ELSE '00h 00m'
                END AS request_to_response_tat

            FROM work_requests wr

            LEFT JOIN request_type rt
                ON rt.id = wr.request_type_id

            LEFT JOIN project_type pt
                ON pt.id = wr.project_id

            LEFT JOIN users ru
                ON ru.id = wr.user_id
        `;

        // Column filters: plain columns in WHERE, computed columns on an outer query over the
        // full select. Any output column can be sorted.
        const outputKeys = selectAliases(query.slice(0, query.lastIndexOf('\n            FROM work_requests wr\n')));
        const outerConditions = applyGridFilters({ filters: gridFilters, directMap: colSearchMap, outerKeys: outputKeys, whereClauses, replacements });
        const sort = resolveSort(req.query, outputKeys);
        const orderByClause = sort ? `${orderSql(sort)}, wr.id DESC` : 'wr.requested_at DESC';

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // KPI summary over all filtered rows. The average response TAT is computed from the select
        // list, so it always reads the full query as a derived table.
        const summarySql = (c) => ({
            clients_count: `COUNT(DISTINCT NULLIF(${c.client}, ''))`,
            pending_count: `SUM(CASE WHEN ${c.status} = 'pending' THEN 1 ELSE 0 END)`,
            ...statusCountSql(c.status, WORK_REQUEST_STATUSES)
        });
        const buildSummary = (row, total, avgTat) => ({
            total: Number(total),
            clients: Number(row.clients_count || 0),
            pending: Number(row.pending_count || 0),
            avg_response_tat_hours: avgTat === null || avgTat === undefined ? null : Math.round(Number(avgTat) * 10) / 10,
            status_counts: statusCountsFrom(row, WORK_REQUEST_STATUSES)
        });
        const avgTatQuery = (whereSql) => sequelize.query(
            `SELECT AVG(${tatHoursSql('x.request_to_response_tat')}) AS avg_tat FROM (${query}) x ${whereSql}`,
            { replacements, type: sequelize.QueryTypes.SELECT }
        );

        if (outerConditions.length > 0) {
            const [outer, avgRows] = await Promise.all([
                runOuterQuery({
                    innerSql: query,
                    replacements,
                    outerConditions,
                    sort,
                    defaultOrder: 'x.project_requested_at_client DESC, x.work_request_id DESC',
                    limit,
                    offset,
                    summary: summarySql({ client: 'x.project_requester_name', status: 'x.project_status' })
                }),
                avgTatQuery(`WHERE ${outerConditions.join(' AND ')}`)
            ]);
            return res.json({
                data: outer.rows,
                total: outer.total,
                recordsTotal: outer.total,
                recordsFiltered: outer.total,
                summary: buildSummary(outer.summary, outer.total, avgRows[0] && avgRows[0].avg_tat)
            });
        }

        // All joins are one-to-one, so count over FROM/WHERE without evaluating the select list
        const fromWhereSql = query.slice(query.lastIndexOf('\n            FROM work_requests wr\n'));
        // Also returns the KPI summary over all filtered rows
        const countQuery = `
            SELECT
                COUNT(*) AS total,
                ${Object.entries(summarySql({ client: 'ru.name', status: 'wr.status' })).map(([key, sql]) => `${sql} AS ${key}`).join(',\n                ')}
            ${fromWhereSql}`;
        const avgTatPromise = avgTatQuery('');

        query += `
            ORDER BY ${orderByClause}
        `;

        const countResult = await sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT });
        const total = countResult[0]?.total || 0;
        const avgRows = await avgTatPromise;
        const summary = buildSummary(countResult[0] || {}, total, avgRows[0] && avgRows[0].avg_tat);

        if (limit !== -1) {
            query += ` LIMIT :limit OFFSET :offset`;
            replacements.limit = limit;
            replacements.offset = offset;
        }

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({
            data: results,
            total: total,
            recordsTotal: total,
            recordsFiltered: total,
            summary
        });

    } catch (error) {
        console.error('Error fetching clients data:', error);

        res.status(500).json({
            error: 'Internal server error'
        });
    }
};

const getTaskDetailsData = async (req, res) => {
    try {

        const { taskStatus } = req.query;
        const { page, limit, offset } = req.pagination;

        const replacements = {};
        const whereClauses = [];

        // ==========================================
        // SEARCH FILTER (DataTables global search)
        // ==========================================

        const searchTerm = req.query.search ? req.query.search : '';

        const colSearchMap = {
            "task_created_at": "t.created_at",
            "task_status": "t.status",
            "work_request_id": "CAST(wr.id AS CHAR)",
            "task_id": "CAST(t.id AS CHAR)",
            "task_name": "t.task_name",
            "task_type_name": "tt.task_type",
            "task_requester_name": "ru.name",
            "client_division": "(SELECT GROUP_CONCAT(d_search.title) FROM user_divisions ud_search JOIN division d_search ON d_search.id = ud_search.division_id WHERE ud_search.user_id = ru.id)",
            "task_no_of_work_pages": "CAST(COALESCE(t.task_count, 0) AS CHAR)",
            "task_no_of_resize": "CAST(COALESCE(t.no_of_resize, 0) AS CHAR)",
            "task_no_of_ai_page": "CAST(COALESCE(t.no_of_images_videos_audio, 0) AS CHAR)",
            "video_duration": "CAST(COALESCE(t.duration_minutes * 60 + t.duration_seconds, 0) AS CHAR)",
            "task_no_of_options_provided": "CAST(COALESCE(t.no_of_options_provided, 0) AS CHAR)",
            "task_concept_work": "CAST(COALESCE(t.concept_work, 0) AS CHAR)",
            "task_no_of_concepts": "CAST(COALESCE(t.no_of_concepts, 0) AS CHAR)",
            "task_resize_work": "CAST(COALESCE(t.resize_work, 0) AS CHAR)",
            "task_ai": "CAST(COALESCE(t.no_of_images_videos_audio, 0) AS CHAR)",
            "task_shoot_setup": "CAST(COALESCE(t.shoot_setup, 0) AS CHAR)",
            "month": "MONTH(t.end_date)",
            // Financial year of the task deadline (same text as the fy column, e.g. "FY 2026-27")
            "fy": "COALESCE(CASE WHEN MONTH(t.deadline) >= 4 THEN CONCAT('FY ', YEAR(t.deadline), '-', RIGHT(YEAR(t.deadline) + 1, 2)) ELSE CONCAT('FY ', YEAR(t.deadline) - 1, '-', RIGHT(YEAR(t.deadline), 2)) END, '00')"
        };

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            const searchColumns = [
                't.task_name',
                'tt.task_type',
                'wr.id',
                'ru.name',
                't.status'
            ];
            const searchConditions = searchColumns.map(col => `${col} LIKE :searchTerm`);
            whereClauses.push(`(${searchConditions.join(' OR ')})`);
            replacements.searchTerm = likeTerm;
        }

        // Column filters (col_searches / col_exact / col_ranges) are applied once the select
        // list is known, see "COLUMN FILTERS" below
        const gridFilters = parseGridFilters(req.query);
        const isAdmin = await isAdminRequest(req);


        // ==========================================
        // TASK STATUS FILTER
        // ==========================================

        if (taskStatus) {
            whereClauses.push('t.status = :taskStatus');
            replacements.taskStatus = taskStatus;
        }


        // ==========================================
        // MAIN QUERY
        // ==========================================

        const selectSql = `
            SELECT

                COALESCE(
                    NULLIF(TRIM(t.status), ''),
                    '00h 00m'
                ) AS task_status,

                wr.id AS work_request_id,

                t.id AS task_id,


                /* ==========================================
                   CHANGE ID
                   ========================================== */

                COALESCE(
                    (
                        SELECT GROUP_CONCAT(
                            DISTINCT ia_change.id
                            ORDER BY ia_change.id
                            SEPARATOR ', '
                        )
                        FROM issue_assignments ia_change
                        WHERE ia_change.task_id = t.id
                          AND ia_change.is_deleted = 0
                    ),
                    ''
                ) AS change_id,


                /* ==========================================
                   TASK NAME
                   ========================================== */

                COALESCE(
                    NULLIF(TRIM(t.task_name), ''),
                    'N/A'
                ) AS task_name,


                /* ==========================================
                   TASK TYPE
                   ========================================== */

                COALESCE(
                    NULLIF(TRIM(tt.task_type), ''),
                    'N/A'
                ) AS task_type_name,


                /* ==========================================
                   REQUESTER
                   ========================================== */

                COALESCE(
                    NULLIF(TRIM(ru.name), ''),
                    'N/A'
                ) AS task_requester_name,


                /* ==========================================
                   CLIENT DIVISION
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d.title
                                ORDER BY d.title
                                SEPARATOR ', '
                            )
                            FROM user_divisions ud
                            JOIN division d
                                ON d.id = ud.division_id
                            WHERE ud.user_id = ru.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS client_division,


                /* ==========================================
                   PROJECT MANAGER
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT mu2.name
                                ORDER BY mu2.name
                                SEPARATOR ', '
                            )
                            FROM work_request_managers wrm2
                            JOIN users mu2
                                ON mu2.id = wrm2.manager_id
                            WHERE wrm2.work_request_id = wr.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS project_manager,


                /* ==========================================
                   PROJECT MANAGER VERTICAL
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d2.title
                                ORDER BY d2.title
                                SEPARATOR ', '
                            )
                            FROM work_request_managers wrm3
                            JOIN users mu3
                                ON mu3.id = wrm3.manager_id
                            JOIN user_divisions ud3
                                ON ud3.user_id = mu3.id
                            JOIN division d2
                                ON d2.id = ud3.division_id
                            WHERE wrm3.work_request_id = wr.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS project_manager_vertical,


                /* ==========================================
                   TASK MANAGER VERTICAL
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d3.title
                                ORDER BY d3.title
                                SEPARATOR ', '
                            )
                            FROM task_assignments ta4
                            JOIN users au3
                                ON au3.id = ta4.user_id
                            JOIN user_divisions ud5
                                ON ud5.user_id = au3.id
                            JOIN division d3
                                ON d3.id = ud5.division_id
                            WHERE ta4.task_id = t.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS task_manager_vertical,


                /* ==========================================
                   TASK MANAGER
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT mu4.name
                                ORDER BY mu4.name
                                SEPARATOR ', '
                            )
                            FROM task_assignments ta4
                            JOIN users au3
                                ON au3.id = ta4.user_id
                            JOIN user_divisions ud5
                                ON ud5.user_id = au3.id
                            JOIN division d3
                                ON d3.id = ud5.division_id
                            JOIN user_divisions ud6
                                ON ud6.division_id = d3.id
                            JOIN users mu4
                                ON mu4.id = ud6.user_id
                            JOIN job_role jr
                                ON jr.id = mu4.job_role_id
                            WHERE ta4.task_id = t.id
                              AND jr.role_title = 'Creative Manager'
                        ),
                        ''
                    ),
                    'N/A'
                ) AS task_manager,


                /* ==========================================
                   ASSIGNED CREATIVE USER
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT au.name
                                ORDER BY au.name
                                SEPARATOR ', '
                            )
                            FROM task_assignments ta2
                            JOIN users au
                                ON au.id = ta2.user_id
                            WHERE ta2.task_id = t.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS assigned_creative_user,


                /* ==========================================
                   CREATIVE USER VERTICAL
                   ========================================== */

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d2.title
                                ORDER BY d2.title
                                SEPARATOR ', '
                            )
                            FROM task_assignments ta3
                            JOIN user_divisions ud2
                                ON ud2.user_id = ta3.user_id
                            JOIN division d2
                                ON d2.id = ud2.division_id
                            WHERE ta3.task_id = t.id
                        ),
                        ''
                    ),
                    'N/A'
                ) AS cu_vertical,


                /* ==========================================
                   DATE FIELDS
                   ========================================== */

                t.start_date AS task_start_date,

                t.end_date AS task_end_date,

                t.deadline AS task_deadline,


                /* ==========================================
                   TASK WORK PAGES
                   ========================================== */

                COALESCE(
                    t.task_count,
                    0
                ) AS task_no_of_work_pages,


                COALESCE(
                    t.task_count * mc.new_work_rate,
                    0
                ) AS task_cost,


                /* ==========================================

                   ISSUE WORK PAGES
                   
                   IMPORTANT:
                   SUM(issue_assignments.task_count) of every
                   change on this task (ia.is_deleted = 0,
                   any status, any financial year; the same
                   changes as change_cost)
                   ========================================== */

                COALESCE(
                    (
                        SELECT SUM(
                            COALESCE(ia_issue.task_count, 0)
                        )
                        FROM issue_assignments ia_issue
                        WHERE ia_issue.task_id = t.id
                          AND ia_issue.is_deleted = 0
                    ),
                    0
                ) AS issue_no_of_work_pages,


                /* ==========================================
                   OTHER TASK METRICS
                   ========================================== */

                COALESCE(
                    t.no_of_options_provided,
                    0
                ) AS task_no_of_options_provided,

                COALESCE(
                    t.concept_work,
                    0
                ) AS task_concept_work,


                COALESCE(
                    t.no_of_concepts,
                    0
                ) AS task_no_of_concepts,


                COALESCE(
                    t.concept_work * t.no_of_concepts * mc.concept_charge,
                    0
                ) AS concept_work_cost,

                COALESCE(
                    t.no_of_resize,
                    0
                ) AS task_no_of_resize,

                COALESCE(
                    t.no_of_images_videos_audio,
                    0
                ) AS task_no_of_ai_page,


                COALESCE(
                    t.no_of_images_videos_audio * mc.ai_charges,
                    0
                ) AS ai_charges_cost,

                COALESCE(
                    t.duration_minutes * 60 +
                    t.duration_seconds,
                    0
                ) AS video_duration,

                COALESCE(
                    t.no_of_products_shot,
                    0
                ) AS task_no_of_products_shot,

                COALESCE(
                    t.no_of_words_written,
                    0
                ) AS task_no_of_words_written,

                COALESCE(
                    t.no_of_responsive_screen,
                    0
                ) AS task_no_of_responsive_screen,

                COALESCE(
                    t.resize_work,
                    0
                ) AS task_resize_work,


                COALESCE(
                    t.resize_work * mc.new_work_rate * (1 + mc.no_of_resize_pages / 100) * t.no_of_resize,
                    0
                ) AS resize_work_cost,


                /* ==========================================
                   CHANGE COST: every change request of this task
                   (not deleted), same rates as the Changes page
                   ========================================== */

                ROUND(COALESCE(
                    (
                        SELECT SUM(${changeCostSql('ia_c', 'mc')})
                        FROM issue_assignments ia_c
                        WHERE ia_c.task_id = t.id
                          AND ia_c.is_deleted = 0
                    ),
                    0
                ), 2) AS change_cost,


                /* ==========================================
                   TOTAL COST = task work (pages, concepts,
                   AI, resize) + all its changes
                   ========================================== */

                ROUND(
                    COALESCE(t.task_count * mc.new_work_rate, 0)
                    + COALESCE(t.concept_work * t.no_of_concepts * mc.concept_charge, 0)
                    + COALESCE(t.no_of_images_videos_audio * mc.ai_charges, 0)
                    + COALESCE(t.resize_work * mc.new_work_rate * (1 + mc.no_of_resize_pages / 100) * t.no_of_resize, 0)
                    + COALESCE(
                        (
                            SELECT SUM(${changeCostSql('ia_c2', 'mc')})
                            FROM issue_assignments ia_c2
                            WHERE ia_c2.task_id = t.id
                              AND ia_c2.is_deleted = 0
                        ),
                        0
                    ),
                    2
                ) AS total_cost,

                COALESCE(
                    t.no_of_images_videos_audio,
                    0
                ) AS task_ai,

                COALESCE(
                    t.shoot_setup,
                    0
                ) AS task_shoot_setup,


                /* ==========================================
                   TASK REQUEST TIMESTAMP
                   ========================================== */

                (
                    SELECT MIN(created_at)
                    FROM task_history
                    WHERE task_id = t.id
                      AND action = 'created'
                ) AS task_request_timestamp,


                /* ==========================================
                   TASK ACCEPTED TIMESTAMP
                   ========================================== */

                (
                    SELECT MIN(created_at)
                    FROM task_history
                    WHERE task_id = t.id
                      AND action = 'accepted'
                ) AS task_request_response_timestamp,


                /* ==========================================
                   TASK REQUEST TO RESPONSE TAT
                   ========================================== */

                COALESCE(
                    CASE

                        WHEN (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'created'
                              AND actor_type = 'manager'
                        ) IS NOT NULL

                        AND (

                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'accepted'
                              AND actor_type = 'user'

                        ) IS NOT NULL

                        THEN CONCAT(

                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'created'
                                          AND actor_type = 'manager'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    )

                                ) / 60
                            ),

                            'h ',

                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'created'
                                          AND actor_type = 'manager'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    )

                                ),
                                60
                            ),

                            'm'
                        )

                        ELSE NULL

                    END,
                    '00h 00m'
                ) AS task_request_to_response_tat,


                /* ==========================================
                   TASK OUTPUT SHARED WITH CM
                   ========================================== */

                (
                    SELECT MIN(created_at)
                    FROM task_history
                    WHERE task_id = t.id
                      AND action = 'submitted'
                ) AS task_output_shared_with_cm_timestamp,


                /* ==========================================
                   TASK ACCEPTANCE TO COMPLETION TAT
                   ========================================== */

                COALESCE(
                    CASE

                        WHEN (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'accepted'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'submitted'
                        ) IS NOT NULL

                        THEN CONCAT(

                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'submitted'
                                    )

                                ) / 60
                            ),

                            'h ',

                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'submitted'
                                    )

                                ),
                                60
                            ),

                            'm'
                        )

                        ELSE NULL

                    END,
                    '00h 00m'
                ) AS task_acceptance_to_completion_tat_by_cu,


                /* ==========================================
                   TASK OUTPUT RESPONSE BY CM
                   ========================================== */

                (
                    SELECT MIN(created_at)
                    FROM task_history
                    WHERE task_id = t.id
                      AND action = 'shared_for_client_review'
                ) AS task_output_response_by_cm_timestamp,


                /* ==========================================
                   TASK OUTPUT SHARED TO RESPONSE BY CM TAT
                   ========================================== */

                COALESCE(
                    CASE

                        WHEN (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'submitted'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action IN (
                                  'manager_approved',
                                  'manager_change_requested'
                              )
                        ) IS NOT NULL

                        THEN CONCAT(

                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'submitted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )

                                ) / 60
                            ),

                            'h ',

                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'submitted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )

                                ),
                                60
                            ),

                            'm'
                        )

                        ELSE NULL

                    END,
                    '00h 00m'
                ) AS task_output_shared_to_response_by_cm_tat,


                /* ==========================================
                   TASK SHARED WITH CLIENT
                   ========================================== */

                t.shared_with_client_at
                    AS task_output_shared_with_client_timestamp,


                /* ==========================================
                   TASK INTERNAL TAT
                   ========================================== */

                COALESCE(
                    CASE

                        WHEN (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'accepted'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action IN (
                                  'manager_approved',
                                  'manager_change_requested'
                              )
                        ) IS NOT NULL

                        THEN CONCAT(

                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )

                                ) / 60
                            ),

                            'h ',

                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'accepted'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )

                                ),
                                60
                            ),

                            'm'
                        )

                        ELSE NULL

                    END,
                    '00h 00m'
                ) AS task_internal_tat,


                /* ==========================================
                   TASK OUTPUT RESPONSE BY CLIENT
                   ========================================== */

                (
                    SELECT MIN(created_at)
                    FROM task_history
                    WHERE task_id = t.id
                      AND action IN (
                        --   'completed',
                        --   'change_request_created',
                          'pm_approved'
                      )
                ) AS task_output_response_by_client_timestamp,


                /* ==========================================
                   TASK WHOLE TAT
                   ========================================== */

                COALESCE(
                    CASE

                        WHEN (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'created'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM task_history
                            WHERE task_id = t.id
                              AND action = 'completed'
                        ) IS NOT NULL

                        THEN CONCAT(

                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'created'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'completed'
                                    )

                                ) / 60
                            ),

                            'h ',

                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'created'
                                    ),

                                    (
                                        SELECT MIN(created_at)
                                        FROM task_history
                                        WHERE task_id = t.id
                                          AND action = 'completed'
                                    )

                                ),
                                60
                            ),

                            'm'
                        )

                        ELSE NULL

                    END,
                    '00h 00m'
                ) AS task_whole_tat,


                /* ==========================================
                   REMINDER COUNTERS
                   ========================================== */

                0 AS task_request_response_reminder_counter_to_cu,

                0 AS task_output_response_reminder_counter_to_cm,

                0 AS task_output_response_reminder_counter_to_client,


                /* ==========================================
                   CHANGE REQUEST COUNTERS
                   ========================================== */

                (
                    SELECT COUNT(*)
                    FROM issue_history ih
                    WHERE ih.task_id = t.id
                      AND ih.action = 'created'
                ) AS client_change_requested_counter,


                (
                    SELECT COUNT(*)
                    FROM task_history th
                    WHERE th.task_id = t.id
                      AND th.action = 'manager_change_requested'
                ) AS cm_change_requested_counter,


                /* ==========================================
                   CHANGE VERSION
                   ========================================== */

                COALESCE(
                    (
                        SELECT GROUP_CONCAT(
                            DISTINCT ia_version.version
                            ORDER BY ia_version.version
                            SEPARATOR ', '
                        )
                        FROM issue_assignments ia_version
                        WHERE ia_version.task_id = t.id
                          AND ia_version.is_deleted = 0
                    ),
                    ''
                ) AS change_version,


                /* ==========================================
                   MONTH
                   ========================================== */

                COALESCE(
                    DATE_FORMAT(
                        t.end_date,
                        '%M'
                    ),
                    '00'
                ) AS month,


                /* ==========================================
                   FINANCIAL YEAR (of the deadline, April-March)
                   ========================================== */

                COALESCE(

                    CASE

                        WHEN MONTH(t.deadline) >= 4

                        THEN CONCAT(
                            'FY ',
                            YEAR(t.deadline),
                            '-',
                            RIGHT(
                                YEAR(t.deadline) + 1,
                                2
                            )
                        )

                        ELSE CONCAT(
                            'FY ',
                            YEAR(t.deadline) - 1,
                            '-',
                            RIGHT(
                                YEAR(t.deadline),
                                2
                            )
                        )

                    END,

                    '00'

                ) AS fy

        `;

        const fromSql = `
            FROM tasks t


            LEFT JOIN work_requests wr
                ON wr.id = t.work_request_id


            LEFT JOIN task_type tt
                ON tt.id = t.task_type_id


            LEFT JOIN master_card mc
                ON mc.task_type_id = t.task_type_id


            LEFT JOIN users ru
                ON ru.id = wr.user_id
        `;


        // ==========================================
        // COLUMN FILTERS
        // Plain columns go into WHERE; computed columns (TATs, managers, counters...) are
        // filtered on an outer query over the full select. Cost columns stay admin-only.
        // ==========================================

        const outputKeys = selectAliases(selectSql);
        if (!isAdmin) TASK_COST_KEYS.forEach(key => outputKeys.delete(key));
        // opened from the Overview: the same team / division / person scope as its cards
        const overviewScope = await gridOverviewScope(req);
        if (overviewScope && overviewScope.error) return res.status(overviewScope.status).json({ success: false, error: overviewScope.error });
        if (overviewScope && overviewScope.sql) {
            whereClauses.push(overviewScope.sql.task);
            Object.assign(replacements, overviewScope.replacements);
        }
        const outerConditions = applyGridFilters({ filters: gridFilters, directMap: colSearchMap, outerKeys: outputKeys, whereClauses, replacements });


        // ==========================================
        // WHERE
        // ==========================================

        const whereSql = whereClauses.length > 0
            ? `WHERE ${whereClauses.join(' AND ')} AND t.is_deleted = 0`
            : 'WHERE t.is_deleted = 0';


        // ==========================================
        // ORDER BY (DataTables sorting)
        // ==========================================

        // Any output column can be sorted (ties broken by id so pages stay stable)
        const sort = resolveSort(req.query, outputKeys);
        const orderByClause = sort ? `${orderSql(sort)}, t.id DESC` : 't.id DESC';

        // KPI summary over all filtered rows (same keys in both query paths)
        const summarySql = (c) => ({
            completed_count: `SUM(CASE WHEN ${c.status} = 'completed' THEN 1 ELSE 0 END)`,
            in_progress_count: `SUM(CASE WHEN ${c.status} = 'in_progress' THEN 1 ELSE 0 END)`,
            pending_count: `SUM(CASE WHEN ${c.status} = 'pending' THEN 1 ELSE 0 END)`,
            overdue_count: `SUM(CASE WHEN DATE(${c.deadline}) < CURDATE() AND ${c.status} NOT IN ('completed', 'cancelled', 'rejected') THEN 1 ELSE 0 END)`,
            projects_count: `COUNT(DISTINCT ${c.workRequest})`,
            // Work pages = SUM(tasks.task_count) for the KPI cards
            work_pages_sum: `SUM(COALESCE(${c.pages}, 0) + 0)`,
            completed_work_pages_sum: `SUM(CASE WHEN ${c.status} = 'completed' THEN COALESCE(${c.pages}, 0) + 0 ELSE 0 END)`,
            ...statusCountSql(c.status, TASK_STATUSES)
        });
        const buildSummary = (row, total) => ({
            total: Number(total),
            work_pages: Number(row.work_pages_sum || 0),
            completed_work_pages: Number(row.completed_work_pages_sum || 0),
            completed: Number(row.completed_count || 0),
            in_progress: Number(row.in_progress_count || 0),
            pending: Number(row.pending_count || 0),
            overdue: Number(row.overdue_count || 0),
            projects: Number(row.projects_count || 0),
            status_counts: statusCountsFrom(row, TASK_STATUSES)
        });

        if (outerConditions.length > 0) {
            const outer = await runOuterQuery({
                innerSql: `${selectSql} ${fromSql} ${whereSql}`,
                replacements,
                outerConditions,
                sort,
                defaultOrder: 'x.task_id DESC',
                limit,
                offset,
                summary: summarySql({ status: 'x.task_status', deadline: 'x.task_deadline', workRequest: 'x.work_request_id', pages: 'x.task_no_of_work_pages' })
            });
            return res.json({
                data: isAdmin ? outer.rows : outer.rows.map(row => omitKeys(row, TASK_COST_KEYS)),
                total: outer.total,
                recordsTotal: outer.total,
                recordsFiltered: outer.total,
                is_admin: isAdmin,
                summary: buildSummary(outer.summary, outer.total)
            });
        }

        // The select list does not change the number of rows, so count over the joins only
        // (counting the full query evaluated every per-row subquery for every task).
        // Same query also returns the status summary for the KPI cards (over all filtered rows)
        const countSummarySql = summarySql({ status: 't.status', deadline: 't.deadline', workRequest: 't.work_request_id', pages: 't.task_count' });
        const countQuery = `
            SELECT
                COUNT(*) AS total,
                ${Object.entries(countSummarySql).map(([key, sql]) => `${sql} AS ${key}`).join(',\n                ')}
            ${fromSql} ${whereSql}`;
        const countResult = await sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT });
        const total = countResult[0]?.total || 0;
        const summary = buildSummary(countResult[0] || {}, total);

        let query;
        if (orderByClause === 't.id DESC' && limit !== -1) {
            // Default sort: pick the page rows first, then run the per-row subqueries only for them.
            // page_mc_id keeps the exact (task, master_card) row pairs of the plain join.
            query = `${selectSql}
            FROM (
                SELECT t.id AS page_task_id, mc.id AS page_mc_id
                ${fromSql}
                ${whereSql}
                ORDER BY t.id DESC
                LIMIT :limit OFFSET :offset
            ) page_rows
            JOIN tasks t
                ON t.id = page_rows.page_task_id
            LEFT JOIN work_requests wr
                ON wr.id = t.work_request_id
            LEFT JOIN task_type tt
                ON tt.id = t.task_type_id
            LEFT JOIN master_card mc
                ON mc.id <=> page_rows.page_mc_id
            LEFT JOIN users ru
                ON ru.id = wr.user_id
            ORDER BY t.id DESC
            `;
        } else {
            query = `${selectSql} ${fromSql} ${whereSql}
            ORDER BY ${orderByClause}
            `;
            if (limit !== -1) {
                query += ` LIMIT :limit OFFSET :offset`;
            }
        }

        if (limit !== -1) {
            replacements.limit = limit;
            replacements.offset = offset;
        }


        // ==========================================
        // EXECUTE QUERY
        // ==========================================

        const results = await sequelize.query(query, {

            replacements,

            type: sequelize.QueryTypes.SELECT

        });


        // ==========================================
        // ADMIN-ONLY CHECK
        // Hide task_cost for non-admin users
        // ==========================================

        const data = isAdmin ? results : results.map(row => omitKeys(row, TASK_COST_KEYS));


        // ==========================================
        // RESPONSE
        // ==========================================

        res.json({
            data: data,
            total: total,
            recordsTotal: total,
            recordsFiltered: total,
            is_admin: isAdmin,
            summary
        });


    } catch (error) {

        console.error(
            'Error fetching task details data:',
            error
        );

        res.status(500).json({
            error: 'Internal server error'
        });

    }
};

const getIssueDetailsData = async (req, res) => {
    try {
        const { issueStatus } = req.query;
        const { page, limit, offset } = req.pagination;

        const replacements = {};
        const whereClauses = [];

        // ==========================================
        // SEARCH FILTER (DataTables global search)
        // ==========================================

        const searchTerm = req.query.search ? req.query.search : '';

        const colSearchMap = {
            // Plain columns only: computed columns (managers, verticals, costs, TATs, counters,
            // month/fy) are select aliases and are filtered through the outer query
            "issue_created_at": "ia.created_at",
            "issue_status": "ia.status",
            "work_request_id": "CAST(wr.id AS CHAR)",
            "task_id": "CAST(t.id AS CHAR)",
            "issue_id": "CAST(ia.id AS CHAR)",
            "task_name": "t.task_name",
            "task_type_name": "tt.task_type",
            "issue_requester_name": "ru.name",
            "issue_start_date": "ia.start_date",
            "issue_end_date": "ia.end_date",
            "issue_deadline": "ia.deadline",
            "task_no_of_work_pages": "CAST(COALESCE(t.task_count, 0) AS CHAR)",
            "issue_no_of_work_pages": "CAST(COALESCE(ia.task_count, 0) AS CHAR)",
            "issue_no_of_options_provided": "CAST(COALESCE(ia.no_of_options_provided, 0) AS CHAR)",
            "issue_concept_work": "CAST(COALESCE(ia.concept_work, 0) AS CHAR)",
            "issue_no_of_concepts": "CAST(COALESCE(ia.no_of_concepts, 0) AS CHAR)",
            "issue_no_of_resize": "CAST(COALESCE(ia.no_of_resize, 0) AS CHAR)",
            "issue_no_of_ai_page": "CAST(COALESCE(ia.no_of_images_videos_audio, 0) AS CHAR)",
            "issue_video_duration": "CAST(COALESCE(ia.duration_minutes * 60 + ia.duration_seconds, 0) AS CHAR)",
            "issue_no_of_products_shot": "CAST(COALESCE(ia.no_of_products_shot, 0) AS CHAR)",
            "issue_no_of_words_written": "CAST(COALESCE(ia.no_of_words_written, 0) AS CHAR)",
            "issue_no_of_responsive_screen": "CAST(COALESCE(ia.responsive_screen, 0) AS CHAR)",
            "issue_resize_work": "CAST(COALESCE(ia.resize_work, 0) AS CHAR)",
            "issue_ai": "CAST(COALESCE(ia.no_of_images_videos_audio, 0) AS CHAR)",
            "issue_shoot_setup": "CAST(COALESCE(ia.shoot_setup, 0) AS CHAR)",
            // Financial year of the change deadline (same text as the fy column, e.g. "FY 2026-27")
            "fy": "COALESCE(CASE WHEN MONTH(ia.deadline) >= 4 THEN CONCAT('FY ', YEAR(ia.deadline), '-', RIGHT(YEAR(ia.deadline) + 1, 2)) ELSE CONCAT('FY ', YEAR(ia.deadline) - 1, '-', RIGHT(YEAR(ia.deadline), 2)) END, '00')"
        };

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            const searchColumns = [
                't.task_name',
                'tt.task_type',
                'wr.id',
                'ru.name',
                'ia.status'
            ];
            const searchConditions = searchColumns.map(col => `${col} LIKE :searchTerm`);
            whereClauses.push(`(${searchConditions.join(' OR ')})`);
            replacements.searchTerm = likeTerm;
        }

        // Column filters and sorting are applied once the select list is known (below)
        const gridFilters = parseGridFilters(req.query);
        const isAdmin = await isAdminRequest(req);

        if (issueStatus) {
            whereClauses.push('ia.status = :issueStatus');
            replacements.issueStatus = issueStatus;
        }

        let query = `
            SELECT
                COALESCE(
                    NULLIF(TRIM(ia.status), ''),
                    '00h 00m'
                ) AS issue_status,

                wr.id AS work_request_id,

                t.id AS task_id,

                ia.id AS issue_id,

                COALESCE(
                    NULLIF(TRIM(t.task_name), ''),
                    'N/A'
                ) AS task_name,

                COALESCE(
                    NULLIF(TRIM(tt.task_type), ''),
                    'N/A'
                ) AS task_type_name,

                COALESCE(
                    NULLIF(TRIM(ru.name), ''),
                    'N/A'
                ) AS issue_requester_name,

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d.title
                                ORDER BY d.title
                                SEPARATOR ', '
                            )
                            FROM user_divisions ud
                            JOIN division d
                                ON d.id = ud.division_id
                            WHERE ud.user_id = wr.user_id
                        ),
                    ''),
                    'N/A'
                ) AS client_division,

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT mu2.name
                                ORDER BY mu2.name
                                SEPARATOR ', '
                            )
                             FROM work_request_managers wrm2
                             JOIN users mu2
                                 ON mu2.id = wrm2.manager_id
                             WHERE wrm2.work_request_id = wr.id
                         ),
                     ''),
                     'N/A'
                  ) AS project_manager,

                 COALESCE(
                     NULLIF(
                         (
                             SELECT GROUP_CONCAT(
                                 DISTINCT d2.title
                                 ORDER BY d2.title
                                 SEPARATOR ', '
                             )
                             FROM work_request_managers wrm3
                             JOIN users mu3
                                 ON mu3.id = wrm3.manager_id
                             JOIN user_divisions ud3
                                 ON ud3.user_id = mu3.id
                             JOIN division d2
                                 ON d2.id = ud3.division_id
                             WHERE wrm3.work_request_id = wr.id
                         ),
                     ''),
                     'N/A'
                   ) AS project_manager_vertical,

                  COALESCE(
                      NULLIF(
                          (
                              SELECT GROUP_CONCAT(
                                  DISTINCT d3.title
                                  ORDER BY d3.title
                                  SEPARATOR ', '
                              )
                              FROM issue_user_assignments iua3
                              JOIN users au3
                                  ON au3.id = iua3.user_id
                              JOIN user_divisions ud5
                                  ON ud5.user_id = au3.id
                              JOIN division d3
                                  ON d3.id = ud5.division_id
                              WHERE iua3.issue_assignment_id = ia.id
                          ),
                      ''),
                      'N/A'
                  ) AS task_manager_vertical,

                  COALESCE(
                      NULLIF(
                          (
                              SELECT GROUP_CONCAT(
                                  DISTINCT mu4.name
                                  ORDER BY mu4.name
                                  SEPARATOR ', '
                              )
                              FROM issue_user_assignments iua3
                              JOIN users au3
                                  ON au3.id = iua3.user_id
                              JOIN user_divisions ud5
                                  ON ud5.user_id = au3.id
                              JOIN division d3
                                  ON d3.id = ud5.division_id
                              JOIN user_divisions ud6
                                  ON ud6.division_id = d3.id
                              JOIN users mu4
                                  ON mu4.id = ud6.user_id
                              JOIN job_role jr
                                  ON jr.id = mu4.job_role_id
                              WHERE iua3.issue_assignment_id = ia.id
                                AND jr.role_title = 'Creative Manager'
                          ),
                      ''),
                      'N/A'
                  ) AS task_manager,

                  COALESCE(
                      NULLIF(
                          (
                              SELECT GROUP_CONCAT(
                                  DISTINCT au2.name
                                  ORDER BY au2.name
                                  SEPARATOR ', '
                              )
                              FROM issue_user_assignments iua2
                              JOIN users au2
                                  ON au2.id = iua2.user_id
                              WHERE iua2.issue_assignment_id = ia.id
                          ),
                      ''),
                      'N/A'
                  ) AS assigned_creative_user,

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d2.title
                                ORDER BY d2.title
                                SEPARATOR ', '
                            )
                            FROM issue_user_assignments iua3
                            JOIN user_divisions ud2
                                ON ud2.user_id = iua3.user_id
                            JOIN division d2
                                ON d2.id = ud2.division_id
                            WHERE iua3.issue_assignment_id = ia.id
                        ),
                    ''),
                    'N/A'
                ) AS cu_vertical,

                /* =====================================================
                   POWER BI DATE/TIME FIELDS
                   Return actual DATETIME or NULL
                   ===================================================== */

                ia.start_date AS issue_start_date,

                ia.end_date AS issue_end_date,

                ia.deadline AS issue_deadline,

                COALESCE(
                    t.task_count,
                    0
                ) AS task_no_of_work_pages,

                COALESCE(
                    ia.task_count,
                    0
                ) AS issue_no_of_work_pages,

                COALESCE(
                    ia.task_count * mc.changes_rate,
                    0
                ) AS issue_cost,

                COALESCE(
                    ia.no_of_options_provided,
                    0
                ) AS issue_no_of_options_provided,

                COALESCE(
                    ia.concept_work,
                    0
                ) AS issue_concept_work,

                COALESCE(
                    ia.no_of_concepts,
                    0
                ) AS issue_no_of_concepts,

                COALESCE(
                    ia.concept_work * ia.no_of_concepts * mc.concept_charge,
                    0
                ) AS concept_work_cost,

                COALESCE(
                    ia.no_of_resize,
                    0
                ) AS issue_no_of_resize,

                COALESCE(
                    ia.resize_work * mc.changes_rate * (1 + mc.no_of_resize_pages / 100) * ia.no_of_resize,
                    0
                ) AS resize_work_cost,

                COALESCE(
                    ia.no_of_images_videos_audio,
                    0
                ) AS issue_no_of_ai_page,

                COALESCE(
                    ia.no_of_images_videos_audio * mc.ai_charges,
                    0
                ) AS ai_charges_cost,

                /* Total cost of this change: pages + concepts + resize + AI */
                ROUND(${changeCostSql('ia', 'mc')}, 2) AS total_cost,

                COALESCE(
                    ia.duration_minutes * 60 + ia.duration_seconds,
                    0
                ) AS issue_video_duration,

                COALESCE(
                    ia.no_of_products_shot,
                    0
                ) AS issue_no_of_products_shot,

                COALESCE(
                    ia.no_of_words_written,
                    0
                ) AS issue_no_of_words_written,

                COALESCE(
                    ia.responsive_screen,
                    0
                ) AS issue_no_of_responsive_screen,

                COALESCE(
                    ia.resize_work,
                    0
                ) AS issue_resize_work,

                COALESCE(
                    ia.no_of_images_videos_audio,
                    0
                ) AS issue_ai,

                COALESCE(
                    ia.shoot_setup,
                    0
                ) AS issue_shoot_setup,

                /* Issue request timestamp */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action IN (
                          'created',
                          'child_change_request_created'
                      )
                      AND actor_type IN (
                          'manager',
                          'user'
                      )
                ) AS issue_request_timestamp,

                /* Issue accepted/request response timestamp */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action = 'accepted'
                      AND actor_type = 'user'
                ) AS issue_request_response_timestamp,

                /* =====================================================
                   ISSUE REQUEST TO RESPONSE TAT
                   Duration field - kept as text
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'assigned'
                              AND actor_type = 'manager'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'accepted'
                              AND actor_type = 'user'
                        ) IS NOT NULL

                        THEN CONCAT(
                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'assigned'
                                          AND actor_type = 'manager'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    )
                                ) / 60
                            ),
                            'h ',
                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'assigned'
                                          AND actor_type = 'manager'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    )
                                ),
                                60
                            ),
                            'm'
                        )

                        ELSE NULL
                    END,
                    '00h 00m'
                ) AS issue_request_to_response_tat,

                /* Issue output shared with CM */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action = 'submitted'
                      AND actor_type = 'user'
                ) AS issue_output_shared_with_cm_timestamp,

                /* =====================================================
                   ISSUE ACCEPTANCE TO COMPLETION TAT
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'accepted'
                              AND actor_type = 'user'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'submitted'
                              AND actor_type = 'user'
                        ) IS NOT NULL

                        THEN CONCAT(
                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'submitted'
                                          AND actor_type = 'user'
                                    )
                                ) / 60
                            ),
                            'h ',
                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                          AND actor_type = 'user'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'submitted'
                                          AND actor_type = 'user'
                                    )
                                ),
                                60
                            ),
                            'm'
                        )

                        ELSE NULL
                    END,
                    '00h 00m'
                ) AS issue_acceptance_to_completion_tat_by_cu,

                /* Issue output response by CM */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action = 'manager_approved'
                      AND actor_type = 'manager'
                ) AS issue_output_response_by_cm_timestamp,

                /* =====================================================
                   ISSUE OUTPUT SHARED TO RESPONSE BY CM TAT
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'submitted'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action IN (
                                  'manager_approved',
                                  'manager_change_requested'
                              )
                        ) IS NOT NULL

                        THEN CONCAT(
                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'submitted'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )
                                ) / 60
                            ),
                            'h ',
                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'submitted'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )
                                ),
                                60
                            ),
                            'm'
                        )

                        ELSE NULL
                    END,
                    '00h 00m'
                ) AS issue_output_shared_to_response_by_cm_tat,

                /* Issue shared with client */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action = 'shared_for_client_review'
                ) AS issue_output_shared_with_client_timestamp,

                /* =====================================================
                   ISSUE INTERNAL TAT
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'accepted'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action IN (
                                  'manager_approved',
                                  'manager_change_requested'
                              )
                        ) IS NOT NULL

                        THEN CONCAT(
                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )
                                ) / 60
                            ),
                            'h ',
                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'accepted'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action IN (
                                              'manager_approved',
                                              'manager_change_requested'
                                          )
                                    )
                                ),
                                60
                            ),
                            'm'
                        )

                        ELSE NULL
                    END,
                    '00h 00m'
                ) AS issue_internal_tat,

                /* Issue output response by client */
                (
                    SELECT MIN(created_at)
                    FROM issue_history
                    WHERE issue_assignment_id = ia.id
                      AND action IN (
                          'completed',
                          'change_request_created'
                      )
                ) AS issue_output_response_by_client_timestamp,

                /* =====================================================
                   ISSUE WHOLE TAT
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'created'
                        ) IS NOT NULL

                        AND (
                            SELECT MIN(created_at)
                            FROM issue_history
                            WHERE issue_assignment_id = ia.id
                              AND action = 'completed'
                        ) IS NOT NULL

                        THEN CONCAT(
                            FLOOR(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'created'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'completed'
                                    )
                                ) / 60
                            ),
                            'h ',
                            MOD(
                                TIMESTAMPDIFF(
                                    MINUTE,
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'created'
                                    ),
                                    (
                                        SELECT MIN(created_at)
                                        FROM issue_history
                                        WHERE issue_assignment_id = ia.id
                                          AND action = 'completed'
                                    )
                                ),
                                60
                            ),
                            'm'
                        )

                        ELSE NULL
                    END,
                    '00h 00m'
                ) AS issue_whole_tat,

                0 AS issue_request_response_reminder_counter_to_cu,

                0 AS issue_output_response_reminder_counter_to_cm,

                0 AS issue_output_response_reminder_counter_to_client,

                (
                    SELECT COUNT(*)
                    FROM issue_history ih
                    WHERE ih.issue_assignment_id = ia.id
                      AND ih.action = 'created'
                ) AS client_change_requested_counter,

                (
                    SELECT COUNT(*)
                    FROM issue_history ih
                    WHERE ih.issue_assignment_id = ia.id
                      AND ih.action = 'manager_change_requested'
                ) AS cm_change_requested_counter,

                GROUP_CONCAT(
                    DISTINCT ia.version
                    ORDER BY ia.version
                    SEPARATOR ', '
                ) AS change_version,

                /* =====================================================
                   MONTH
                   ===================================================== */

                COALESCE(
                    DATE_FORMAT(
                        ia.end_date,
                        '%M'
                    ),
                    '00'
                ) AS month,

                /* =====================================================
                   FINANCIAL YEAR (of the deadline, April-March)
                   ===================================================== */

                COALESCE(
                    CASE
                        WHEN MONTH(ia.deadline) >= 4

                        THEN CONCAT(
                            'FY ',
                            YEAR(ia.deadline),
                            '-',
                            RIGHT(
                                YEAR(ia.deadline) + 1,
                                2
                            )
                        )

                        ELSE CONCAT(
                            'FY ',
                            YEAR(ia.deadline) - 1,
                            '-',
                            RIGHT(
                                YEAR(ia.deadline),
                                2
                            )
                        )
                    END,
                    '00'
                ) AS fy

            FROM issue_assignments ia

            LEFT JOIN tasks t
                ON t.id = ia.task_id
               AND t.is_deleted = 0

            LEFT JOIN work_requests wr
                ON wr.id = t.work_request_id

            LEFT JOIN task_type tt
                ON tt.id = t.task_type_id

            LEFT JOIN users ru
                ON ru.id = wr.user_id

            LEFT JOIN issue_user_assignments iua
                ON iua.issue_assignment_id = ia.id

            LEFT JOIN users au
                ON au.id = iua.user_id

            LEFT JOIN user_divisions ud
                ON ud.user_id = au.id

            LEFT JOIN division d
                ON d.id = ud.division_id

            LEFT JOIN master_card mc
                ON mc.task_type_id = t.task_type_id
        `;

        // Column filters: plain columns in WHERE, computed columns on an outer query over the
        // full select. Any output column can be sorted; cost columns stay admin-only.
        const outputKeys = selectAliases(query.slice(0, query.lastIndexOf('\n            FROM issue_assignments ia\n')));
        if (!isAdmin) ISSUE_COST_KEYS.forEach(key => outputKeys.delete(key));
        // opened from the Overview: the same team / division / person scope as its cards
        const overviewScope = await gridOverviewScope(req);
        if (overviewScope && overviewScope.error) return res.status(overviewScope.status).json({ success: false, error: overviewScope.error });
        if (overviewScope && overviewScope.sql) {
            whereClauses.push(overviewScope.sql.issue);
            Object.assign(replacements, overviewScope.replacements);
        }
        const outerConditions = applyGridFilters({ filters: gridFilters, directMap: colSearchMap, outerKeys: outputKeys, whereClauses, replacements });
        const sort = resolveSort(req.query, outputKeys);
        const orderByClause = sort ? `${orderSql(sort)}, ia.id DESC` : 'ia.id DESC';

        if (whereClauses.length > 0) {
            query += `
                WHERE ${whereClauses.join(' AND ')}
                AND ia.is_deleted = 0
            `;
        } else {
            query += `
                WHERE ia.is_deleted = 0
            `;
        }

        // FROM ... WHERE part only (no select list); every other joined table is one-to-one with ia
        // or is aggregated, so the result has exactly one row per ia.id
        const fromWhereSql = query.slice(query.lastIndexOf('\n            FROM issue_assignments ia\n'));

        const groupBySql = `
            GROUP BY
                ia.id,
                t.id,
                wr.id,
                ia.created_at,
                t.task_name,
                t.status,
                t.task_count,
                t.start_date,
                t.end_date,
                t.deadline,
                tt.task_type,
                ru.name
        `;

        // KPI summary over all filtered issues (same keys in both query paths)
        const buildSummary = (row, total) => ({
            total: Number(total),
            completed: Number(row.completed_count || 0),
            in_progress: Number(row.in_progress_count || 0),
            pending: Number(row.pending_count || 0),
            overdue: Number(row.overdue_count || 0),
            tasks: Number(row.tasks_count || 0),
            change_pages: Number(row.change_pages_sum || 0),
            completed_change_pages: Number(row.completed_change_pages_sum || 0),
            status_counts: statusCountsFrom(row, ISSUE_STATUSES)
        });

        if (outerConditions.length > 0) {
            const outer = await runOuterQuery({
                innerSql: `${query} ${groupBySql}`,
                replacements,
                outerConditions,
                sort,
                defaultOrder: 'x.issue_id DESC',
                limit,
                offset,
                summary: {
                    completed_count: "SUM(CASE WHEN x.issue_status = 'completed' THEN 1 ELSE 0 END)",
                    in_progress_count: "SUM(CASE WHEN x.issue_status = 'in_progress' THEN 1 ELSE 0 END)",
                    pending_count: "SUM(CASE WHEN x.issue_status IN ('m_pending', 'u_pending') THEN 1 ELSE 0 END)",
                    overdue_count: "SUM(CASE WHEN DATE(x.issue_deadline) < CURDATE() AND x.issue_status NOT IN ('completed', 'cancelled', 'rejected') THEN 1 ELSE 0 END)",
                    tasks_count: 'COUNT(DISTINCT x.task_id)',
                    // Change pages = SUM(issue_assignments.task_count); the outer rows are one per change
                    change_pages_sum: 'SUM(COALESCE(x.issue_no_of_work_pages, 0) + 0)',
                    completed_change_pages_sum: "SUM(CASE WHEN x.issue_status = 'completed' THEN COALESCE(x.issue_no_of_work_pages, 0) + 0 ELSE 0 END)",
                    ...statusCountSql('x.issue_status', ISSUE_STATUSES)
                }
            });
            return res.json({
                data: isAdmin ? outer.rows : outer.rows.map(row => omitKeys(row, ISSUE_COST_KEYS)),
                total: outer.total,
                recordsTotal: outer.total,
                recordsFiltered: outer.total,
                summary: buildSummary(outer.summary, outer.total)
            });
        }

        // Count issues over the joins only (counting the full query evaluated every per-row subquery)
        // Same query also returns the status summary for the KPI cards (over all filtered issues)
        const countSummarySql = {
            completed_count: "COUNT(DISTINCT CASE WHEN ia.status = 'completed' THEN ia.id END)",
            in_progress_count: "COUNT(DISTINCT CASE WHEN ia.status = 'in_progress' THEN ia.id END)",
            pending_count: "COUNT(DISTINCT CASE WHEN ia.status IN ('m_pending', 'u_pending') THEN ia.id END)",
            overdue_count: "COUNT(DISTINCT CASE WHEN ia.deadline < CURDATE() AND ia.status NOT IN ('completed', 'cancelled', 'rejected') THEN ia.id END)",
            tasks_count: 'COUNT(DISTINCT ia.task_id)',
            ...statusCountSql('ia.status', ISSUE_STATUSES, 'ia.id')
        };
        const countQuery = `
            SELECT
                COUNT(DISTINCT ia.id) AS total,
                ${Object.entries(countSummarySql).map(([key, sql]) => `${sql} AS ${key}`).join(',\n                ')}
            ${fromWhereSql}`;
        // Change pages (SUM of issue_assignments.task_count) per distinct change: the assignee and
        // division joins repeat each change, so it is summed over the matching ids, not the joined rows
        const pagesQuery = `
            SELECT
                SUM(COALESCE(pia.task_count, 0)) AS change_pages_sum,
                SUM(CASE WHEN pia.status = 'completed' THEN COALESCE(pia.task_count, 0) ELSE 0 END) AS completed_change_pages_sum
            FROM issue_assignments pia
            WHERE pia.id IN (SELECT ia.id ${fromWhereSql})`;
        const [countResult, pagesResult] = await Promise.all([
            sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(pagesQuery, { replacements, type: sequelize.QueryTypes.SELECT })
        ]);
        const total = countResult[0]?.total || 0;
        const summary = buildSummary({ ...(countResult[0] || {}), ...(pagesResult[0] || {}) }, total);

        if (orderByClause === 'ia.id DESC' && limit !== -1) {
            // Default sort: find the page's issue ids first, then build the full rows for those ids only
            const pageRows = await sequelize.query(
                `SELECT DISTINCT ia.id ${fromWhereSql} ORDER BY ia.id DESC LIMIT :limit OFFSET :offset`,
                { replacements: { ...replacements, limit, offset }, type: sequelize.QueryTypes.SELECT }
            );
            replacements.pageIssueIds = pageRows.length > 0 ? pageRows.map(r => r.id) : [0];
            query += ` AND ia.id IN (:pageIssueIds) ${groupBySql} ORDER BY ${orderByClause}`;
        } else {
            query += ` ${groupBySql} ORDER BY ${orderByClause}`;
            if (limit !== -1) {
                query += ` LIMIT :limit OFFSET :offset`;
                replacements.limit = limit;
                replacements.offset = offset;
            }
        }

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        // ==========================================
        // ADMIN-ONLY CHECK
        // Hide cost fields for non-admin users
        // ==========================================

        const data = isAdmin ? results : results.map(row => omitKeys(row, ISSUE_COST_KEYS));

        res.json({
            data: data,
            total: total,
            recordsTotal: total,
            recordsFiltered: total,
            summary
        });

    } catch (error) {
        console.error(
            'Error fetching issue details data:',
            error
        );

        res.status(500).json({
            error: 'Internal server error'
        });
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

                /* Power BI compatible DateTime */
                t.deadline AS deadline

            FROM tasks t

            WHERE t.work_request_id = :workRequestId
              AND t.is_deleted = 0
        `;

        const results = await sequelize.query(query, {
            replacements: { workRequestId },
            type: sequelize.QueryTypes.SELECT
        });

        res.json({
            tasks: results
        });

    } catch (error) {
        console.error(
            'Error fetching tasks for work request:',
            error
        );

        res.status(500).json({
            error: 'Internal server error'
        });
    }
};

const getWorkRequestTasksData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const { page, limit, offset } = req.pagination;

        const replacements = {};
        const whereClauses = ['wr.is_deleted = 0'];

        if (startDate) {
            whereClauses.push('wr.requested_at >= :startDate');
            replacements.startDate = startDate;
        }

        if (endDate) {
            whereClauses.push('wr.requested_at <= :endDate');
            replacements.endDate = endDate;
        }

        const searchTerm = req.query.search ? req.query.search : '';

        const colSearchMap = {
            'work_request_id': 'CAST(wr.id AS CHAR)',
            'project_name': 'wr.project_name',
            'brand': 'wr.brand',
            'work_request_description': 'wr.description',
            'work_request_digi_comments': 'wr.remarks',
            'about_project': 'wr.about_project',
            'work_request_status': 'wr.status',
            'request_type_name': 'rt.request_type',
            'project_type_name': 'pt.project_type',
            'project_priority': 'wr.priority',
            'request_creator_name': 'creator.name',
            'request_creator_email': 'creator.email',
            'request_creator_phone': 'creator.phone',
            'remarks': 'wr.remarks',
            'work_request_created_at': 'wr.requested_at',
            'work_request_updated_at': 'wr.updated_at',
            'task_id': 'CAST(t.id AS CHAR)',
            'task_name': 't.task_name',
            'task_type_name': 'tt.task_type',
            'assigned_user_name': 'assignee.name',
            'task_status': 't.status',
            'task_start_date': 't.start_date',
            'task_end_date': 't.end_date',
            'task_deadline': 't.deadline',
            'task_duration_minutes': 'CAST(t.duration_minutes AS CHAR)',
            'task_duration_seconds': 'CAST(t.duration_seconds AS CHAR)',
            'task_no_of_options_provided': 'CAST(t.no_of_options_provided AS CHAR)',
            'task_no_of_words_written': 'CAST(t.no_of_words_written AS CHAR)',
            'task_options_submitted': 't.options_submitted',
            'task_version': 'CAST(t.version AS CHAR)',
            'task_created_at': 't.created_at',
            'task_updated_at': 't.updated_at',
            'issue_id': 'CAST(ia.id AS CHAR)',
            'issue_status': 'ia.status',
            'issue_start_date': 'ia.start_date',
            'issue_end_date': 'ia.end_date',
            'issue_deadline': 'ia.deadline',
            'issue_duration_minutes': 'CAST(ia.duration_minutes AS CHAR)',
            'issue_duration_seconds': 'CAST(ia.duration_seconds AS CHAR)'
            // Every other output column (emails, pages, comments, links, month, fy, ...) is
            // filtered through the outer query by its select alias
        };

        if (searchTerm) {
            const likeTerm = '%' + searchTerm + '%';
            const searchColumns = [
                'wr.project_name',
                'wr.brand',
                'wr.description',
                'rt.request_type',
                'pt.project_type',
                'wr.priority',
                'creator.name',
                'creator.email',
                't.task_name',
                'tt.task_type',
                'assignee.name',
                't.status',
                'ia.status',
                'CAST(wr.id AS CHAR)',
                'CAST(t.id AS CHAR)',
                'CAST(ia.id AS CHAR)'
            ];
            const searchConditions = searchColumns.map(col => col + ' LIKE :searchTerm');
            whereClauses.push('(' + searchConditions.join(' OR ') + ')');
            replacements.searchTerm = likeTerm;
        }

        // Column filters and sorting are applied once the select list is known (below)
        const gridFilters = parseGridFilters(req.query);

        let query = `
            SELECT

                /* =====================================================
                   WORK REQUEST DETAILS
                   ===================================================== */

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


                /* =====================================================
                   REQUEST CREATOR
                   ===================================================== */

                creator.id AS request_creator_id,

                creator.name AS request_creator_name,

                COALESCE(
                    NULLIF(
                        (
                            SELECT GROUP_CONCAT(
                                DISTINCT d.title
                                ORDER BY d.title
                                SEPARATOR ', '
                            )
                            FROM user_divisions ud
                            JOIN division d
                                ON d.id = ud.division_id
                            WHERE ud.user_id = creator.id
                        ),
                    ''),
                    'N/A'
                ) AS request_creator_division,

                creator.email AS request_creator_email,

                creator.phone AS request_creator_phone,

                creator_dept.department_name
                    AS request_creator_department,

                creator_desig.designation_name
                    AS request_creator_designation,

                creator_job.role_title
                    AS request_creator_job_role,

                creator_loc.location_name
                    AS request_creator_location,


                /* =====================================================
                   MANAGERS
                   ===================================================== */

                (
                    SELECT GROUP_CONCAT(
                        u.name
                        SEPARATOR ', '
                    )
                    FROM work_request_managers wrm
                    JOIN users u
                        ON u.id = wrm.manager_id
                    WHERE wrm.work_request_id = wr.id
                ) AS manager_names,

                (
                    SELECT GROUP_CONCAT(
                        wrm.manager_id
                        SEPARATOR ', '
                    )
                    FROM work_request_managers wrm
                    WHERE wrm.work_request_id = wr.id
                ) AS manager_ids,


                /* =====================================================
                   POWER BI DATE/TIME
                   Project requested/accepted by CM
                   ===================================================== */

                (
                    SELECT MIN(wrm2.created_at)
                    FROM work_request_managers wrm2
                    WHERE wrm2.work_request_id = wr.id
                ) AS project_requested_accept_at_cm,


                /* =====================================================
                   PROJECT START DATE
                   ===================================================== */

                (
                    SELECT MIN(t2.start_date)
                    FROM tasks t2
                    WHERE t2.work_request_id = wr.id
                      AND t2.is_deleted = 0
                ) AS project_start_date,


                /* =====================================================
                   PROJECT END DATE
                   ===================================================== */

                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM tasks t2
                        WHERE t2.work_request_id = wr.id
                          AND t2.is_deleted = 0
                          AND t2.end_date IS NULL
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM issue_assignments ia2
                        JOIN tasks t3
                            ON t3.id = ia2.task_id
                           AND t3.is_deleted = 0
                        WHERE t3.work_request_id = wr.id
                          AND ia2.is_deleted = 0
                          AND ia2.end_date IS NULL
                    )
                    THEN NULL
                    ELSE COALESCE(
                        (
                            SELECT MAX(
                                CASE
                                    WHEN t2.end_date IS NOT NULL AND ia2.end_date IS NOT NULL THEN GREATEST(t2.end_date, ia2.end_date)
                                    WHEN t2.end_date IS NOT NULL THEN t2.end_date
                                    WHEN ia2.end_date IS NOT NULL THEN ia2.end_date
                                END
                            )
                            FROM tasks t2
                            LEFT JOIN issue_assignments ia2
                                ON ia2.task_id = t2.id
                               AND ia2.is_deleted = 0
                            WHERE t2.work_request_id = wr.id
                              AND t2.is_deleted = 0
                        ),
                        NULL
                    )
                END AS project_end_date,


                /* =====================================================
                   PROJECT DEADLINE
                   ===================================================== */

                (
                    SELECT MAX(t2.deadline)
                    FROM tasks t2
                    WHERE t2.work_request_id = wr.id
                      AND t2.is_deleted = 0
                ) AS project_deadline,


                /* =====================================================
                   PROJECT REVIEW
                   ===================================================== */

                (
                    SELECT
                        CASE
                            WHEN COUNT(t2.id) = 0
                                THEN NULL

                            WHEN SUM(
                                CASE
                                    WHEN t2.review = 'approved'
                                    THEN 1
                                    ELSE 0
                                END
                            ) = COUNT(t2.id)
                                THEN 'approved'

                            WHEN SUM(
                                CASE
                                    WHEN t2.review = 'change_request'
                                    THEN 1
                                    ELSE 0
                                END
                            ) > 0
                                THEN 'change_request'

                            ELSE 'pending'
                        END

                    FROM tasks t2

                    WHERE t2.work_request_id = wr.id
                      AND t2.is_deleted = 0

                ) AS project_review,


                /* =====================================================
                   PROJECT STAGE
                   ===================================================== */

                (
                    SELECT
                        CASE
                            WHEN COUNT(t2.id) = 0
                                THEN NULL

                            WHEN SUM(
                                CASE
                                    WHEN t2.review_stage = 'final_approved'
                                    THEN 1
                                    ELSE 0
                                END
                            ) = COUNT(t2.id)
                                THEN 'final_approved'

                            WHEN SUM(
                                CASE
                                    WHEN t2.review_stage = 'pm_review'
                                    THEN 1
                                    ELSE 0
                                END
                            ) > 0
                                THEN 'pm_review'

                            WHEN SUM(
                                CASE
                                    WHEN t2.review_stage = 'manager_review'
                                    THEN 1
                                    ELSE 0
                                END
                            ) > 0
                                THEN 'manager_review'

                            WHEN SUM(
                                CASE
                                    WHEN t2.review_stage = 'change_requested'
                                    THEN 1
                                    ELSE 0
                                END
                            ) > 0
                                THEN 'change_requested'

                            ELSE 'not_started'
                        END

                    FROM tasks t2

                    WHERE t2.work_request_id = wr.id
                      AND t2.is_deleted = 0

                ) AS project_stage,


                /* =====================================================
                   TASK DETAILS
                   ===================================================== */

                t.id AS task_id,

                t.task_name,

                t.description AS task_description,

                task_rt.id AS task_request_type_id,

                tt.id AS task_type_id,

                t.work_request_id AS task_work_request_id,

                t.deadline AS task_deadline,

                t.status AS task_status,

                t.version AS task_version,

                t.review AS task_review,

                t.review_stage AS task_review_stage,

                t.assignment_type AS task_assignment_type,

                t.intimate_team AS task_intimate_team,

                t.intimate_client AS task_intimate_client,

                t.shared_with_client_at
                    AS task_shared_with_client_at,

                1 AS task_count,

                t.task_count AS task_no_of_work_pages,

                (
                    SELECT COUNT(DISTINCT ia2.id)
                    FROM issue_assignments ia2
                    WHERE ia2.task_id = t.id
                      AND ia2.is_deleted = 0
                ) AS issue_task_count,

                t.link AS task_link,

                t.start_date AS task_start_date,

                t.end_date AS task_end_date,

                t.no_of_options_provided
                    AS task_no_of_options_provided,

                t.no_of_words_written
                    AS task_no_of_words_written,

                t.options_submitted
                    AS task_options_submitted,

                t.concept_work
                    AS task_concept_work,

                t.resize_work
                    AS task_resize_work,

                t.no_of_concepts
                    AS task_no_of_concepts,

                t.duration_minutes
                    AS task_duration_minutes,

                t.duration_seconds
                    AS task_duration_seconds,

                COALESCE(t.duration_minutes, 0) * 60
                    + COALESCE(t.duration_seconds, 0)
                    AS task_video_duration,

                t.product_shoot
                    AS task_product_shoot,

                t.no_of_products_shot
                    AS task_no_of_products_shot,

                t.shoot_setup
                    AS task_shoot_setup,

                t.no_of_resize
                    AS task_no_of_resize,

                t.no_of_images_videos_audio
                    AS task_ai,

                t.no_of_images_videos_audio
                    AS task_no_of_ai_page,

                t.responsive_screen
                    AS task_responsive_screen,

                t.no_of_responsive_screen
                    AS task_no_of_responsive_screen,

                t.created_at AS task_created_at,

                t.updated_at AS task_updated_at,

                t.comments AS task_digi_comments,

                t.description AS task_requester_description,


                /* =====================================================
                   MONTH
                   ===================================================== */

                DATE_FORMAT(
                    t.created_at,
                    '%M'
                ) AS month,


                /* =====================================================
                   FINANCIAL YEAR
                   ===================================================== */

                CASE
                    WHEN MONTH(t.end_date) >= 4

                    THEN CONCAT(
                        'FY ',
                        YEAR(t.end_date),
                        '-',
                        RIGHT(
                            YEAR(t.end_date) + 1,
                            2
                        )
                    )

                    ELSE CONCAT(
                        'FY ',
                        YEAR(t.end_date) - 1,
                        '-',
                        RIGHT(
                            YEAR(t.end_date),
                            2
                        )
                    )

                END AS fy,


                /* =====================================================
                   TASK REQUESTED / ASSIGNED TO CU
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(ta2.created_at)
                    FROM task_assignments ta2
                    WHERE ta2.task_id = t.id
                ) AS task_requested_at_assign_intimate_cu,


                /* =====================================================
                   TASK ACCEPTED BY CU
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.action = 'approved'
                      AND trh.reviewer_type = 'manager'

                ) AS task_requested_accept_at_cu,


                /* =====================================================
                   TASK SHARED WITH CM
                   Actual DATETIME / NULL
                   ===================================================== */

                t.shared_with_client_at
                    AS task_shared_with_cm_at,


                /* =====================================================
                   TASK RESPONSE ON OUTPUT BY CM
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.reviewer_type = 'manager'

                ) AS task_respond_on_output_cm,


                /* =====================================================
                   TASK OUTPUT CLIENT RESPONDED APPROVED
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.action = 'approved'
                      AND trh.reviewer_type = 'project_manager'

                ) AS task_output_client_responded_approved,


                /* =====================================================
                   TASK TYPE
                   (task_type_id is selected once, above, so the query can be used
                   as a derived table; it has always returned tt.id)
                   ===================================================== */

                tt.task_type AS task_type_name,

                tt.description AS task_type_description,


                /* =====================================================
                   TASK REQUEST TYPE
                   (task_request_type_id is selected once, above, so the query can be
                   used as a derived table; it has always returned task_rt.id)
                   ===================================================== */

                task_rt.request_type
                    AS task_request_type_name,


                /* =====================================================
                   TASK ASSIGNMENT
                   ===================================================== */

                ta.id AS task_assignment_id,

                ta.user_id AS assigned_user_id,

                assignee.name AS assigned_user_name,

                assignee.email AS assigned_user_email,

                assignee.phone AS assigned_user_phone,

                assignee_dept.department_name
                    AS assigned_user_department,

                assignee_desig.designation_name
                    AS assigned_user_designation,

                assignee_job.role_title
                    AS assigned_user_job_role,

                assignee_loc.location_name
                    AS assigned_user_location,


                /* =====================================================
                   ISSUE DETAILS
                   ===================================================== */

                ia.id AS issue_id,

                CASE
                    WHEN ia.id IS NULL
                        THEN NULL

                    ELSE COALESCE(
                        NULLIF(
                            TRIM(task_rt.request_type),
                            ''
                        ),
                        'N/A'
                    )
                END AS issue_request_type_name,

                ia.issue_id AS issue_parent_id,

                ia.task_id AS issue_task_id,

                ia.requested_by_user_id
                    AS issue_requested_by_user_id,

                ia.assignment_type
                    AS issue_assignment_type,

                ia.version AS issue_version,

                ia.description AS issue_description,

                ia.deadline AS issue_deadline,

                ia.intimate_team
                    AS issue_intimate_team,

                ia.intimate_client
                    AS issue_intimate_client,

                ia.shared_with_client_at
                    AS issue_shared_with_client_at,

                ia.task_count
                    AS issue_task_count_pages,

                ia.task_count
                    AS issue_no_of_work_pages,

                ia.start_date AS issue_start_date,

                ia.end_date AS issue_end_date,

                ia.link AS issue_link,


                /* =====================================================
                   ISSUE STATUS
                   ===================================================== */

                CASE
                    WHEN ia.id IS NULL
                        THEN NULL

                    WHEN ia.start_date IS NULL
                     AND ia.end_date IS NULL
                        THEN 'upcoming'

                    WHEN ia.start_date IS NOT NULL
                     AND ia.end_date IS NOT NULL
                        THEN 'completed'

                    ELSE 'ongoing'
                END AS issue_status,


                ia.review AS issue_review,

                ia.review_stage AS issue_review_stage,

                ia.no_of_options_provided
                    AS issue_no_of_options_provided,

                ia.no_of_words_written
                    AS issue_no_of_words_written,

                ia.options_submitted
                    AS issue_options_submitted,

                ia.concept_work
                    AS issue_concept_work,

                ia.resize_work
                    AS issue_resize_work,

                ia.no_of_concepts
                    AS issue_no_of_concepts,

                ia.duration_minutes
                    AS issue_duration_minutes,

                ia.duration_seconds
                    AS issue_duration_seconds,

                COALESCE(ia.duration_minutes, 0) * 60
                    + COALESCE(ia.duration_seconds, 0)
                    AS issue_video_duration,

                ia.product_shoot
                    AS issue_product_shoot,

                ia.no_of_products_shot
                    AS issue_no_of_products_shot,

                ia.shoot_setup
                    AS issue_shoot_setup,

                ia.no_of_resize
                    AS issue_no_of_resize,

                ia.no_of_images_videos_audio
                    AS issue_ai,

                ia.no_of_images_videos_audio
                    AS issue_no_of_ai_page,

                ia.responsive_screen
                    AS issue_responsive_screen,

                ia.no_of_responsive_screen
                    AS issue_no_of_responsive_screen,

                ia.created_at AS issue_created_at,

                ia.updated_at AS issue_updated_at,

                ia.comments AS issue_comments,


                /* =====================================================
                   ISSUE REQUESTED AT CLIENT
                   Actual DATETIME / NULL
                   ===================================================== */

                wr.requested_at
                    AS issue_requested_at_client,


                /* =====================================================
                   ISSUE REQUEST ACCEPTED BY CM
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(wrm2.created_at)
                    FROM work_request_managers wrm2
                    WHERE wrm2.work_request_id = wr.id
                ) AS issue_requested_accept_at_cm,


                /* =====================================================
                   ISSUE ASSIGNED / INTIMATED TO CU
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(iua2.created_at)
                    FROM issue_user_assignments iua2
                    WHERE iua2.issue_assignment_id = ia.id
                ) AS issue_requested_at_assign_intimate_cu,


                /* =====================================================
                   ISSUE ACCEPTED BY CU
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.action = 'approved'
                      AND trh.reviewer_type = 'manager'

                ) AS issue_requested_accept_at_cu,


                /* =====================================================
                   ISSUE SHARED WITH CM
                   Actual DATETIME / NULL
                   ===================================================== */

                ia.shared_with_client_at
                    AS issue_shared_with_cm_at,


                /* =====================================================
                   ISSUE RESPONSE ON OUTPUT BY CM
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.reviewer_type = 'manager'

                ) AS issue_respond_on_output_cm,


                /* =====================================================
                   ISSUE OUTPUT CLIENT RESPONDED APPROVED
                   Actual DATETIME / NULL
                   ===================================================== */

                (
                    SELECT MIN(trh.created_at)
                    FROM task_review_history trh

                    WHERE trh.task_id = t.id
                      AND trh.action = 'approved'
                      AND trh.reviewer_type = 'project_manager'

                ) AS issue_output_client_responded_approve,


                /* =====================================================
                   ISSUE REQUESTER
                   ===================================================== */

                issue_requester.id
                    AS issue_requester_id,

                issue_requester.name
                    AS issue_requester_name,

                issue_requester.email
                    AS issue_requester_email,

                issue_requester.phone
                    AS issue_requester_phone,

                issue_requester_dept.department_name
                    AS issue_requester_department,

                issue_requester_desig.designation_name
                    AS issue_requester_designation,

                issue_requester_job.role_title
                    AS issue_requester_job_role,

                issue_requester_loc.location_name
                    AS issue_requester_location,


                /* =====================================================
                   ISSUE TYPES
                   ===================================================== */

                (
                    SELECT GROUP_CONCAT(
                        ir.change_issue_type
                        SEPARATOR ', '
                    )

                    FROM issue_assignment_types iat

                    JOIN issue_register ir
                        ON ir.id = iat.issue_register_id

                    WHERE iat.issue_assignment_id = ia.id

                ) AS issue_types,


                /* =====================================================
                   ISSUE REGISTER IDS
                   ===================================================== */

                (
                    SELECT GROUP_CONCAT(
                        ir.id
                        SEPARATOR ', '
                    )

                    FROM issue_assignment_types iat

                    JOIN issue_register ir
                        ON ir.id = iat.issue_register_id

                    WHERE iat.issue_assignment_id = ia.id

                ) AS issue_register_ids,


                /* =====================================================
                   ISSUE TYPES WITH DESCRIPTION
                   ===================================================== */

                (
                    SELECT GROUP_CONCAT(
                        CONCAT(
                            ir.change_issue_type,
                            ' - ',
                            ir.description
                        )
                        SEPARATOR ' | '
                    )

                    FROM issue_assignment_types iat

                    JOIN issue_register ir
                        ON ir.id = iat.issue_register_id

                    WHERE iat.issue_assignment_id = ia.id

                ) AS issue_types_with_description


            FROM work_requests wr

            LEFT JOIN request_type rt
                ON rt.id = wr.request_type_id

            LEFT JOIN project_type pt
                ON pt.id = wr.project_id

            LEFT JOIN users creator
                ON creator.id = wr.user_id

            LEFT JOIN department creator_dept
                ON creator_dept.id = creator.department_id

            LEFT JOIN designation creator_desig
                ON creator_desig.id = creator.designation_id

            LEFT JOIN job_role creator_job
                ON creator_job.id = creator.job_role_id

            LEFT JOIN location creator_loc
                ON creator_loc.id = creator.location_id

            LEFT JOIN tasks t
                ON t.work_request_id = wr.id
               AND t.is_deleted = 0

            LEFT JOIN task_type tt
                ON tt.id = t.task_type_id

            LEFT JOIN request_type task_rt
                ON task_rt.id = t.request_type_id

            LEFT JOIN task_assignments ta
                ON ta.task_id = t.id

            LEFT JOIN users assignee
                ON assignee.id = ta.user_id

            LEFT JOIN department assignee_dept
                ON assignee_dept.id = assignee.department_id

            LEFT JOIN designation assignee_desig
                ON assignee_desig.id = assignee.designation_id

            LEFT JOIN job_role assignee_job
                ON assignee_job.id = assignee.job_role_id

            LEFT JOIN location assignee_loc
                ON assignee_loc.id = assignee.location_id

            LEFT JOIN issue_assignments ia
                ON ia.task_id = t.id
               AND ia.is_deleted = 0

            LEFT JOIN users issue_requester
                ON issue_requester.id = ia.requested_by_user_id

            LEFT JOIN department issue_requester_dept
                ON issue_requester_dept.id =
                    issue_requester.department_id

            LEFT JOIN designation issue_requester_desig
                ON issue_requester_desig.id =
                    issue_requester.designation_id

            LEFT JOIN job_role issue_requester_job
                ON issue_requester_job.id =
                    issue_requester.job_role_id

            LEFT JOIN location issue_requester_loc
                ON issue_requester_loc.id =
                    issue_requester.location_id
        `;

        // Column filters: plain columns in WHERE, every other output column on an outer query
        // over the full select. Any output column can be sorted.
        const outputKeys = selectAliases(query.slice(0, query.lastIndexOf('\n            FROM work_requests wr\n')));
        // columns selected without AS keep their own name
        ['project_name', 'brand', 'about_project', 'priority', 'requested_at', 'remarks', 'task_name'].forEach(key => outputKeys.add(key));
        const outerConditions = applyGridFilters({ filters: gridFilters, directMap: colSearchMap, outerKeys: outputKeys, whereClauses, replacements });
        const sort = resolveSort(req.query, outputKeys);
        const orderByClause = sort
            ? `${orderSql(sort)}, wr.id DESC, t.id ASC, ta.id ASC, ia.id ASC`
            : 'wr.id DESC, t.id ASC, ta.id ASC, ia.id ASC';

        if (whereClauses.length > 0) {
            query += `
                WHERE ${whereClauses.join(' AND ')}
            `;
        }

        if (outerConditions.length > 0) {
            const outer = await runOuterQuery({
                innerSql: query,
                replacements,
                outerConditions,
                sort,
                defaultOrder: 'x.work_request_id DESC, x.task_id ASC, x.task_assignment_id ASC, x.issue_id ASC',
                limit,
                offset,
                summary: {
                    work_requests_count: 'COUNT(DISTINCT x.work_request_id)',
                    tasks_count: 'COUNT(DISTINCT x.task_id)',
                    changes_count: 'COUNT(DISTINCT x.issue_id)'
                }
            });
            const unfiltered = await sequelize.query(
                `SELECT COUNT(*) AS total_rows ${query.slice(query.lastIndexOf('\n            FROM work_requests wr\n'), query.lastIndexOf('\n                WHERE '))} WHERE wr.is_deleted = 0`,
                { type: sequelize.QueryTypes.SELECT }
            );
            return res.json({
                data: outer.rows,
                total: outer.total,
                recordsTotal: Number(unfiltered[0]?.total_rows || 0),
                recordsFiltered: outer.total,
                summary: {
                    total: outer.total,
                    work_requests: outer.summary.work_requests_count,
                    tasks: outer.summary.tasks_count,
                    changes: outer.summary.changes_count
                }
            });
        }

        query += `
            ORDER BY ${orderByClause}
        `;

        // The page is row-level (request x task x assignee x change), so paging must count rows,
        // not distinct work requests (that cut pagination short). Counted over the main query's own
        // FROM/WHERE, which also gives the KPI summary.
        const fromSql = query.slice(
            query.lastIndexOf('\n            FROM work_requests wr\n'),
            query.lastIndexOf('\n                WHERE ')
        );
        const countSelect = `
            SELECT
                COUNT(*) AS total_rows,
                COUNT(DISTINCT wr.id) AS work_requests_count,
                COUNT(DISTINCT t.id) AS tasks_count,
                COUNT(DISTINCT ia.id) AS changes_count`;
        const countResult = await sequelize.query(
            `${countSelect} ${fromSql} WHERE ${whereClauses.join(' AND ')}`,
            { replacements, type: sequelize.QueryTypes.SELECT }
        );
        const total = Number(countResult[0]?.total_rows || 0);
        const summary = {
            total: total,
            work_requests: Number(countResult[0]?.work_requests_count || 0),
            tasks: Number(countResult[0]?.tasks_count || 0),
            changes: Number(countResult[0]?.changes_count || 0)
        };

        // whereClauses always starts with 'wr.is_deleted = 0'; only extra filters need a second count
        let recordsTotal = total;
        if (whereClauses.length > 1) {
            const unfilteredResult = await sequelize.query(
                `SELECT COUNT(*) AS total_rows ${fromSql} WHERE wr.is_deleted = 0`,
                { type: sequelize.QueryTypes.SELECT }
            );
            recordsTotal = Number(unfilteredResult[0]?.total_rows || 0);
        }

        if (limit !== -1) {
            query += ` LIMIT :limit OFFSET :offset`;
            replacements.limit = limit;
            replacements.offset = offset;
        }

        const results = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        res.json({
            data: results,
            total: total,
            recordsTotal: recordsTotal,
            recordsFiltered: total,
            summary
        });

    } catch (error) {
        console.error(
            'Error fetching work request tasks data:',
            error
        );

        res.status(500).json({
            error: 'Internal server error'
        });
    }
};

// Sequelize version of the grid filters (feedback and leaves). `fieldMap` maps a grid key to a
// model attribute or a '$assoc.attr$' path; keys without an entry are ignored.
function sequelizeGridConditions(filters, fieldMap) {
    const conditions = [];
    filters.forEach(filter => {
        const field = fieldMap[filter.key];
        if (!field) return;
        const target = typeof field === 'function' ? null : field;
        if (filter.type === 'contains') {
            conditions.push(typeof field === 'function' ? field(`%${filter.value}%`) : { [target]: { [Op.like]: `%${filter.value}%` } });
        } else if (filter.type === 'exact' && target) {
            conditions.push({ [target]: { [Op.in]: filter.values } });
        } else if (filter.type === 'range' && target) {
            const range = {};
            if (filter.from) range[Op.gte] = filter.from.value;
            if (filter.to) range[Op.lte] = filter.to.kind === 'date' ? `${filter.to.value} 23:59:59` : filter.to.value;
            conditions.push({ [target]: range });
        }
    });
    return conditions;
}

// Feedback author's division title(s), as SQL over the Feedbacks row
const FEEDBACK_DIVISION_SQL = '(SELECT GROUP_CONCAT(d_fb.title ORDER BY d_fb.title) FROM user_divisions ud_fb JOIN division d_fb ON d_fb.id = ud_fb.division_id WHERE ud_fb.user_id = `Feedbacks`.`user_id`)';

const getAllFeedback = async (req, res) => {
    try {
        const { userId, taskId, startDate, endDate } = req.query;
        const { page, limit, offset } = req.pagination;

        const where = { is_deleted: 0 };
        if (userId) where.user_id = userId;
        if (taskId) where.task_id = taskId;
        if (startDate) where.createdAt = { ...where.createdAt, [Op.gte]: new Date(startDate) };
        if (endDate) where.createdAt = { ...where.createdAt, [Op.lte]: new Date(endDate) };

        const total = await Feedbacks.count({ where });

        const conditions = [];
        const searchTerm = req.query.search ? req.query.search.replace(/%/g, '\\%').replace(/_/g, '\\_') : '';
        if (searchTerm) {
            const likeTerm = '%' + searchTerm + '%';
            conditions.push({
                [Op.or]: [
                    { question: { [Op.like]: likeTerm } },
                    { comments: { [Op.like]: likeTerm } },
                    { rating_functionality_comment: { [Op.like]: likeTerm } },
                    { rating_timeliness_comment: { [Op.like]: likeTerm } },
                    { rating_communication_comment: { [Op.like]: likeTerm } },
                    { '$task.task_name$': { [Op.like]: likeTerm } },
                    { '$task.TaskType.task_type$': { [Op.like]: likeTerm } },
                    { '$user.name$': { [Op.like]: likeTerm } },
                    { '$user.email$': { [Op.like]: likeTerm } },
                    sequelize.literal(`${FEEDBACK_DIVISION_SQL} LIKE ${sequelize.escape(likeTerm)}`)
                ]
            });
        }

        conditions.push(...sequelizeGridConditions(parseGridFilters(req.query), {
            id: 'id',
            question: 'question',
            task_id: 'task_id',
            task_name: '$task.task_name$',
            task_type: '$task.TaskType.task_type$',
            user_name: '$user.name$',
            user_id: 'user_id',
            user_email: '$user.email$',
            user_division: likeTerm => sequelize.literal(`${FEEDBACK_DIVISION_SQL} LIKE ${sequelize.escape(likeTerm)}`),
            functionality_comment: 'rating_functionality_comment',
            rating_functionality: 'rating_functionality',
            timeliness_comment: 'rating_timeliness_comment',
            rating_timeliness: 'rating_timeliness',
            communication_comment: 'rating_communication_comment',
            rating_communication: 'rating_communication',
            recommendation_score: 'recommendation_score',
            comments: 'comments',
            created_at: 'created_at',
            updated_at: 'updated_at'
        }));
        if (conditions.length) where[Op.and] = conditions;

        const dir = String(req.query.order_dir || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const orderMap = {
            id: [['id', dir]],
            question: [['question', dir]],
            task_id: [['task_id', dir]],
            task_name: [[{ model: Tasks, as: 'task' }, 'task_name', dir]],
            task_type: [[{ model: Tasks, as: 'task' }, { model: TaskType, as: 'TaskType' }, 'task_type', dir]],
            user_name: [[{ model: User, as: 'user' }, 'name', dir]],
            user_id: [['user_id', dir]],
            user_email: [[{ model: User, as: 'user' }, 'email', dir]],
            user_division: [[sequelize.literal(FEEDBACK_DIVISION_SQL), dir]],
            functionality_comment: [['rating_functionality_comment', dir]],
            timeliness_comment: [['rating_timeliness_comment', dir]],
            communication_comment: [['rating_communication_comment', dir]],
            rating_functionality: [['rating_functionality', dir]],
            rating_timeliness: [['rating_timeliness', dir]],
            rating_communication: [['rating_communication', dir]],
            recommendation_score: [['recommendation_score', dir]],
            comments: [['comments', dir]],
            created_at: [['created_at', dir]],
            updated_at: [['updated_at', dir]]
        };
        const hasOrderDir = ['ASC', 'DESC'].includes(String(req.query.order_dir || '').toUpperCase());
        const orderBy = (hasOrderDir && orderMap[req.query.order_column]) || [['created_at', 'DESC']];

        // Filters, sorting and paging only need the one-to-one joins; the user's divisions
        // (one-to-many) are loaded afterwards for the page rows, so LIMIT counts feedbacks.
        const filterIncludes = [
            { model: Tasks, as: 'task', attributes: [], include: [{ model: TaskType, as: 'TaskType', attributes: [] }] },
            { model: User, as: 'user', attributes: [] }
        ];
        const [filteredCount, pageIds, ratingRows] = await Promise.all([
            Feedbacks.count({ where, include: filterIncludes }),
            Feedbacks.findAll({
                attributes: ['id'], where, include: filterIncludes, raw: true,
                order: orderBy.concat([['id', 'DESC']]),
                ...(limit !== -1 ? { limit, offset } : {})
            }),
            Feedbacks.findAll({
                attributes: ['rating_functionality', 'rating_timeliness', 'rating_communication', 'recommendation_score'],
                where, include: filterIncludes, raw: true
            })
        ]);

        const ids = pageIds.map(row => row.id);
        const feedbacks = ids.length === 0 ? [] : await Feedbacks.findAll({
            where: { id: ids },
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'task_type_id'],
                    include: [{ model: TaskType, as: 'TaskType', attributes: ['id', 'task_type'] }]
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email'],
                    include: [{ model: Division, as: 'Divisions', attributes: ['id', 'title'] }]
                }
            ]
        });
        const position = new Map(ids.map((id, index) => [id, index]));
        feedbacks.sort((a, b) => position.get(a.id) - position.get(b.id));

        // KPI summary over all filtered feedback: average ratings and NPS (promoters 9-10, detractors 0-6)
        const average = key => {
            const values = ratingRows.map(row => row[key]).filter(v => v !== null && v !== undefined && v !== '').map(Number);
            return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
        };
        const scores = ratingRows.map(row => row.recommendation_score).filter(v => v !== null && v !== undefined && v !== '').map(Number);
        const summary = {
            total: filteredCount,
            avg_functionality: average('rating_functionality'),
            avg_timeliness: average('rating_timeliness'),
            avg_communication: average('rating_communication'),
            avg_recommendation: average('recommendation_score'),
            promoters: scores.filter(v => v >= 9).length,
            passives: scores.filter(v => v >= 7 && v <= 8).length,
            detractors: scores.filter(v => v <= 6).length,
            nps: scores.length ? Math.round((scores.filter(v => v >= 9).length - scores.filter(v => v <= 6).length) / scores.length * 100) : null
        };

        res.json({ success: true, data: feedbacks, total: feedbacks.length, recordsTotal: total, recordsFiltered: filteredCount, summary });
    } catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const getMasterCardData = async (req, res) => {
    try {
        const { page, limit, offset } = req.pagination;
        const replacements = {};
        const whereClauses = [];

        const searchTerm = req.query.search ? req.query.search : '';
        if (searchTerm) {
            const likeTerm = '%' + searchTerm + '%';
            const searchColumns = [
                'division_name',
                'task_type_name',
                'unit_basis',
                'CAST(new_work_rate AS CHAR)',
                'CAST(changes_rate AS CHAR)',
                'CAST(concept_charge AS CHAR)',
                'CAST(ai_charges AS CHAR)',
                'CAST(no_of_resize_pages AS CHAR)',
                'CAST(last_moment AS CHAR)',
                'financial_year'
            ];
            const searchConditions = searchColumns.map(col => col + ' LIKE :searchTerm');
            whereClauses.push('(' + searchConditions.join(' OR ') + ')');
            replacements.searchTerm = likeTerm;
        }

        applyGridFilters({
            filters: parseGridFilters(req.query),
            directMap: {
                id: 'CAST(id AS CHAR)',
                division_name: 'division_name',
                task_type_name: 'task_type_name',
                unit_basis: 'unit_basis',
                new_work_rate: 'new_work_rate',
                changes_rate: 'changes_rate',
                concept_charge: 'concept_charge',
                ai_charges: 'ai_charges',
                no_of_resize_pages: 'no_of_resize_pages',
                last_moment: 'CAST(last_moment AS CHAR)',
                financial_year: 'financial_year'
            },
            outerKeys: new Set(),
            whereClauses,
            replacements
        });

        const allowedSortColumns = [
            'id', 'division_name', 'task_type_name', 'unit_basis',
            'new_work_rate', 'changes_rate', 'concept_charge', 'ai_charges',
            'no_of_resize_pages', 'last_moment', 'financial_year'
        ];

        let orderByClause = 'id ASC';
        const orderCol = req.query.order_column;
        const orderDir = req.query.order_dir;
        if (orderCol && allowedSortColumns.includes(orderCol) && orderDir && ['ASC','DESC'].includes(orderDir.toUpperCase())) {
            orderByClause = orderCol + ' ' + orderDir.toUpperCase();
        }

        const dataWhereClause = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';
        // Also returns the KPI summary over all filtered rates
        const countQuery = `SELECT COUNT(*) AS total,
                COUNT(DISTINCT division_name) AS divisions,
                COUNT(DISTINCT task_type_name) AS task_types,
                COUNT(DISTINCT financial_year) AS financial_years,
                AVG(new_work_rate) AS avg_new_work_rate,
                AVG(changes_rate) AS avg_changes_rate
            FROM master_card${dataWhereClause}`;

        const countResult = await sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT });
        const total = countResult[0]?.total || 0;
        const counts = countResult[0] || {};
        const summary = {
            total: Number(total),
            divisions: Number(counts.divisions || 0),
            task_types: Number(counts.task_types || 0),
            financial_years: Number(counts.financial_years || 0),
            avg_new_work_rate: counts.avg_new_work_rate === null || counts.avg_new_work_rate === undefined ? null : Math.round(Number(counts.avg_new_work_rate) * 100) / 100,
            avg_changes_rate: counts.avg_changes_rate === null || counts.avg_changes_rate === undefined ? null : Math.round(Number(counts.avg_changes_rate) * 100) / 100
        };

        const totalUnfilteredQuery = 'SELECT COUNT(*) AS total FROM master_card';
        const totalUnfilteredResult = await sequelize.query(totalUnfilteredQuery, { replacements: {}, type: sequelize.QueryTypes.SELECT });
        const recordsTotal = totalUnfilteredResult[0]?.total || 0;

        let query = `
            SELECT id, division_id, division_name, task_type_id, task_type_name,
                   unit_basis, new_work_rate, changes_rate, concept_charge, ai_charges,
                   no_of_resize_pages, last_moment, financial_year
            FROM master_card
        `;

        if (whereClauses.length > 0) {
            query += dataWhereClause;
        }

        query += ` ORDER BY ${orderByClause}`;

        if (limit !== -1) {
            query += ` LIMIT :limit OFFSET :offset`;
            replacements.limit = limit;
            replacements.offset = offset;
        }

        const rows = await sequelize.query(query, { replacements, type: sequelize.QueryTypes.SELECT });

        res.json({ success: true, data: rows, total: total, recordsTotal: recordsTotal, recordsFiltered: total, summary });
    } catch (error) {
        console.error('Error fetching master card data:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const getFinancialYears = async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT DISTINCT financial_year FROM master_card
            WHERE financial_year IS NOT NULL AND financial_year != ''
            ORDER BY financial_year ASC
        `);
        const years = rows.map(r => r.financial_year);
        res.json({ success: true, data: years });
    } catch (error) {
        console.error('Error fetching financial years:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const uploadMasterCard = async (req, res) => {
    const jobId = req.body.jobId || req.query.jobId;
    let file, ext;
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        file = req.files.file;
        const allowedTypes = ['.xlsx', '.csv'];
        ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!allowedTypes.includes(ext)) {
            return res.status(400).json({ success: false, error: 'Only .xlsx and .csv files are allowed' });
        }

        let rows = [];
        if (ext === '.csv') {
            rows = await parseCSVRows(file.data);
        } else {
            rows = await parseExcelRows(file.data);
        }

        if (!rows.length) {
            sendProgress(jobId, 100, 'No data rows found in file', 0);
            return res.json({ success: true, message: 'No data rows found', rowsProcessed: 0 });
        }

        const normalRows = rows.map(r => {
            const obj = {};
            for (const k in r) { obj[k.toLowerCase()] = r[k]; }
            return obj;
        });

        const seen = {};
        normalRows.forEach(row => {
            const div = (row['vertical'] || row['division_name'] || row['division'] || '').toString().trim();
            const taskType = (row['task type'] || row['task_type_name'] || row['task_type'] || '').toString().trim();
            const financialYear = (row['financial year'] || row['financial_year'] || '').toString().trim() || 'FY 25-26';
            if (div && taskType) {
                var key = (div.toLowerCase() + '|' + taskType.toLowerCase() + '|' + financialYear.toLowerCase());
                seen[key] = row;
            }
        });
        const uniqueRows = Object.values(seen).filter(r => {
            const div = (r['vertical'] || r['division_name'] || r['division'] || '').toString().trim();
            const task = (r['task type'] || r['task_type_name'] || r['task_type'] || '').toString().trim();
            return div && task;
        });

        const total = uniqueRows.length;
        sendProgress(jobId, 0, `Parsed ${rows.length} rows, ${total} unique after dedup`, rows.length);

        if (total === 0) {
            sendProgress(jobId, 100, 'No valid data rows found (check column names)', 0);
            return res.json({ success: true, message: 'No valid data rows found', rowsProcessed: 0 });
        }

        sendProgress(jobId, 0, `Importing ${total} unique rows (additive)...`, total);

        const chunkSize = 100;
        let inserted = 0;

        for (let i = 0; i < uniqueRows.length; i += chunkSize) {
            const chunk = uniqueRows.slice(i, i + chunkSize);
            const values = [];

            for (const row of chunk) {
                const divisionName = (row['vertical'] || row['division_name'] || row['division'] || '').toString().trim();
                const taskType = (row['task type'] || row['task_type_name'] || row['task_type'] || '').toString().trim();
                const newWorkRate = parseFloat(row['new work rate'] || row['new_work_rate'] || 0) || 0;
                const changesRate = parseFloat(row['changes work rate'] || row['changes_rate'] || 0) || 0;
                const conceptCharge = parseFloat(row['concept charge'] || row['concept_charge'] || 0) || 0;
                const aiCharges = parseFloat(row['ai charges'] || row['ai_charges'] || 0) || 0;
                const lastMoment = parseFloat(row['last moment'] || row['last_moment'] || 0) || 0;
                const financialYear = (row['financial year'] || row['financial_year'] || 'FY 25-26').toString().trim();
                const unitBasis = (row['unit basis'] || row['unit_basis'] || '').toString().trim();
                const noOfResize = parseFloat(row['no of resize pages'] || row['no_of_resize_pages'] || 0) || 0;

                const divRow = await sequelize.query(
                    `SELECT id, title FROM division WHERE title = ? LIMIT 1`,
                    { replacements: [divisionName], type: sequelize.QueryTypes.SELECT }
                );
                let divisionId, divisionTitle;
                if (divRow.length) {
                    divisionId = divRow[0].id;
                    divisionTitle = divRow[0].title;
                } else {
                    const result = await sequelize.query(
                        `INSERT INTO division (title, department_id, created_at, updated_at) VALUES (?, 1, NOW(), NOW())`,
                        { replacements: [divisionName], type: sequelize.QueryTypes.INSERT }
                    );
                    divisionId = result[0];
                    divisionTitle = divisionName;
                }

                const taskRow = await sequelize.query(
                    `SELECT id, task_type FROM task_type WHERE task_type = ? LIMIT 1`,
                    { replacements: [taskType], type: sequelize.QueryTypes.SELECT }
                );
                let taskTypeId, taskTypeValue;
                if (taskRow.length) {
                    taskTypeId = taskRow[0].id;
                    taskTypeValue = taskRow[0].task_type;
                } else {
                    const result = await sequelize.query(
                        `INSERT INTO task_type (task_type, created_at, updated_at) VALUES (?, NOW(), NOW())`,
                        { replacements: [taskType], type: sequelize.QueryTypes.INSERT }
                    );
                    taskTypeId = result[0];
                    taskTypeValue = taskType;
                }

                // sequelize.escape also escapes backslashes (quote doubling alone let a value ending in \ break out)
                values.push(`(${Number(divisionId)}, ${sequelize.escape(divisionTitle)}, ${Number(taskTypeId)}, ${sequelize.escape(taskTypeValue)}, ${sequelize.escape(unitBasis)}, ${newWorkRate}, ${changesRate}, ${conceptCharge}, ${aiCharges}, ${noOfResize}, ${lastMoment}, ${sequelize.escape(financialYear)}, NOW(), NOW())`);
            }

            if (values.length) {
                const sql = `INSERT INTO master_card (division_id, division_name, task_type_id, task_type_name, unit_basis, new_work_rate, changes_rate, concept_charge, ai_charges, no_of_resize_pages, last_moment, financial_year, created_at, updated_at) VALUES ${values.join(', ')}`;
                await sequelize.query(sql);
                inserted += values.length;
            }

            const processed = i + chunk.length;
            const progress = Math.round((processed / total) * 100);
            sendProgress(jobId, progress, `Processed ${processed}/${total} rows (${inserted} inserted)`, total);
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        await clearAdminCache();
        sendProgress(jobId, 100, `Complete! ${inserted} rows imported`, total);

        const fileExt = ext.replace('.', '');
        await sequelize.query(
            `INSERT INTO master_card_history (source_file, file_size, file_type, upload_job_id, status, rows_processed) VALUES (?, ?, ?, ?, ?, ?)`,
            { replacements: [file.name, file.size, fileExt, jobId || null, 'success', inserted] }
        );

        res.json({ success: true, message: 'Upload complete', rowsProcessed: inserted });
    } catch (error) {
        console.error('Error uploading master card:', error);
        sendProgress(jobId, 0, `Error: ${error.message}`, 0);

        if (file) {
            const fileExt = ext.replace('.', '');
            await sequelize.query(
                `INSERT INTO master_card_history (source_file, file_size, file_type, upload_job_id, status, rows_processed) VALUES (?, ?, ?, ?, ?, ?)`,
                { replacements: [file.name, file.size, fileExt, jobId || null, 'failed', 0] }
            ).catch(() => {});
        }

        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (jobId && sseClients[jobId]) {
            delete sseClients[jobId];
        }
    }
};

const uploadLeaves = async (req, res) => {
    const jobId = req.body.jobId || req.query.jobId;
    let file, ext;
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        file = req.files.file;
        const allowedTypes = ['.xlsx', '.csv'];
        ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!allowedTypes.includes(ext)) {
            return res.status(400).json({ success: false, error: 'Only .xlsx and .csv files are allowed' });
        }

        let rows = [];
        if (ext === '.csv') {
            rows = await parseCSVRows(file.data);
        } else {
            rows = await parseExcelRows(file.data);
        }

        if (!rows.length) {
            sendProgress(jobId, 100, 'No data rows found in file', 0);
            return res.json({ success: true, message: 'No data rows found', rowsProcessed: 0 });
        }

        const normalRows = rows.map(r => {
            const obj = {};
            for (const k in r) { obj[k.toLowerCase()] = r[k]; }
            return obj;
        });

        const total = normalRows.length;
        sendProgress(jobId, 0, `Parsed ${rows.length} rows`, rows.length);

        const chunkSize = 100;
        let inserted = 0;
        let skipped = 0;

        for (let i = 0; i < normalRows.length; i += chunkSize) {
            const chunk = normalRows.slice(i, i + chunkSize);

             for (const row of chunk) {
                const fromDateRaw = (row['from_date'] || row['date'] || '').toString().trim();
                const toDateRaw = (row['to_date'] || row['date'] || fromDateRaw).toString().trim();
                const userId = (row['user_id'] || row['user'] || '').toString().trim();
                const leaveDayType = (row['leave_day_type'] || row['day type'] || 'Full day').toString().trim();
                const leaveType = (row['leave_type'] || row['type'] || 'Unplanned').toString().trim();
                const status = (row['status'] || 'Inform').toString().trim();
                const leaveReason = (row['leave_reason'] || row['reason'] || 'Feeling not well').toString().trim();
                const remark = row['remark'] || null;
                const day = row['day'] || null;
                const month = row['month'] || null;
                const year = row['year'] || null;
                const vertical = (row['vertical'] || row['division'] || '').toString().trim() || null;
                const reason = row['reason'] || null;

                function parseExcelDate(val){
                    if(!val || val === 'NULL' || val === '' || val === 'undefined'){ return null; }
                    if(typeof val === 'number'){
                        var utcDate = new Date(Math.round((val - 25569) * 86400 * 1000));
                        return utcDate.toISOString().split('T')[0];
                    }
                    if(val instanceof Date){ return val.toISOString().split('T')[0]; }
                    var str = val.toString().trim();
                    var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                    if(isoMatch){ return str; }
                    var ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                    if(ddmmyyyy){
                        return ddmmyyyy[3]+'-'+ddmmyyyy[2].padStart(2,'0')+'-'+ddmmyyyy[1].padStart(2,'0');
                    }
                    var ddmmyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
                    if(ddmmyy){
                        var yr = parseInt(ddmmyy[3]);
                        yr = yr < 50 ? 2000+yr : 1900+yr;
                        return yr+'-'+ddmmyy[2].padStart(2,'0')+'-'+ddmmyy[1].padStart(2,'0');
                    }
                    var mmddyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
                    var parsed = new Date(str);
                    if(!isNaN(parsed.getTime())){ return parsed.toISOString().split('T')[0]; }
                    return null;
                }

                var fromDate = parseExcelDate(fromDateRaw);
                var toDate = parseExcelDate(toDateRaw);

                if(!fromDate && toDate){ fromDate = toDate; }
                if(!toDate && fromDate){ toDate = fromDate; }

                if(leaveDayType !== 'Full day' && fromDate && toDate && fromDate !== toDate){
                    toDate = fromDate;
                }

                let daysCount = row['days_count'] ? parseFloat(row['days_count']) : null;

                if (fromDate && toDate) {
                    const from = new Date(fromDate);
                    const to = new Date(toDate);
                    const deltaDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
                    if (leaveDayType === 'Half day' || leaveDayType === 'Short Hours') {
                        daysCount = deltaDays * 0.5;
                    } else {
                        daysCount = deltaDays;
                    }
                }

                try {
                    await Leave.create({
                        from_date: fromDate,
                        to_date: toDate,
                        user_id: parseInt(userId),
                        leave_day_type: leaveDayType,
                        leave_type: leaveType,
                        status: status,
                        leave_reason: leaveReason,
                        remark: remark,
                        day: day,
                        month: month,
                        year: year ? parseInt(year) : null,
                        vertical: vertical,
                        days_count: daysCount,
                        reason: reason
        });


        // ---------------------------------------
        // MAIN QUERY
        // ---------------------------------------
                    inserted++;
                } catch (rowErr) {
                    console.error('Error inserting leave row:', rowErr.message, JSON.stringify(row));
                    skipped++;
                }
            }

            const processed = i + chunk.length;
            const progress = Math.round((processed / total) * 100);
            sendProgress(jobId, progress, `Processed ${processed}/${total} rows (${inserted} inserted, ${skipped} skipped)`, total);
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        sendProgress(jobId, 100, `Complete! ${inserted} rows imported, ${skipped} skipped`, total);

        if (file) {
            const fileExt = ext.replace('.', '');
            await sequelize.query(
                `INSERT INTO leave_history (source_file, file_size, file_type, upload_job_id, status, rows_processed) VALUES (?, ?, ?, ?, ?, ?)`,
                { replacements: [file.name, file.size, fileExt, jobId || null, 'success', inserted] }
            ).catch(() => {});
        }

        res.json({ success: true, message: 'Upload complete', rowsProcessed: inserted, rowsSkipped: skipped });
    } catch (error) {
        console.error('Error uploading leaves:', error);
        sendProgress(jobId, 0, `Error: ${error.message}`, 0);

        if (file) {
            const fileExt = ext ? ext.replace('.', '') : '';
            await sequelize.query(
                `INSERT INTO leave_history (source_file, file_size, file_type, upload_job_id, status, rows_processed) VALUES (?, ?, ?, ?, ?, ?)`,
                { replacements: [file.name, file.size, fileExt, jobId || null, 'failed', 0] }
            ).catch(() => {});
        }

        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (jobId && sseClients[jobId]) {
            delete sseClients[jobId];
        }
    }
};

const updateMasterCard = async (req, res) => {
    try {
        const { id } = req.params;
        const { unit_basis, new_work_rate, changes_rate, concept_charge, ai_charges, no_of_resize_pages, last_moment, financial_year } = req.body;
        const setParts = [];
        const replacements = [];
        if (new_work_rate !== undefined) {
            setParts.push(`new_work_rate = ?`);
            replacements.push(new_work_rate);
        }
        if (changes_rate !== undefined) {
            setParts.push(`changes_rate = ?`);
            replacements.push(changes_rate);
        }
        if (concept_charge !== undefined) {
            setParts.push(`concept_charge = ?`);
            replacements.push(concept_charge);
        }
        if (unit_basis !== undefined) {
            setParts.push(`unit_basis = ?`);
            replacements.push(unit_basis);
        }
        if (ai_charges !== undefined) {
            setParts.push(`ai_charges = ?`);
            replacements.push(ai_charges);
        }
        if (last_moment !== undefined) {
            setParts.push(`last_moment = ?`);
            replacements.push(last_moment);
        }
        if (financial_year !== undefined) {
            setParts.push(`financial_year = ?`);
            replacements.push(financial_year);
        }
        if (no_of_resize_pages !== undefined) {
            setParts.push(`no_of_resize_pages = ?`);
            replacements.push(no_of_resize_pages);
        }
        if (setParts.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }
        setParts.push(`updated_at = NOW()`);
        replacements.push(id);
        const sql = `UPDATE master_card SET ${setParts.join(', ')} WHERE id = ?`;
        await sequelize.query(sql, { replacements });
        await clearAdminCache();
        const rows = await sequelize.query(`SELECT * FROM master_card WHERE id = ?`, { replacements: [id], type: sequelize.QueryTypes.SELECT });
        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }
        res.json({ success: true, data: rows[0], message: 'Updated successfully' });
    } catch (error) {
        console.error('Error updating master card:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateMasterCardField = async (req, res) => {
    try {
        const { field } = req.params;
        const { value } = req.body;
        const numericFields = ['concept_charge', 'ai_charges', 'last_moment', 'no_of_resize_pages'];
        const stringFields = ['financial_year', 'unit_basis'];
        const validFields = [...numericFields, ...stringFields];
        if(!validFields.includes(field)){
            return res.status(400).json({ success: false, error: 'Invalid field' });
        }
        let updateVal;
        if(stringFields.includes(field)){
            updateVal = value;
        } else {
            updateVal = parseFloat(value);
            if(isNaN(updateVal)){
                return res.status(400).json({ success: false, error: 'Invalid numeric value' });
            }
        }
        const sql = `UPDATE master_card SET ${field} = ?, updated_at = NOW()`;
        await sequelize.query(sql, { replacements: [updateVal] });
        await clearAdminCache();
        res.json({ success: true, message: `${field} updated for all records` });
    } catch (error) {
        console.error('Error updating master card field:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteMasterCard = async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await sequelize.query(`DELETE FROM master_card WHERE id = ?`, { replacements: [id] });
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }
        await clearAdminCache();
        res.json({ success: true, message: 'Record deleted successfully' });
    } catch (error) {
        console.error('Error deleting master card:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Values for the admin grids' select filters (lookup tables + status enums)
const getFilterOptions = async (req, res) => {
    try {
        const list = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT }).then(rows => rows.map(row => row.v));
        const fyOf = col => `CONCAT('FY ', YEAR(${col}) - (MONTH(${col}) < 4), '-', RIGHT(YEAR(${col}) - (MONTH(${col}) < 4) + 1, 2))`;
        const [requestTypes, projectTypes, taskTypes, divisions, digilabsVerticals, financialYears, creativeTeam, managers, clients, deadlineFinancialYears] = await Promise.all([
            list("SELECT DISTINCT request_type AS v FROM request_type WHERE request_type IS NOT NULL AND request_type <> '' ORDER BY v"),
            list("SELECT DISTINCT project_type AS v FROM project_type WHERE project_type IS NOT NULL AND project_type <> '' ORDER BY v"),
            list("SELECT DISTINCT task_type AS v FROM task_type WHERE task_type IS NOT NULL AND task_type <> '' ORDER BY v"),
            list("SELECT DISTINCT title AS v FROM division WHERE title IS NOT NULL AND title <> '' ORDER BY v"),
            // Digilabs' own verticals (Graphic, Video, …), for the task-manager vertical filters
            list("SELECT DISTINCT d.title AS v FROM division d JOIN department dep ON dep.id = d.department_id WHERE dep.department_name = 'Digilabs' AND d.title IS NOT NULL AND d.title <> '' ORDER BY v"),
            list("SELECT DISTINCT financial_year AS v FROM master_card WHERE financial_year IS NOT NULL AND financial_year <> '' ORDER BY v"),
            list("SELECT DISTINCT name AS v FROM users WHERE job_role_id IN (2, 3, 4) AND name IS NOT NULL ORDER BY v"),
            list("SELECT DISTINCT name AS v FROM users WHERE job_role_id IN (1, 2, 3) AND name IS NOT NULL ORDER BY v"),
            list("SELECT DISTINCT u.name AS v FROM work_requests wr JOIN users u ON u.id = wr.user_id WHERE wr.is_deleted = 0 AND u.name IS NOT NULL ORDER BY v"),
            // Financial years (April-March) of task and change deadlines, for the Tasks / Changes "fy" filter
            list(`SELECT v FROM (
                SELECT DISTINCT ${fyOf('deadline')} AS v FROM tasks WHERE is_deleted = 0 AND deadline IS NOT NULL
                UNION
                SELECT DISTINCT ${fyOf('deadline')} AS v FROM issue_assignments WHERE is_deleted = 0 AND deadline IS NOT NULL
            ) fy ORDER BY v DESC`)
        ]);
        res.json({
            success: true,
            data: {
                request_types: requestTypes,
                project_types: projectTypes,
                task_types: taskTypes,
                divisions,
                digilabs_verticals: digilabsVerticals,
                financial_years: financialYears,
                deadline_financial_years: deadlineFinancialYears,
                creative_team: creativeTeam,
                managers,
                clients,
                priorities: ['low', 'medium', 'high', 'critical'],
                work_request_statuses: WORK_REQUEST_STATUSES,
                task_statuses: TASK_STATUSES,
                issue_statuses: ISSUE_STATUSES,
                review_statuses: ['pending', 'approved', 'change_request'],
                review_stages: ['not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'],
                leave_day_types: ['Full day', 'Half day', 'Short Hours', 'WFH'],
                leave_types: ['Planned', 'Unplanned'],
                leave_statuses: ['Inform', 'Not Inform']
            }
        });
    } catch (error) {
        console.error('Error fetching filter options:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Who the Overview is about. Super Admin sees everyone; every other role sees themselves and
// their team (everyone sharing one of their divisions, the same team as `my-team`).
// ?division_id= narrows to one division's people and ?user_id= to one person, both only
// within what the caller may see. `people` is null when nothing narrows the admin's view.
// `team` is the pool whose work counts for `people`: the people themselves, plus (for one
// person) everyone sharing one of that person's divisions. `params` defaults to req.query.
async function resolveOverviewScope(req, params = req.query) {
    const select = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const me = req.user.id;
    const isAdmin = req.user.jobRole && req.user.jobRole.id === 1;
    const divisionId = params.division_id ? parseId(params.division_id) : null;
    const userId = params.user_id ? parseId(params.user_id) : null;
    if ((params.division_id && !divisionId) || (params.user_id && !userId)) {
        return { status: 400, error: 'Invalid division_id or user_id' };
    }

    const divisions = isAdmin
        ? await select('SELECT id, title FROM division ORDER BY title')
        : await select('SELECT DISTINCT d.id, d.title FROM user_divisions ud JOIN division d ON d.id = ud.division_id WHERE ud.user_id = :me ORDER BY d.title', { me });
    const divisionIds = divisions.map(d => d.id);

    // Roster for the person filter: all users for the admin, the team for everyone else
    const roster = await select(`SELECT u.id, u.name, jr.role_title AS role, u.job_role_id, u.account_status,
            (SELECT GROUP_CONCAT(ud.division_id) FROM user_divisions ud WHERE ud.user_id = u.id) AS division_ids
        FROM users u LEFT JOIN job_role jr ON jr.id = u.job_role_id
        WHERE u.name IS NOT NULL AND ${isAdmin ? '1 = 1' : `(u.id = :me${divisionIds.length ? ' OR u.id IN (SELECT ud.user_id FROM user_divisions ud WHERE ud.division_id IN (:divisionIds))' : ''})`}
        ORDER BY u.name`, { me, divisionIds });
    roster.forEach(u => { u.division_ids = u.division_ids ? String(u.division_ids).split(',').map(Number) : []; });

    if (divisionId && !divisionIds.includes(divisionId)) return { status: 403, error: 'You cannot view this division' };
    if (userId && !roster.some(u => u.id === userId)) return { status: 403, error: 'You cannot view this user' };

    let people = isAdmin ? null : roster.map(u => u.id);
    if (divisionId) people = roster.filter(u => u.division_ids.includes(divisionId)).map(u => u.id);
    let team = people;
    if (userId) {
        people = [userId];
        if (!divisionId) {
            const own = (roster.find(u => u.id === userId) || {}).division_ids || [];
            team = roster.filter(u => u.id === userId || u.division_ids.some(id => own.includes(id))).map(u => u.id);
        }
    }
    // a division with no members: keep the IN list valid and match nobody
    if (people && !people.length) people = [0];
    if (team && !team.length) team = [0];

    return { isAdmin, me, divisionId, userId, divisions, roster, people, team };
}

// SQL conditions (no leading AND) that limit work requests (alias wr), tasks (t), changes (ia)
// and feedback (f) to an Overview scope; null when the scope is everything. Uses the
// replacements :scopePeople and :scopeTeam (scopeReplacements). The work counts for the people
// when it is assigned to them or raised by them; work on a request they manage counts only when
// it is not assigned yet or assigned to someone in their team, so a manager's requests do not
// pull in other verticals' tasks. A request without live tasks counts for its managers.
function overviewScopeSql(scope) {
    if (!scope || !scope.people) return null;
    const assignedTask = (taskAlias, list) => `EXISTS (SELECT 1 FROM task_assignments s_ta WHERE s_ta.task_id = ${taskAlias}.id AND s_ta.user_id IN (${list}))`;
    const assignedChange = (alias, list) => `EXISTS (SELECT 1 FROM issue_user_assignments s_iua WHERE s_iua.issue_assignment_id = ${alias}.id AND s_iua.user_id IN (${list}))`;
    const managed = wrAlias => `EXISTS (SELECT 1 FROM work_request_managers s_wrm WHERE s_wrm.work_request_id = ${wrAlias}.id AND s_wrm.manager_id IN (:scopePeople))`;
    const taskForTeam = taskAlias => `(${assignedTask(taskAlias, ':scopeTeam')} OR NOT EXISTS (SELECT 1 FROM task_assignments s_ta0 WHERE s_ta0.task_id = ${taskAlias}.id))`;
    // raised by the people, or managed by them with `teamOk` (the item is the team's work)
    const viaRequest = (taskAlias, teamOk) => `EXISTS (SELECT 1 FROM work_requests s_wr WHERE s_wr.id = ${taskAlias}.work_request_id
            AND (s_wr.user_id IN (:scopePeople) OR (${managed('s_wr')} AND ${teamOk})))`;
    const task = taskAlias => `(${assignedTask(taskAlias, ':scopePeople')} OR ${viaRequest(taskAlias, taskForTeam(taskAlias))})`;
    const changeForTeam = `(${assignedChange('ia', ':scopeTeam')}
            OR (NOT EXISTS (SELECT 1 FROM issue_user_assignments s_iua0 WHERE s_iua0.issue_assignment_id = ia.id) AND ${taskForTeam('s_it')}))`;
    return {
        wr: `(wr.user_id IN (:scopePeople)
            OR EXISTS (SELECT 1 FROM tasks s_t WHERE s_t.work_request_id = wr.id AND s_t.is_deleted = 0 AND ${task('s_t')})
            OR EXISTS (SELECT 1 FROM tasks s_t2 JOIN issue_assignments s_ia ON s_ia.task_id = s_t2.id AND s_ia.is_deleted = 0
                WHERE s_t2.work_request_id = wr.id AND ${assignedChange('s_ia', ':scopePeople')})
            OR (${managed('wr')} AND NOT EXISTS (SELECT 1 FROM tasks s_t3 WHERE s_t3.work_request_id = wr.id AND s_t3.is_deleted = 0)))`,
        task: task('t'),
        issue: `(${assignedChange('ia', ':scopePeople')}
            OR ia.requested_by_user_id IN (:scopePeople)
            OR EXISTS (SELECT 1 FROM tasks s_it WHERE s_it.id = ia.task_id
                AND (${assignedTask('s_it', ':scopePeople')} OR ${viaRequest('s_it', changeForTeam)})))`,
        feedback: `(f.user_id IN (:scopePeople) OR EXISTS (SELECT 1 FROM tasks s_ft WHERE s_ft.id = f.task_id AND ${task('s_ft')}))`
    };
}
const scopeReplacements = scope => (scope && scope.people ? { scopePeople: scope.people, scopeTeam: scope.team || scope.people } : {});

// Grid endpoints (projects, tasks, changes) opened from the Overview carry ?scope=
// {"team":1} / {"division_id":n} / {"user_id":n}: the same scope as the overview card, so the
// grid lists exactly what the card counted. Returns { error, status } | { sql } | null.
async function gridOverviewScope(req) {
    if (!req.query.scope) return null;
    let params;
    try { params = JSON.parse(req.query.scope); } catch (e) { params = null; }
    if (!params || typeof params !== 'object' || Array.isArray(params)) return { status: 400, error: 'Invalid scope' };
    const scope = await resolveOverviewScope(req, { division_id: params.division_id, user_id: params.user_id });
    if (scope.error) return scope;
    return { sql: overviewScopeSql(scope), replacements: scopeReplacements(scope) };
}

// Cross-entity KPIs, trends and per-person totals for the admin Overview page, limited to the
// caller's scope (see resolveOverviewScope). Optional ?from=&to= (YYYY-MM-DD) limit everything
// to items created in that range; the monthly trend covers the 12 months up to `to`.
// Work pages = tasks.task_count, change pages = issue_assignments.task_count.
const getOverviewData = async (req, res) => {
    try {
        const scope = await resolveOverviewScope(req);
        if (scope.error) return res.status(scope.status).json({ success: false, error: scope.error });
        const { people } = scope;

        const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
        const from = isDate(req.query.from) ? req.query.from : null;
        const to = isDate(req.query.to) ? req.query.to : null;
        const replacements = Object.assign({ from, to }, scopeReplacements(scope));
        const range = column => [from ? `${column} >= :from` : null, to ? `${column} < DATE_ADD(:to, INTERVAL 1 DAY)` : null].filter(Boolean).map(c => ` AND ${c}`).join('');
        const select = (sql) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
        const counts = (column, statuses) => Object.entries(statusCountSql(column, statuses)).map(([key, sql]) => `${sql} AS ${key}`).join(', ');

        // Scope rules: see overviewScopeSql. Aliases: wr, t, ia, f.
        const scopeSql = overviewScopeSql(scope);
        const wrScope = scopeSql ? ` AND ${scopeSql.wr}` : '';
        const taskScope = scopeSql ? ` AND ${scopeSql.task}` : '';
        const issueScope = scopeSql ? ` AND ${scopeSql.issue}` : '';
        const feedbackScope = scopeSql ? ` AND ${scopeSql.feedback}` : '';

        const openTask = "t.status NOT IN ('completed', 'cancelled', 'rejected', 'draft')";
        const openIssue = "ia.status NOT IN ('completed', 'cancelled', 'rejected')";
        const [wrRow, taskRow, issueRow, clientRow, feedbackRow, monthly, byVertical, byTaskType, workload, topClients, peopleRows] = await Promise.all([
            select(`SELECT COUNT(*) AS total, ${counts('wr.status', WORK_REQUEST_STATUSES)}
                FROM work_requests wr WHERE wr.is_deleted = 0${range('wr.created_at')}${wrScope}`),
            select(`SELECT COUNT(*) AS total, ${counts('t.status', TASK_STATUSES)},
                    SUM(CASE WHEN ${openTask} AND DATE(t.deadline) < CURDATE() THEN 1 ELSE 0 END) AS overdue,
                    SUM(CASE WHEN ${openTask} AND DATE(t.deadline) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS due_7_days,
                    SUM(CASE WHEN t.status = 'completed' AND t.review_stage = 'final_approved' THEN 1 ELSE 0 END) AS final_approved,
                    SUM(COALESCE(t.task_count, 0)) AS work_pages,
                    SUM(CASE WHEN t.status = 'completed' THEN COALESCE(t.task_count, 0) ELSE 0 END) AS completed_work_pages
                FROM tasks t WHERE t.is_deleted = 0${range('t.created_at')}${taskScope}`),
            select(`SELECT COUNT(*) AS total, ${counts('ia.status', ISSUE_STATUSES)}, COUNT(DISTINCT ia.task_id) AS tasks_with_changes,
                    SUM(COALESCE(ia.task_count, 0)) AS change_pages,
                    SUM(CASE WHEN ia.status = 'completed' THEN COALESCE(ia.task_count, 0) ELSE 0 END) AS completed_change_pages
                FROM issue_assignments ia WHERE ia.is_deleted = 0${range('ia.created_at')}${issueScope}`),
            select(`SELECT COUNT(DISTINCT wr.user_id) AS clients, COUNT(DISTINCT wr.request_type_id) AS verticals
                FROM work_requests wr WHERE wr.is_deleted = 0${range('wr.created_at')}${wrScope}`),
            select(`SELECT COUNT(*) AS total, AVG(f.rating_functionality) AS functionality, AVG(f.rating_timeliness) AS timeliness,
                    AVG(f.rating_communication) AS communication,
                    SUM(CASE WHEN f.recommendation_score >= 9 THEN 1 ELSE 0 END) AS promoters,
                    SUM(CASE WHEN f.recommendation_score <= 6 THEN 1 ELSE 0 END) AS detractors,
                    COUNT(f.recommendation_score) AS scored
                FROM feedbacks f WHERE f.is_deleted = 0${range('f.created_at')}${feedbackScope}`),
            select(`SELECT m.month,
                    (SELECT COUNT(*) FROM work_requests wr WHERE wr.is_deleted = 0 AND DATE_FORMAT(wr.created_at, '%Y-%m') = m.month${wrScope}) AS requests,
                    (SELECT COUNT(*) FROM tasks t WHERE t.is_deleted = 0 AND DATE_FORMAT(t.created_at, '%Y-%m') = m.month${taskScope}) AS tasks_created,
                    (SELECT COUNT(*) FROM tasks t WHERE t.is_deleted = 0 AND t.status = 'completed' AND DATE_FORMAT(t.end_date, '%Y-%m') = m.month${taskScope}) AS tasks_completed,
                    (SELECT COUNT(*) FROM issue_assignments ia WHERE ia.is_deleted = 0 AND DATE_FORMAT(ia.created_at, '%Y-%m') = m.month${issueScope}) AS changes
                FROM (
                    SELECT DATE_FORMAT(DATE_SUB(${to ? ':to' : 'CURDATE()'}, INTERVAL n MONTH), '%Y-%m') AS month
                    FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
                          UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11) months
                ) m ORDER BY m.month`),
            select(`SELECT COALESCE(rt.request_type, 'Unassigned') AS name, COUNT(*) AS requests,
                    SUM(CASE WHEN wr.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN wr.status IN ('accepted', 'assigned', 'in_progress') THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN wr.status = 'pending' THEN 1 ELSE 0 END) AS pending
                FROM work_requests wr LEFT JOIN request_type rt ON rt.id = wr.request_type_id
                WHERE wr.is_deleted = 0${range('wr.created_at')}${wrScope}
                GROUP BY name ORDER BY requests DESC LIMIT 12`),
            select(`SELECT COALESCE(tt.task_type, 'Unassigned') AS name, COUNT(*) AS tasks,
                    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
                FROM tasks t LEFT JOIN task_type tt ON tt.id = t.task_type_id
                WHERE t.is_deleted = 0${range('t.created_at')}${taskScope}
                GROUP BY name ORDER BY tasks DESC LIMIT 10`),
            select(`SELECT u.name, jr.role_title AS role,
                    SUM(CASE WHEN ${openTask} THEN 1 ELSE 0 END) AS open_tasks,
                    SUM(CASE WHEN ${openTask} AND DATE(t.deadline) < CURDATE() THEN 1 ELSE 0 END) AS overdue,
                    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
                FROM task_assignments ta
                JOIN tasks t ON t.id = ta.task_id AND t.is_deleted = 0
                JOIN users u ON u.id = ta.user_id
                LEFT JOIN job_role jr ON jr.id = u.job_role_id
                WHERE 1 = 1${range('t.created_at')}${people ? ' AND ta.user_id IN (:scopePeople)' : ''}
                GROUP BY u.id, u.name, jr.role_title
                ORDER BY open_tasks DESC, completed DESC LIMIT 10`),
            select(`SELECT u.name,
                    (SELECT GROUP_CONCAT(d.title ORDER BY d.title SEPARATOR ', ') FROM user_divisions ud JOIN division d ON d.id = ud.division_id WHERE ud.user_id = u.id) AS division,
                    COUNT(*) AS requests,
                    SUM(CASE WHEN wr.status = 'completed' THEN 1 ELSE 0 END) AS completed
                FROM work_requests wr JOIN users u ON u.id = wr.user_id
                WHERE wr.is_deleted = 0${range('wr.created_at')}${wrScope}
                GROUP BY u.id, u.name ORDER BY requests DESC LIMIT 10`),
            // Everyone in a team / division / person scope is listed (inactive users too, flagged
            // `active: false`); the unscoped admin view lists only people with any activity.
            // One row per person: what they raised, managed and were assigned (each item by its own
            // created_at). DISTINCT on the assignment tables so a duplicate row never double counts.
            select(`SELECT u.id, u.name, jr.role_title AS role, u.job_role_id, u.account_status,
                    (SELECT GROUP_CONCAT(d.title ORDER BY d.title SEPARATOR ', ') FROM user_divisions ud JOIN division d ON d.id = ud.division_id WHERE ud.user_id = u.id) AS divisions,
                    COALESCE(p.projects, 0) AS projects, COALESCE(rq.requested, 0) AS requested, COALESCE(mg.managed, 0) AS managed,
                    COALESCE(tk.tasks, 0) AS tasks, COALESCE(tk.completed, 0) AS tasks_completed, COALESCE(tk.open_tasks, 0) AS open_tasks,
                    COALESCE(tk.overdue, 0) AS overdue, COALESCE(tk.work_pages, 0) AS work_pages,
                    COALESCE(ch.changes, 0) AS changes, COALESCE(ch.completed, 0) AS changes_completed, COALESCE(ch.open_changes, 0) AS open_changes,
                    COALESCE(ch.change_pages, 0) AS change_pages
                FROM users u
                LEFT JOIN job_role jr ON jr.id = u.job_role_id
                LEFT JOIN (
                    SELECT x.user_id, COUNT(DISTINCT x.wr_id) AS projects FROM (
                        SELECT wr.user_id, wr.id AS wr_id FROM work_requests wr WHERE wr.is_deleted = 0${range('wr.created_at')}
                        UNION SELECT wrm.manager_id, wr.id FROM work_request_managers wrm
                            JOIN work_requests wr ON wr.id = wrm.work_request_id AND wr.is_deleted = 0 WHERE 1 = 1${range('wr.created_at')}
                        UNION SELECT ta.user_id, wr.id FROM task_assignments ta
                            JOIN tasks t ON t.id = ta.task_id AND t.is_deleted = 0
                            JOIN work_requests wr ON wr.id = t.work_request_id AND wr.is_deleted = 0 WHERE 1 = 1${range('wr.created_at')}
                        UNION SELECT iua.user_id, wr.id FROM issue_user_assignments iua
                            JOIN issue_assignments ia ON ia.id = iua.issue_assignment_id AND ia.is_deleted = 0
                            JOIN tasks t ON t.id = ia.task_id
                            JOIN work_requests wr ON wr.id = t.work_request_id AND wr.is_deleted = 0 WHERE 1 = 1${range('wr.created_at')}
                    ) x GROUP BY x.user_id
                ) p ON p.user_id = u.id
                LEFT JOIN (
                    SELECT wr.user_id, COUNT(*) AS requested FROM work_requests wr WHERE wr.is_deleted = 0${range('wr.created_at')} GROUP BY wr.user_id
                ) rq ON rq.user_id = u.id
                LEFT JOIN (
                    SELECT wrm.manager_id AS user_id, COUNT(DISTINCT wr.id) AS managed FROM work_request_managers wrm
                    JOIN work_requests wr ON wr.id = wrm.work_request_id AND wr.is_deleted = 0 WHERE 1 = 1${range('wr.created_at')} GROUP BY wrm.manager_id
                ) mg ON mg.user_id = u.id
                LEFT JOIN (
                    SELECT ta.user_id, COUNT(*) AS tasks,
                        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                        SUM(CASE WHEN ${openTask} THEN 1 ELSE 0 END) AS open_tasks,
                        SUM(CASE WHEN ${openTask} AND DATE(t.deadline) < CURDATE() THEN 1 ELSE 0 END) AS overdue,
                        SUM(COALESCE(t.task_count, 0)) AS work_pages
                    FROM (SELECT DISTINCT task_id, user_id FROM task_assignments) ta
                    JOIN tasks t ON t.id = ta.task_id AND t.is_deleted = 0
                    WHERE 1 = 1${range('t.created_at')} GROUP BY ta.user_id
                ) tk ON tk.user_id = u.id
                LEFT JOIN (
                    SELECT iua.user_id, COUNT(*) AS changes,
                        SUM(CASE WHEN ia.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                        SUM(CASE WHEN ${openIssue} THEN 1 ELSE 0 END) AS open_changes,
                        SUM(COALESCE(ia.task_count, 0)) AS change_pages
                    FROM (SELECT DISTINCT issue_assignment_id, user_id FROM issue_user_assignments) iua
                    JOIN issue_assignments ia ON ia.id = iua.issue_assignment_id AND ia.is_deleted = 0
                    WHERE 1 = 1${range('ia.created_at')} GROUP BY iua.user_id
                ) ch ON ch.user_id = u.id
                WHERE u.name IS NOT NULL AND ${people ? 'u.id IN (:scopePeople)' : '1 = 1'}
                  ${people ? '' : 'AND COALESCE(p.projects, 0) + COALESCE(tk.tasks, 0) + COALESCE(ch.changes, 0) > 0'}
                ORDER BY projects DESC, tasks DESC, u.name`)
        ]);

        const num = value => Number(value || 0);
        const round1 = value => value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;
        const fb = feedbackRow[0] || {};
        res.json({
            success: true,
            data: {
                range: { from, to },
                scope: {
                    mode: scope.isAdmin ? 'all' : 'team',
                    me: scope.me,
                    division_id: scope.divisionId,
                    user_id: scope.userId,
                    divisions: scope.divisions.map(d => ({ id: d.id, title: d.title })),
                    people: scope.roster.map(u => ({ id: u.id, name: u.name, role: u.role, job_role_id: u.job_role_id, active: u.account_status === 'active', division_ids: u.division_ids }))
                },
                work_requests: { total: num(wrRow[0].total), status_counts: statusCountsFrom(wrRow[0], WORK_REQUEST_STATUSES) },
                tasks: {
                    total: num(taskRow[0].total),
                    status_counts: statusCountsFrom(taskRow[0], TASK_STATUSES),
                    overdue: num(taskRow[0].overdue),
                    due_7_days: num(taskRow[0].due_7_days),
                    final_approved: num(taskRow[0].final_approved),
                    work_pages: num(taskRow[0].work_pages),
                    completed_work_pages: num(taskRow[0].completed_work_pages)
                },
                changes: {
                    total: num(issueRow[0].total),
                    status_counts: statusCountsFrom(issueRow[0], ISSUE_STATUSES),
                    tasks_with_changes: num(issueRow[0].tasks_with_changes),
                    change_pages: num(issueRow[0].change_pages),
                    completed_change_pages: num(issueRow[0].completed_change_pages)
                },
                clients: { total: num(clientRow[0].clients), verticals: num(clientRow[0].verticals) },
                feedback: {
                    total: num(fb.total),
                    functionality: round1(fb.functionality),
                    timeliness: round1(fb.timeliness),
                    communication: round1(fb.communication),
                    nps: num(fb.scored) ? Math.round((num(fb.promoters) - num(fb.detractors)) / num(fb.scored) * 100) : null
                },
                monthly: monthly.map(row => ({ month: row.month, requests: num(row.requests), tasks_created: num(row.tasks_created), tasks_completed: num(row.tasks_completed), changes: num(row.changes) })),
                by_vertical: byVertical.map(row => ({ name: row.name, requests: num(row.requests), completed: num(row.completed), active: num(row.active), pending: num(row.pending) })),
                by_task_type: byTaskType.map(row => ({ name: row.name, tasks: num(row.tasks), completed: num(row.completed) })),
                workload: workload.map(row => ({ name: row.name, role: row.role, open_tasks: num(row.open_tasks), overdue: num(row.overdue), completed: num(row.completed) })),
                top_clients: topClients.map(row => ({ name: row.name, division: row.division, requests: num(row.requests), completed: num(row.completed) })),
                people: peopleRows.map(row => ({
                    id: row.id, name: row.name, role: row.role, job_role_id: row.job_role_id, active: row.account_status === 'active', divisions: row.divisions,
                    projects: num(row.projects), requested: num(row.requested), managed: num(row.managed),
                    tasks: num(row.tasks), tasks_completed: num(row.tasks_completed), open_tasks: num(row.open_tasks), overdue: num(row.overdue), work_pages: num(row.work_pages),
                    changes: num(row.changes), changes_completed: num(row.changes_completed), open_changes: num(row.open_changes), change_pages: num(row.change_pages)
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching overview data:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const sseProgress = (req, res) => {
    const jobId = req.params.jobId;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no'
    });
    sseClients[jobId] = { res };
    req.on('close', () => {
        if (sseClients[jobId] && sseClients[jobId].res === res) {
            delete sseClients[jobId];
        }
    });
};

module.exports = {
    getAllFeedback,
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
    getAllLeaves,
    getLeaveById,
    createLeave,
    updateLeave,
    deleteLeave,
    getLeaveKpis,
    getLeaveUsers,
    getUserDivision,
    uploadLeaves,
    exportLeavesCsv,
    exportLeavesExcel,
    getEditData,
    getRequestTypes,
    getProjectTypesByProject,
    getCreativeManagerByProject,
    updateProject,
    updateClient,
    updateTask,
    updateIssue,
    getMasterCardData,
    uploadMasterCard,
    updateMasterCard,
    deleteMasterCard,
    updateMasterCardField,
    getFinancialYears,
    getFilterOptions,
    getOverviewData,
    sseProgress
};
