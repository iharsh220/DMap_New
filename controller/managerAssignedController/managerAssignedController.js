const { Op } = require('sequelize');

const CrudService = require('../../services/crudService');
const {
    WorkRequests,
    RequestType,
    User,
    WorkRequestDocuments,
    WorkRequestManagers,
    UserDivisions,
    Department,
    Division,
    JobRole,
    Location,
    Designation
} = require('../../models');

const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');

const workRequestService = new CrudService(WorkRequests);
const userService = new CrudService(User);
const requestTypeService = new CrudService(RequestType);
const userDivisionsService = new CrudService(UserDivisions);

const getAssignableUsers = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const manager_id = req.user.id;

        // Get work request with request type to find the division
        const workRequestResult = await workRequestService.getAll({
            where: { id: workRequestId },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                },
                {
                    model: RequestType,
                    include: [{ model: Division, as: 'Division' }]
                }
            ],
            limit: 1
        });

        if (!workRequestResult.success || workRequestResult.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found or not assigned to you'
            });
        }

        const workRequest = workRequestResult.data[0];
        const divisionId = workRequest.RequestType?.Division?.id;

        if (!divisionId) {
            return res.status(404).json({
                success: false,
                error: 'Division not found for this work request'
            });
        }

        // Find all active users in this division
        const assignableUsersResult = await userService.getAll({
            where: {
                [Op.and]: [
                    { account_status: 'active' }
                ]
            },
            include: [
                {
                    model: Division,
                    as: 'Divisions',
                    where: { id: divisionId },
                    attributes: ['id', 'title'],
                    through: { attributes: [] },
                    required: true
                }
            ],
            attributes: ['id', 'name']
        });

        if (!assignableUsersResult.success) {
            return res.status(500).json({
                success: false,
                error: assignableUsersResult.error,
                message: 'Failed to fetch assignable users'
            });
        }

        // Get manager details
        const managerDetails = await userService.getById(manager_id);
        const manager = managerDetails.success ? managerDetails.data : { id: manager_id, name: 'Unknown' };

        // Format the response
        const formattedData = assignableUsersResult.data.map(user => ({
            id: user.id,
            name: user.id === manager_id ? 'Self' : user.name,
            manager: {
                id: manager.id,
                name: manager.name
            },
            division: {
                id: user.Divisions[0].id,
                name: user.Divisions[0].title
            }
        }));

        res.json({
            success: true,
            data: formattedData,
            message: 'Assignable users retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching assignable users:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch assignable users'
        });
    }
};

const getAssignedWorkRequests = async (req, res) => {
    try {
        const manager_id = req.user.id;

        let where = { status: { [Op.ne]: 'draft' } };

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
            attributes: { exclude: ['request_type_id', 'requested_manager_link_id', 'updated_at'] },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                },
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
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
            where: { id },
            attributes: { exclude: ['request_type_id', 'requested_manager_link_id', 'updated_at'] },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                },
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
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
            where: { id },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                }
            ],
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
                    // Get request type
                    const requestTypeResult = await requestTypeService.getById(workRequest.request_type_id);
                    const requestType = requestTypeResult.success ? requestTypeResult.data : {};

                    const html = renderTemplate('workRequestAcceptanceNotification', {
                        project_name: workRequest.project_name,
                        brand: workRequest.brand,
                        request_type_type: requestType.type,
                        request_type_category: requestType.category,
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
                        frontend_url: process.env.FRONTEND_URL
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
        const { reason, message } = req.body; // reason: 'insufficient_details' or 'incorrect_request_type', message for insufficient_details
        
        if (!reason || !['insufficient_details', 'incorrect_request_type'].includes(reason)) {
            return res.status(400).json({ success: false, error: 'Invalid reason' });
        }

        if (reason === 'incorrect_request_type' && !req.body.new_request_type_id) {
            return res.status(400).json({ success: false, error: 'new_request_type_id is required for incorrect_request_type reason' });
        }

        // Check if work request exists and is assigned to this manager
        const existingResult = await workRequestService.getAll({
            where: { id },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                }
            ],
            limit: 1
        });

        if (!existingResult.success || existingResult.data.length === 0) {
            return res.status(404).json({ success: false, error: 'Work request not found or not assigned to you' });
        }

        const workRequest = existingResult.data[0];

        if (reason === 'insufficient_details' && message) {
            // Send email to user
            const userResult = await userService.getById(workRequest.user_id);
            if (userResult.success) {
                const user = userResult.data;
                const manager = req.user;

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

                if (req.user.id !== workRequest.user_id) {
                    mailOptions.cc = req.user.email;
                }

                await sendMail(mailOptions);
            }
        } else if (reason === 'incorrect_request_type') {
            // Reassign to new request type manager
            const newRequestTypeId = parseInt(req.body.new_request_type_id);
            if (isNaN(newRequestTypeId)) {
                return res.status(400).json({ success: false, error: 'Invalid new_request_type_id' });
            }

            // Get new request type
            const newRequestType = await RequestType.findByPk(newRequestTypeId, {
                include: [{ model: Division, as: 'Division' }]
            });
            if (!newRequestType) {
                return res.status(400).json({ success: false, error: 'Invalid request type ID' });
            }

            // Find new manager
            const managerDivision = await UserDivisions.findOne({
                where: { division_id: newRequestType.division_id },
                include: [{
                    model: User,
                    where: { job_role_id: 2, account_status: 'active' },
                    include: [
                        { model: Department, as: 'Department' },
                        { model: Division, as: 'Divisions' },
                        { model: JobRole, as: 'JobRole' },
                        { model: Location, as: 'Location' }
                    ]
                }]
            });
            const newManager = managerDivision ? managerDivision.User : null;

            if (!newManager) {
                return res.status(400).json({ success: false, error: 'No manager found for the new request type' });
            }

            // Update work request
            const updateResult = await workRequestService.updateById(id, {
                request_type_id: newRequestTypeId
            });

            if (!updateResult.success) {
                return res.status(500).json({ success: false, error: 'Failed to reassign work request' });
            }

            // Update the manager in WorkRequestManagers
            await WorkRequestManagers.update(
                { manager_id: newManager.id },
                { where: { work_request_id: id } }
            );

            // Send transfer email to new manager
            const user = await User.findByPk(workRequest.user_id, {
                include: [
                    { model: Department, as: 'Department' },
                    { model: Division, as: 'Divisions' },
                    { model: JobRole, as: 'JobRole' },
                    { model: Location, as: 'Location' },
                    { model: Designation, as: 'Designation' }
                ]
            });
            if (user) {
                const transferManager = req.user;

                const html = renderTemplate('workRequestTransferNotification', {
                    transfer_manager_name: transferManager.name,
                    transfer_manager_email: transferManager.email,
                    project_name: workRequest.project_name,
                    brand: workRequest.brand,
                    request_type_type: newRequestType.type,
                    request_type_category: newRequestType.category,
                    priority: workRequest.priority,
                    division_name: newRequestType.Division.title,
                    request_id: workRequest.id,
                    request_date: new Date(workRequest.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    user_name: user.name,
                    user_email: user.email,
                    user_department: user.Department?.department_name || 'Not specified',
                    user_division: user.Division?.title || 'Not specified',
                    user_job_role: user.JobRole?.role_title || 'Not specified',
                    user_location: user.Location?.location_name || 'Not specified',
                    user_designation: user.Designation?.designation_name || 'Not specified',
                    project_details: workRequest.project_details || 'No detailed description provided.',
                    priority_capitalized: workRequest.priority.charAt(0).toUpperCase() + workRequest.priority.slice(1),
                    frontend_url: process.env.FRONTEND_URL
                });

                const ccEmails = [user.email];
                if (transferManager.id !== user.id) {
                    ccEmails.push(transferManager.email);
                }

                await sendMail({
                    to: newManager.email,
                    cc: ccEmails.join(','),
                    subject: 'Work Request Transferred to You',
                    html
                });
            }
        }

        res.json({ success: true, message: 'Work request deferred successfully' });
    } catch (error) {
        console.error('Error deferring work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getAssignedWorkRequests,
    getAssignedWorkRequestById,
    acceptWorkRequest,
    deferWorkRequest,
    getAssignableUsers
};