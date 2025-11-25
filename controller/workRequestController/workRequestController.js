const CrudService = require('../../services/crudService');
const { WorkRequests, WorkMedium, User, WorkRequestDocuments } = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const path = require('path');

const workRequestService = new CrudService(WorkRequests);

// Create work request
const createWorkRequest = async (req, res) => {
    try {
        const { project_name, brand, work_medium_id, project_details, priority = 'medium', remarks, isdraft = 'false' } = req.body;
        const user_id = req.user.id; // From JWT middleware

        // Validate required fields
        if (!project_name || !work_medium_id) {
            return res.status(400).json({
                success: false,
                error: 'Project name and work medium ID are required'
            });
        }

        // Get work medium to find division
        const workMedium = await WorkMedium.findByPk(work_medium_id, {
            include: [{ model: require('../../models').Division, as: 'Division' }]
        });
        if (!workMedium) {
            return res.status(400).json({
                success: false,
                error: 'Invalid work medium ID'
            });
        }

        // Find manager in the same division with Creative Manager role
        const userDivision = await require('../../models').UserDivisions.findOne({
            where: { division_id: workMedium.division_id },
            include: [{
                model: require('../../models').User,
                where: { job_role_id: 2, account_status: 'active' },
                include: [
                    { model: require('../../models').Department, as: 'Department' },
                    { model: require('../../models').Division, as: 'Divisions' },
                    { model: require('../../models').JobRole, as: 'JobRole' },
                    { model: require('../../models').Location, as: 'Location' }
                ]
            }]
        });
        const manager = userDivision ? userDivision.User : null;

        if (!manager) {
            return res.status(400).json({
                success: false,
                error: 'No manager found for this work medium'
            });
        }

        // Create work request
        const workRequestData = {
            user_id,
            project_name,
            brand,
            work_medium_id,
            project_details,
            priority,
            status: isdraft === 'true' ? 'draft' : 'pending',
            requested_manager_id: manager.id,
            requested_at: new Date(),
            remarks
        };

        const result = await workRequestService.create(workRequestData);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create work request'
            });
        }

        // Handle file uploads
        const workRequestId = result.data.id;
        const documents = [];

        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];
            for (const file of files) {
                // Generate unique filename
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = file.name.replace(/[^a-zA-Z0-9.]/g, '_') + '-' + uniqueSuffix + path.extname(file.name);
                const filepath = path.join(req.uploadPath, filename);

                // Move file to upload path
                await file.mv(filepath);

                const documentData = {
                    work_request_id: workRequestId,
                    document_name: file.name,
                    document_path: `/work-requests/uploads/${req.projectName}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    uploaded_at: new Date()
                };

                const docResult = await WorkRequestDocuments.create(documentData);
                documents.push(docResult);
            }
        }

        // Send notification emails
        const user = await User.findByPk(user_id, {
            attributes: { exclude: ['password', 'created_at', 'updated_at'] },
            include: [
                { model: require('../../models').Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                { model: require('../../models').Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] } },
                { model: require('../../models').JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at'] } },
                { model: require('../../models').Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } },
                { model: require('../../models').Designation, as: 'Designation', attributes: { exclude: ['created_at', 'updated_at'] } }
            ]
        });
        if (isdraft === 'false' && user && manager) {
            // Email to user
            // Email to user
            const userEmailHtml = renderTemplate('workRequestUserConfirmation', {
                manager_name: manager.name,
                manager_email: manager.email,
                manager_department: manager.Department?.department_name || 'N/A',
                manager_division: manager.Divisions && manager.Divisions.length > 0 ? manager.Divisions[0].title : 'N/A',
                manager_job_role: manager.JobRole?.role_title || 'N/A',
                manager_location: manager.Location?.location_name || 'N/A',
                project_name: result.data.project_name,
                brand: result.data.brand || 'Not specified',
                work_medium_type: workMedium.type,
                work_medium_category: workMedium.category,
                priority: result.data.priority,
                division_name: workMedium.Division.title,
                request_id: result.data.id,
                request_date: new Date(result.data.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                project_details: result.data.project_details || 'No detailed description provided.',
                priority_capitalized: result.data.priority.charAt(0).toUpperCase() + result.data.priority.slice(1),
                frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000'
            });
            await sendMail({
                to: user.email,
                subject: 'Work Request Submitted Successfully',
                html: userEmailHtml
            });

            // Email to manager
            const managerEmailHtml = renderTemplate('workRequestManagerNotification', {
                project_name: result.data.project_name,
                brand: result.data.brand || 'Not specified',
                work_medium_type: workMedium.type,
                work_medium_category: workMedium.category,
                priority: result.data.priority,
                division_name: workMedium.Division.title,
                request_id: result.data.id,
                request_date: new Date(result.data.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                user_name: user.name,
                user_email: user.email,
                user_department: user.Department?.department_name || 'Not specified',
                user_division: user.Divisions && user.Divisions.length > 0 ? user.Divisions[0].title : 'Not specified',
                user_job_role: user.JobRole?.role_title || 'Not specified',
                user_location: user.Location?.location_name || 'Not specified',
                user_designation: user.Designation?.designation_name || 'Not specified',
                project_details: result.data.project_details || 'No detailed description provided.',
                priority_capitalized: result.data.priority.charAt(0).toUpperCase() + result.data.priority.slice(1),
                frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000'
            });
            await sendMail({
                to: manager.email,
                subject: 'New Work Request Submitted',
                html: managerEmailHtml
            });
        }

        res.status(201).json({
            success: true,
            data: {
                workRequest: result.data,
                documents: documents
            },
            message: 'Work request created successfully'
        });
    } catch (error) {
        console.error('Error creating work request:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to create work request'
        });
    }
};

const getMyWorkRequests = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { Op } = require('sequelize');

        let where = { user_id };

        // Apply filters
        if (req.filters) {
            where = { ...where, ...req.filters };
        }

        // Apply search
        if (req.search.term && req.search.fields.length > 0) {
            where[Op.or] = req.search.fields.map(field => ({
                [field]: { [Op.like]: `%${req.search.term}%` }
            }));
        }

        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: User, as: 'requestedManager', foreignKey: 'requested_manager_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                    { model: require('../../models').Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                    { model: require('../../models').Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                    { model: require('../../models').JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                    { model: require('../../models').Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                ] }
            ],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });

        if (result.success) {
            res.json({ success: true, data: result.data, pagination: req.pagination });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error fetching work requests:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getWorkRequestById = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const result = await workRequestService.getAll({
            where: { id, user_id },
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'created_at', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: User, as: 'requestedManager', foreignKey: 'requested_manager_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                    { model: require('../../models').Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                    { model: require('../../models').Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                    { model: require('../../models').JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                    { model: require('../../models').Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                ] },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } }
            ],
            limit: 1
        });

        if (result.success && result.data.length > 0) {
            res.json({ success: true, data: result.data[0] });
        } else {
            res.status(404).json({ success: false, error: 'Work request not found' });
        }
    } catch (error) {
        console.error('Error fetching work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { createWorkRequest, getMyWorkRequests, getWorkRequestById };