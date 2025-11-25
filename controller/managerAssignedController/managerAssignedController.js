const CrudService = require('../../services/crudService');
const { WorkRequests, WorkMedium, User, WorkRequestDocuments } = require('../../models');

const workRequestService = new CrudService(WorkRequests);
const userService = new CrudService(User);
const workMediumService = new CrudService(WorkMedium);

const getAssignedWorkRequests = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { Op } = require('sequelize');

        let where = { requested_manager_id: manager_id, status: { [Op.ne]: 'draft' } };

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
        console.error('Error fetching assigned work requests:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAssignedWorkRequestById = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const manager_id = req.user.id;

        const result = await workRequestService.getAll({
            where: { id, requested_manager_id: manager_id },
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } }
            ],
            limit: 1
        });

        if (result.success && result.data.length > 0) {
            res.json({ success: true, data: result.data[0] });
        } else {
            res.status(404).json({ success: false, error: 'Assigned work request not found' });
        }
    } catch (error) {
        console.error('Error fetching assigned work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const acceptWorkRequest = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const manager_id = req.user.id;

        // Check if work request exists and is assigned to this manager
        const existingResult = await workRequestService.getAll({
            where: { id, requested_manager_id: manager_id },
            limit: 1
        });

        if (!existingResult.success || existingResult.data.length === 0) {
            return res.status(404).json({ success: false, error: 'Work request not found or not assigned to you' });
        }

        const workRequest = existingResult.data[0];
        if (workRequest.status === 'accepted') {
            return res.status(400).json({ success: false, error: 'Work request is already accepted' });
        }

        const updateResult = await workRequestService.updateById(id, { status: 'accepted' });

        if (updateResult.success) {
            // Send email to user
            const workRequestResult = await workRequestService.getById(id);
            if (workRequestResult.success) {
                const workRequest = workRequestResult.data;
                // Get user
                const userResult = await userService.getById(workRequest.user_id);
                if (userResult.success) {
                    const user = userResult.data;
                    // Get work medium
                    const workMediumResult = await workMediumService.getById(workRequest.work_medium_id);
                    const workMedium = workMediumResult.success ? workMediumResult.data : {};

                    // Send email
                    const { sendMail } = require('../../services/mailService');
                    const { renderTemplate } = require('../../services/templateService');

                    const html = renderTemplate('workRequestAcceptanceNotification', {
                        project_name: workRequest.project_name,
                        brand: workRequest.brand,
                        work_medium_type: workMedium.type,
                        work_medium_category: workMedium.category,
                        priority: workRequest.priority,
                        request_id: workRequest.id,
                        accepted_at: new Date().toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        }),
                        project_details: workRequest.project_details || 'No detailed description provided.',
                        frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000'
                    });

                    const mailOptions = {
                        to: user.email,
                        subject: 'Work Request Accepted',
                        html
                    };

                    // CC manager if different from user
                    if (req.user.id !== workRequest.user_id) {
                        mailOptions.cc = req.user.email;
                    }

                    await sendMail(mailOptions);
                }
            }

            res.json({ success: true, message: 'Work request accepted successfully' });
        } else {
            res.status(404).json({ success: false, error: 'Work request not found or update failed' });
        }
    } catch (error) {
        console.error('Error accepting work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const deferWorkRequest = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const manager_id = req.user.id;
        const { reason, message } = req.body; // reason: 'insufficient_details' or 'incorrect_work_medium', message for insufficient_details

        if (!reason || !['insufficient_details', 'incorrect_work_medium'].includes(reason)) {
            return res.status(400).json({ success: false, error: 'Invalid reason' });
        }

        // Check if work request exists and is assigned to this manager
        const existingResult = await workRequestService.getAll({
            where: { id, requested_manager_id: manager_id },
            limit: 1
        });

        if (!existingResult.success || existingResult.data.length === 0) {
            return res.status(404).json({ success: false, error: 'Work request not found or not assigned to you' });
        }

        const workRequest = existingResult.data[0];

        // If insufficient_details, send email
        if (reason === 'insufficient_details' && message) {
            // Get user
            const userResult = await userService.getById(workRequest.user_id);
            if (userResult.success) {
                const user = userResult.data;
                // Get manager
                const manager = req.user; // Assuming req.user has details

                // Send email
                const { sendMail } = require('../../services/mailService');
                const { renderTemplate } = require('../../services/templateService');

                const html = renderTemplate('workRequestDeferNotification', {
                    user_name: user.name,
                    user_email: user.email,
                    manager_name: manager.name,
                    manager_email: manager.email,
                    project_name: workRequest.project_name,
                    brand: workRequest.brand,
                    message: message,
                    request_date: new Date(workRequest.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                });

                const mailOptions = {
                    to: user.email,
                    subject: 'Work Request Deferred - Insufficient Details',
                    html
                };

                // CC manager if different from user
                if (req.user.id !== workRequest.user_id) {
                    mailOptions.cc = req.user.email;
                }

                await sendMail(mailOptions);
            }
        }

        res.json({ success: true, message: 'Work request deferred successfully' });
    } catch (error) {
        console.error('Error deferring work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getAssignedWorkRequests, getAssignedWorkRequestById, acceptWorkRequest, deferWorkRequest };