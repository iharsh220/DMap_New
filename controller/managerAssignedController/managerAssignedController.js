const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

const CrudService = require('../../services/crudService');
const {
    WorkRequests,
    RequestType,
    ProjectType,
    TaskType,
    User,
    WorkRequestDocuments,
    WorkRequestManagers,
    UserDivisions,
    Department,
    Division,
    JobRole,
    Location,
    Designation,
    Tasks,
    TaskDependencies,
    TaskAssignments,
    TaskDocuments
} = require('../../models');

const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const workRequestService = new CrudService(WorkRequests);
const userService = new CrudService(User);

const getAssignableUsers = async (req, res) => {
    try {
        const manager_id = req.user.id;
        let divisionIds = [];

        // Check if task_id is provided in query params
        if (req.query.task_id) {
            const taskId = parseInt(req.query.task_id, 10);
            if (isNaN(taskId)) {
                return res.status(400).json({ success: false, error: 'Invalid task ID' });
            }

            // Find the task and get its request_type_id
            const task = await Tasks.findByPk(taskId, {
                attributes: ['id', 'request_type_id'],
                include: [
                    {
                        model: RequestType,
                        include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
                    }
                ]
            });

            if (!task) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }

            // Get division IDs from the task's request type
            const taskDivisionIds = task.RequestType?.Divisions?.map(d => d.id) || [];

            if (taskDivisionIds.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No divisions found for this task\'s request type'
                });
            }

            // Get divisions that the manager belongs to
            const managerDivisions = await UserDivisions.findAll({
                where: { user_id: manager_id },
                attributes: ['division_id']
            });

            const managerDivisionIds = managerDivisions.map(md => md.division_id);

            // Only use divisions that are both in the task's request type AND belong to the manager
            divisionIds = taskDivisionIds.filter(id => managerDivisionIds.includes(id));

            if (divisionIds.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No divisions found that both match the task and belong to you'
                });
            }
        } else {
            // Use work_request_id from params (original functionality)
            const workRequestId = parseInt(req.params.id, 10);
            if (isNaN(workRequestId)) {
                return res.status(400).json({ success: false, error: 'Invalid work request ID' });
            }

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
                        include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
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

            // Check if work request is accepted
            if (workRequest.status !== 'accepted') {
                return res.status(400).json({
                    success: false,
                    error: 'Work request must be accepted before assigning users'
                });
            }

            divisionIds = workRequest.RequestType?.Divisions?.map(d => d.id) || [];

            if (divisionIds.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Division not found for this work request'
                });
            }
        }

        // Find all active users in these divisions
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
                    where: { id: { [Op.in]: divisionIds } },
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

        // Get ongoing task count for each user
        const userIds = assignableUsersResult.data.map(user => user.id);
        const ongoingTaskCounts = await TaskAssignments.findAll({
            where: {
                user_id: { [Op.in]: userIds }
            },
            include: [
                {
                    model: Tasks,
                    where: { status: 'in_progress' },
                    attributes: []
                }
            ],
            attributes: [
                'user_id',
                [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'ongoing_count']
            ],
            group: ['user_id'],
            raw: true
        });

        // Create a map of user_id to ongoing count
        const ongoingCountMap = new Map();
        ongoingTaskCounts.forEach(count => {
            ongoingCountMap.set(count.user_id, parseInt(count.ongoing_count));
        });

        // Format the response
        const formattedData = assignableUsersResult.data.map(user => ({
            id: user.id,
            name: user.id === manager_id ? 'Self' : user.name,
            ongoingTasks: ongoingCountMap.get(user.id) || 0,
            manager: {
                id: manager.id,
                name: manager.name
            },
            divisions: user.Divisions.map(div => ({
                id: div.id,
                name: div.title
            }))
        }));

        await logUserActivity({
            event: 'assignable_users_viewed',
            userId: req.user.id,
            workRequestId: req.query.task_id ? null : parseInt(req.params.id),
            taskId: req.query.task_id ? parseInt(req.query.task_id) : null,
            count: formattedData.length,
            ...extractRequestDetails(req)
        });

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
        // Define associations for TaskAssignments
        Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });

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
                { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                {
                    model: Tasks,
                    attributes: ['id', 'task_name', 'description', 'deadline', 'status'],
                    include: [
                        {
                            model: User,
                            as: 'assignedUsers',
                            attributes: ['id', 'name', 'email'],
                            through: { attributes: [] }
                        },
                        {
                            model: TaskAssignments,
                            include: [
                                {
                                    model: TaskDocuments,
                                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status']
                                }
                            ]
                        }
                    ],
                    required: false
                }
            ],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });

        if (result.success) {
            // Add deadline field as the latest task deadline for each work request
            for (const workRequest of result.data) {
                if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                    const latestDeadline = workRequest.Tasks.reduce((latest, task) => {
                        return task.deadline && (!latest || task.deadline > latest) ? task.deadline : latest;
                    }, null);
                    workRequest.dataValues.deadline = latestDeadline;
                } else {
                    workRequest.dataValues.deadline = null;
                }
            }

            await logUserActivity({
                event: 'assigned_work_requests_viewed',
                userId: req.user.id,
                count: result.data.length,
                ...extractRequestDetails(req)
            });
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
        // Define associations for TaskAssignments
        Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });

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
                { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: Tasks,
                    attributes: ['id', 'task_name', 'description', 'task_type_id', 'work_request_id', 'deadline', 'status', 'intimate_team', 'request_type_id'],
                    include: [
                        {
                            model: TaskAssignments,
                            include: [
                                {
                                    model: User,
                                    attributes: ['id', 'name', 'email']
                                },
                                {
                                    model: TaskDocuments,
                                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status']
                                }
                            ]
                        },
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
                        {
                            model: RequestType,
                            attributes: ['id', 'request_type', 'description']
                        },
                        {
                            model: TaskDependencies,
                            as: 'dependencies',
                            include: [
                                {
                                    model: Tasks,
                                    as: 'dependencyTask',
                                    attributes: ['id', 'task_name', 'deadline', 'status']
                                }
                            ]
                        }
                    ]
                }
            ],
            limit: 1
        });

        if (result.success && result.data.length > 0) {
            await logUserActivity({
                event: 'assigned_work_request_viewed',
                userId: req.user.id,
                workRequestId: id,
                ...extractRequestDetails(req)
            });
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

        // Check if work request exists and is assigned to this manager, get all needed data in one query
        const existingResult = await workRequestService.getAll({
            where: { id },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                },
                {
                    model: User,
                    as: 'users',
                    attributes: ['id', 'name', 'email']
                },
                {
                    model: RequestType,
                    include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
                }
            ],
            limit: 1
        });

        if (!existingResult.success || existingResult.data.length === 0) {
            return res.status(404).json({ success: false, error: 'Work request not found or not assigned to you' });
        }

        const workRequest = existingResult.data[0];
        if (workRequest.status === 'accepted') {
            await logUserActivity({
                event: 'work_request_action_failed',
                reason: 'already_accepted',
                userId: req.user.id,
                workRequestId: id,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Work request is already accepted' });
        }

        const updateResult = await workRequestService.updateById(id, { status: 'accepted' });

        if (updateResult.success) {
            const user = workRequest.users;
            const requestType = workRequest.RequestType || {};
            const divisionId = requestType.Divisions?.[0]?.id;

            if (user && divisionId) {
                // Find all Creative Managers and Creative Leads in the division
                const assigneeUserDivisions = await UserDivisions.findAll({
                    where: { division_id: divisionId },
                    include: [{
                        model: User,
                        where: {
                            job_role_id: { [Op.in]: [2, 3] }, // 2: Creative Manager, 3: Creative Lead
                            account_status: 'active'
                        },
                        attributes: ['email']
                    }],
                    attributes: []
                });

                const ccEmails = assigneeUserDivisions.map(ud => ud.User.email);

                const html = renderTemplate('workRequestAcceptanceNotification', {
                    project_name: workRequest.project_name,
                    brand: workRequest.brand,
                    request_type_type: requestType.request_type,
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

                // CC all managers and leads in the division
                if (ccEmails.length > 0) {
                    mailOptions.cc = ccEmails.join(',');
                }

                await sendMail(mailOptions);
            }

            await logUserActivity({
                event: 'work_request_accepted',
                userId: req.user.id,
                workRequestId: id,
                ...extractRequestDetails(req)
            });

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

        if (reason === 'incorrect_request_type' && (!req.body.new_request_type_id || !req.body.new_project_type_id)) {
            return res.status(400).json({ success: false, error: 'new_request_type_id and new_project_type_id are required for incorrect_request_type reason' });
        }

        // Check if work request exists and is assigned to this manager, get all needed data in one query
        const existingResult = await workRequestService.getAll({
            where: { id },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                },
                {
                    model: User,
                    as: 'users',
                    attributes: ['id', 'name', 'email']
                },
                {
                    model: RequestType,
                    include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
                }
            ],
            limit: 1
        });

        if (!existingResult.success || existingResult.data.length === 0) {
            return res.status(404).json({ success: false, error: 'Work request not found or not assigned to you' });
        }

        const workRequest = existingResult.data[0];

        if (workRequest.status === 'accepted') {
            await logUserActivity({
                event: 'work_request_action_failed',
                reason: 'already_accepted_cannot_defer',
                userId: req.user.id,
                workRequestId: id,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Work request is already accepted and cannot be deferred' });
        }

        if (reason === 'insufficient_details' && message) {
            // Send email to user
            const user = workRequest.users;
            const currentUser = req.user;
            const requestType = workRequest.RequestType || {};
            const divisionId = requestType.Divisions?.[0]?.id;

            // Find all Creative Managers and Creative Leads in the division
            let ccEmails = [];
            if (divisionId) {
                const assigneeUserDivisions = await UserDivisions.findAll({
                    where: { division_id: divisionId },
                    include: [{
                        model: User,
                        where: {
                            job_role_id: { [Op.in]: [2, 3] }, // 2: Creative Manager, 3: Creative Lead
                            account_status: 'active'
                        },
                        attributes: ['email']
                    }],
                    attributes: []
                });
                ccEmails = assigneeUserDivisions.map(ud => ud.User.email);
            }

            const html = renderTemplate('workRequestDeferNotification', {
                user_name: user.name,
                user_email: user.email,
                manager_name: currentUser.name,
                manager_email: currentUser.email,
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

            // CC all managers and leads in the division
            if (ccEmails.length > 0) {
                mailOptions.cc = ccEmails.join(',');
            }

            await sendMail(mailOptions);

            await logUserActivity({
                event: 'work_request_deferred',
                reason: 'insufficient_details',
                userId: req.user.id,
                workRequestId: id,
                deferReason: reason,
                message: message,
                ...extractRequestDetails(req)
            });
        } else if (reason === 'incorrect_request_type') {
            // Reassign to new request type and project type - assign all managers and leads
            const newRequestTypeId = parseInt(req.body.new_request_type_id);
            const newProjectTypeId = parseInt(req.body.new_project_type_id);
            if (isNaN(newRequestTypeId)) {
                return res.status(400).json({ success: false, error: 'Invalid new_request_type_id' });
            }
            if (isNaN(newProjectTypeId)) {
                return res.status(400).json({ success: false, error: 'Invalid new_project_type_id' });
            }

            // Get new request type
            const newRequestType = await RequestType.findByPk(newRequestTypeId, {
                include: [{ model: Division, through: { attributes: [] } }]
            });
            if (!newRequestType) {
                return res.status(400).json({ success: false, error: 'Invalid request type ID' });
            }

            // Find all Creative Managers and Creative Leads in the new division
            const newManagersAndLeads = await UserDivisions.findAll({
                where: { division_id: newRequestType.Divisions?.[0]?.id },
                include: [{
                    model: User,
                    where: {
                        job_role_id: { [Op.in]: [2, 3] }, // 2: Creative Manager, 3: Creative Lead
                        account_status: 'active'
                    },
                    attributes: ['id', 'name', 'email']
                }],
                attributes: []
            });

            if (!newManagersAndLeads || newManagersAndLeads.length === 0) {
                return res.status(400).json({ success: false, error: 'No managers or leads found for the new request type' });
            }

            // Update work request
            const updateResult = await workRequestService.updateById(id, {
                request_type_id: newRequestTypeId,
                project_id: newProjectTypeId
            });

            if (!updateResult.success) {
                return res.status(500).json({ success: false, error: 'Failed to reassign work request' });
            }

            // Delete existing WorkRequestManagers entries
            await WorkRequestManagers.destroy({
                where: { work_request_id: id }
            });

            // Create new WorkRequestManagers entries for all managers and leads
            const newAssignments = newManagersAndLeads.map(managerDivision => ({
                work_request_id: id,
                manager_id: managerDivision.User.id
            }));

            await WorkRequestManagers.bulkCreate(newAssignments);

            // Use the first manager (Creative Manager) for the transfer email
            const newManager = newManagersAndLeads.find(m => m.User.job_role_id === 2)?.User ||
                newManagersAndLeads[0].User;

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
                    request_type_type: newRequestType.request_type,
                    priority: workRequest.priority,
                    division_name: newRequestType.Divisions?.[0]?.title,
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

            await logUserActivity({
                event: 'work_request_deferred',
                reason: 'incorrect_request_type',
                userId: req.user.id,
                workRequestId: id,
                deferReason: reason,
                newRequestTypeId: req.body.new_request_type_id,
                newProjectTypeId: req.body.new_project_type_id,
                ...extractRequestDetails(req)
            });
        }

        res.json({ success: true, message: 'Work request deferred successfully' });
    } catch (error) {
        console.error('Error deferring work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getTaskTypesByWorkRequest = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const manager_id = req.user.id;

        // Get work request with project_id, ensuring it's assigned to this manager
        const workRequestResult = await workRequestService.getAll({
            where: { id: workRequestId },
            include: [
                {
                    model: WorkRequestManagers,
                    where: { manager_id: manager_id },
                    required: true,
                    attributes: []
                }
            ],
            attributes: ['id', 'project_id'],
            limit: 1,
            order: []
        });

        if (!workRequestResult.success || workRequestResult.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found or not assigned to you'
            });
        }

        const workRequest = workRequestResult.data[0];
        const projectId = workRequest.project_id;

        if (!projectId) {
            return res.json({
                success: true,
                data: [],
                message: 'No project type associated with this work request'
            });
        }

        // Get project type with associated task types
        const projectType = await ProjectType.findByPk(projectId, {
            include: [{
                model: TaskType,
                through: { attributes: [] },
                attributes: { exclude: ['created_at', 'updated_at'] }
            }],
            attributes: { exclude: ['created_at', 'updated_at'] }
        });

        if (!projectType) {
            return res.status(404).json({
                success: false,
                error: 'Project type not found'
            });
        }

        await logUserActivity({
            event: 'task_types_viewed',
            userId: req.user.id,
            workRequestId: workRequestId,
            projectId: projectId,
            taskTypeCount: projectType.TaskTypes.length,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: projectType.TaskTypes,
            message: 'Task types retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching task types:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch task types'
        });
    }
};

const createTask = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { work_request_id, task_name, description, assigned_to_ids, task_type_id, request_type_id, deadline, dependencies, project_type_id } = req.body;

        // Validate required fields
        if (!work_request_id || !task_name || !assigned_to_ids || !task_type_id || !request_type_id) {
            return res.status(400).json({
                success: false,
                error: 'work_request_id, task_name, assigned_to_ids, task_type_id, and request_type_id are required'
            });
        }

        // Validate assigned_to_ids is an array of integers
        if (!Array.isArray(assigned_to_ids) || assigned_to_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'assigned_to_ids must be a non-empty array of user IDs'
            });
        }

        for (const id of assigned_to_ids) {
            if (!Number.isInteger(id)) {
                return res.status(400).json({
                    success: false,
                    error: 'All assigned_to_ids must be integers'
                });
            }
        }

        // Check if work request exists and is assigned to this manager
        const workRequestResult = await workRequestService.getAll({
            where: { id: work_request_id },
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

        if (!workRequestResult.success || workRequestResult.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found or not assigned to you'
            });
        }

        const workRequest = workRequestResult.data[0];

        // Check if work request is accepted
        if (workRequest.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Work request must be accepted before creating tasks'
            });
        }

        // Validate and format deadline date
        let formattedDeadline = null;
        if (deadline) {
            // Validate date format and ensure proper YYYY-MM-DD format
            const dateRegex = /^\d{4}-\d{1,2}-\d{1,2}$/;
            if (!dateRegex.test(deadline)) {
                return res.status(400).json({
                    success: false,
                    error: 'Deadline must be in YYYY-MM-DD format'
                });
            }

            // Parse and format the date to ensure proper padding
            const dateParts = deadline.split('-');
            const year = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]);
            const day = parseInt(dateParts[2]);

            // Validate date components
            if (month < 1 || month > 12 || day < 1 || day > 31) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date components in deadline'
                });
            }

            // Format with proper zero-padding
            formattedDeadline = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

            // Additional validation: check if it's a valid date
            const testDate = new Date(formattedDeadline);
            if (isNaN(testDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date provided for deadline'
                });
            }
        }

        // Validate dependencies if provided
        if (dependencies && Array.isArray(dependencies) && dependencies.length > 0) {
            // Check if all dependency tasks exist and belong to the same work_request
            const dependencyTasks = await Tasks.findAll({
                where: {
                    id: { [Op.in]: dependencies },
                    work_request_id: work_request_id
                },
                attributes: ['id', 'deadline']
            });

            if (dependencyTasks.length !== dependencies.length) {
                return res.status(400).json({
                    success: false,
                    error: 'Some dependency tasks not found or do not belong to this work request'
                });
            }

            // Check if deadline is on or after the latest dependency deadline
            if (formattedDeadline) {
                const latestDependencyDeadline = dependencyTasks.reduce((latest, task) => {
                    return task.deadline && (!latest || task.deadline > latest) ? task.deadline : latest;
                }, null);

                if (latestDependencyDeadline && new Date(formattedDeadline) < new Date(latestDependencyDeadline)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Task deadline cannot be before the latest dependency deadline'
                    });
                }
            }
        }

        // Create the task
        const taskData = {
            work_request_id,
            task_name,
            description,
            request_type_id,
            task_type_id,
            deadline: formattedDeadline,
            status: 'pending'
        };

        // Add project_type_id if provided
        if (project_type_id) {
            taskData.project_type_id = project_type_id;
        }

        const taskResult = await Tasks.create(taskData);

        // Create task assignments
        const assignmentRecords = assigned_to_ids.map(userId => ({
            task_id: taskResult.id,
            user_id: userId
        }));
        await TaskAssignments.bulkCreate(assignmentRecords);

        // Create dependencies if provided
        if (dependencies && Array.isArray(dependencies) && dependencies.length > 0) {
            const dependencyRecords = dependencies.map(depTaskId => ({
                task_id: taskResult.id,
                dependency_task_id: depTaskId
            }));
            await TaskDependencies.bulkCreate(dependencyRecords);
        }

        // Create folder structure under existing project folder: project_name/task_name/user_folders
        try {
            const uploadDir = path.join(__dirname, '../../uploads');
            const sanitizedProjectName = workRequest.project_name.replace(/[^a-zA-Z0-9]/g, '_');
            const projectFolder = path.join(uploadDir, sanitizedProjectName);
            const taskFolder = path.join(projectFolder, task_name);

            // Check if project folder exists (should be created by createWorkRequest)
            if (!fs.existsSync(projectFolder)) {
                console.error(`Project folder does not exist: ${projectFolder}`);
                // Don't fail the task creation if folder creation fails
            } else {
                // Create task folder under existing project folder
                if (!fs.existsSync(taskFolder)) {
                    fs.mkdirSync(taskFolder);
                }

                // Create user folders for each assigned user
                for (const userId of assigned_to_ids) {
                    // Get user details to get the name
                    const user = await User.findByPk(userId, { attributes: ['name'] });
                    if (user && user.name) {
                        const userFolder = path.join(taskFolder, user.name);
                        if (!fs.existsSync(userFolder)) {
                            fs.mkdirSync(userFolder, { recursive: true });
                        }
                    }
                }
            }
        } catch (folderError) {
            console.error('Error creating folders:', folderError);
            // Don't fail the task creation if folder creation fails
        }

        await logUserActivity({
            event: 'task_created',
            userId: req.user.id,
            workRequestId: work_request_id,
            taskId: taskResult.id,
            ...extractRequestDetails(req)
        });

        res.status(201).json({
            success: true,
            data: taskResult,
            message: 'Task created successfully'
        });
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to create task'
        });
    }
};

const getTasksByWorkRequestId = async (req, res) => {
    try {
        // Define associations for TaskAssignments
        Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });

        const workRequestId = parseInt(req.params.work_request_id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const manager_id = req.user.id;

        // Check if work request is assigned to this manager
        const workRequestResult = await workRequestService.getAll({
            where: { id: workRequestId },
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

        if (!workRequestResult.success || workRequestResult.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found or not assigned to you'
            });
        }

        // Get all tasks for this work request with basic details, dependencies, assigned users, request type, and task type
        const tasksResult = await Tasks.findAll({
            where: { work_request_id: workRequestId },
            attributes: ['id', 'task_name', 'deadline'],
            include: [
                {
                    model: TaskDependencies,
                    as: 'dependencies',
                    include: [
                        {
                            model: Tasks,
                            as: 'dependencyTask',
                            attributes: ['id', 'task_name']
                        }
                    ]
                },
                {
                    model: TaskAssignments,
                    include: [
                        {
                            model: User,
                            attributes: ['id', 'name', 'email'],
                            include: [
                                {
                                    model: Division,
                                    as: 'Divisions',
                                    attributes: ['id', 'title'],
                                    through: { attributes: [] }
                                }
                            ]
                        },
                        {
                            model: TaskDocuments,
                            attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status']
                        }
                    ]
                },
                {
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description']
                },
                {
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description']
                }
            ],
            order: [['created_at', 'ASC']]
        });

        // Transform the data to flatten dependencies and include users with divisions, request type, and task type
        const transformedTasks = tasksResult.map(task => ({
            id: task.id,
            task_name: task.task_name,
            deadline: task.deadline,
            requestType: task.RequestType ? {
                id: task.RequestType.id,
                request_type: task.RequestType.request_type,
                description: task.RequestType.description
            } : null,
            taskType: task.TaskType ? {
                id: task.TaskType.id,
                task_type: task.TaskType.task_type,
                description: task.TaskType.description
            } : null,
            dependencies: task.dependencies.map(dep => ({
                id: dep.dependencyTask.id,
                task_name: dep.dependencyTask.task_name,
                deadline: dep.dependencyTask.deadline
            })),
            assignedUsers: task.TaskAssignments.map(assignment => ({
                id: assignment.User.id,
                name: assignment.User.name,
                email: assignment.User.email,
                divisions: assignment.User.Divisions.map(division => ({
                    id: division.id,
                    title: division.title
                })),
                documents: assignment.TaskDocuments
            }))
        }));

        await logUserActivity({
            event: 'tasks_by_work_request_viewed',
            userId: req.user.id,
            workRequestId: workRequestId,
            taskCount: tasksResult.length,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: transformedTasks,
            message: 'Tasks retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch tasks'
        });
    }
};

const getTaskAnalytics = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const manager_id = req.user.id;

        // Check if work request is assigned to this manager
        const workRequestResult = await workRequestService.getAll({
            where: { id: workRequestId },
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

        if (!workRequestResult.success || workRequestResult.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found or not assigned to you'
            });
        }

        // 1. Total tasks
        const totalTasks = await Tasks.count({
            where: { work_request_id: workRequestId }
        });

        // 2. Publish date (latest deadline of all tasks)
        const latestDeadlineTask = await Tasks.findOne({
            where: { work_request_id: workRequestId },
            order: [['deadline', 'DESC']],
            attributes: ['deadline']
        });
        const publishDate = latestDeadlineTask && latestDeadlineTask.deadline ? latestDeadlineTask.deadline : null;

        // 3. Estimated TAT (from earliest to latest task deadline)
        const earliestDeadlineTask = await Tasks.findOne({
            where: { work_request_id: workRequestId },
            order: [['deadline', 'ASC']],
            attributes: ['deadline']
        });

        const latestDeadlineTaskForTAT = await Tasks.findOne({
            where: { work_request_id: workRequestId },
            order: [['deadline', 'DESC']],
            attributes: ['deadline']
        });

        let estimatedTAT = null;
        if (earliestDeadlineTask && earliestDeadlineTask.deadline && latestDeadlineTaskForTAT && latestDeadlineTaskForTAT.deadline) {
            const startDate = new Date(earliestDeadlineTask.deadline);
            const endDate = new Date(latestDeadlineTaskForTAT.deadline);
            const diffTime = Math.abs(endDate - startDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
            estimatedTAT = diffDays;
        }

        // 4. Team Members Assigned
        const assignedUsers = await TaskAssignments.findAll({
            where: {},
            include: [
                {
                    model: Tasks,
                    where: { work_request_id: workRequestId },
                    attributes: []
                },
                {
                    model: User,
                    attributes: ['id', 'name', 'email']
                }
            ],
            attributes: []
        });

        const teamMembers = [...new Set(assignedUsers.map(ta => ta.User))].map(user => ({
            id: user.id,
            name: user.name,
            email: user.email
        }));

        // 5. SME Request (total request type count - 1)
        const requestTypeCount = await Tasks.findAll({
            where: { work_request_id: workRequestId },
            attributes: ['request_type_id'],
            group: ['request_type_id']
        });
        const smeRequest = requestTypeCount.length - 1;

        const analytics = {
            totalTasks,
            publishDate,
            estimatedTAT,
            teamMembers,
            smeRequest
        };

        await logUserActivity({
            event: 'task_analytics_viewed',
            userId: req.user.id,
            workRequestId: workRequestId,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: analytics,
            message: 'Task analytics retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching task analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch task analytics'
        });
    }
};

const getMyTeam = async (req, res) => {
    try {
        const manager_id = req.user.id;

        // Get all divisions the manager belongs to
        const managerDivisions = await UserDivisions.findAll({
            where: { user_id: manager_id },
            include: [
                {
                    model: Division,
                    as: 'division',
                    attributes: ['id', 'title', 'department_id']
                }
            ],
            attributes: []
        });

        if (!managerDivisions || managerDivisions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No divisions found for this manager'
            });
        }

        const teamData = [];

        // For each division, get creative users and their task counts
        for (const managerDivision of managerDivisions) {
            const division = managerDivision.division;

            // Get all creative users and creative leads in this division (job_role_id = 3 for Creative Lead, 4 for Creative User)
            const creativeUsers = await UserDivisions.findAll({
                where: { division_id: division.id },
                include: [
                    {
                        model: User,
                        where: {
                            id: { [Op.ne]: manager_id },
                            // job_role_id: { [Op.in]: [3, 4] }, // Creative Lead and Creative User
                            account_status: 'active'
                        },
                        attributes: ['id', 'name', 'email', 'job_role_id']
                    }
                ],
                attributes: []
            });

            const divisionTeam = {
                division: {
                    id: division.id,
                    name: division.title,
                    department_id: division.department_id
                },
                teamMembers: []
            };

            // For each creative user, count their assigned tasks
            for (const userDivision of creativeUsers) {
                const user = userDivision.User;

                // Count active tasks (accepted or in_progress) assigned to this user
                const taskCount = await TaskAssignments.count({
                    where: { user_id: user.id },
                    include: [
                        {
                            model: Tasks,
                            where: { status: { [Op.in]: ['accepted', 'in_progress'] } },
                            attributes: []
                        }
                    ]
                });

                divisionTeam.teamMembers.push({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    jobRole: user.job_role_id,
                    taskCount: taskCount
                });
            }

            // Only add division if it has team members
            if (divisionTeam.teamMembers.length > 0) {
                teamData.push(divisionTeam);
            }
        }

        await logUserActivity({
            event: 'my_team_viewed',
            userId: req.user.id,
            divisionCount: teamData.length,
            totalMembers: teamData.reduce((sum, div) => sum + div.teamMembers.length, 0),
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: teamData,
            message: 'My team retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching my team:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch my team'
        });
    }
};

const getAssignedRequestsWithStatus = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { status } = req.query; // Optional status query parameter

        let where = { status: { [Op.ne]: 'draft' } };

        // Apply status filter if provided
        if (status) {
            if (!['pending', 'accepted', 'in_progress', 'assigned'].includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status. Allowed values: pending, accepted, in_progress' });
            }
            where.status = status;
        }

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

        // Prepare includes
        const includes = [
            {
                model: WorkRequestManagers,
                where: { manager_id: manager_id },
                required: true,
                attributes: []
            },
            { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
            { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
        ];

        // If status is in_progress, include tasks with deadline
        if (status === 'in_progress' || status === 'assigned') {
            includes.push({
                model: Tasks,
                attributes: ['id', 'task_name', 'description', 'deadline', 'status'],
                include: [
                    {
                        model: User,
                        as: 'assignedUsers',
                        attributes: ['id', 'name', 'email'],
                        through: { attributes: [] }
                    }
                ]
            });
        }

        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['request_type_id', 'requested_manager_link_id', 'updated_at'] },
            include: includes,
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });

        if (result.success) {
            // If status is in_progress, add latestTaskDeadline to each work request
            if (status === 'in_progress') {
                for (const workRequest of result.data) {
                    if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                        const latestDeadline = workRequest.Tasks.reduce((latest, task) => {
                            return task.deadline && (!latest || task.deadline > latest) ? task.deadline : latest;
                        }, null);
                        workRequest.dataValues.latestTaskDeadline = latestDeadline;
                    } else {
                        workRequest.dataValues.latestTaskDeadline = null;
                    }
                }
            }

            await logUserActivity({
                event: 'assigned_requests_with_status_viewed',
                userId: req.user.id,
                status: status || 'all',
                count: result.data.length,
                ...extractRequestDetails(req)
            });
            res.json({ success: true, data: result.data, pagination: req.pagination });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error fetching assigned requests with status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const assignTasksToUsers = async (req, res) => {
    try {

        const workRequestId = parseInt(req.params.id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const manager_id = req.user.id;

        // Check if work request exists and is assigned to this manager
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
                    attributes: ['request_type']
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

        // Check if work request is accepted
        if (workRequest.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Work request must be accepted before sending task notifications'
            });
        }

        // Get all tasks for this work request with assigned users
        const tasksWithUsers = await Tasks.findAll({
            where: { work_request_id: workRequestId },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: [] }
                }
            ],
            attributes: ['id', 'task_name', 'description', 'deadline']
        });

        // Group tasks by user
        const userTasksMap = new Map();

        for (const task of tasksWithUsers) {
            for (const user of task.assignedUsers) {
                if (!userTasksMap.has(user.id)) {
                    userTasksMap.set(user.id, { user, tasks: [] });
                }
                userTasksMap.get(user.id).tasks.push({
                    id: task.id,
                    task_name: task.task_name,
                    description: task.description,
                    deadline: task.deadline
                });
            }
        }

        // Send emails to all assigned users
        const emailPromises = [];
        const assignedUsers = [];

        for (const [userId, userData] of userTasksMap) {
            const { user, tasks } = userData;
            assignedUsers.push({
                id: user.id,
                name: user.name,
                email: user.email,
                taskCount: tasks.length
            });

            const html = renderTemplate('taskAssignmentNotification', {
                project_name: workRequest.project_name,
                brand: workRequest.brand,
                request_type: workRequest.RequestType?.request_type || 'N/A',
                priority: workRequest.priority,
                request_id: workRequest.id,
                assigned_at: new Date().toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                tasks: tasks,
                frontend_url: process.env.FRONTEND_URL
            });

            const mailOptions = {
                to: user.email,
                subject: 'Tasks Assigned - D-Map',
                html
            };

            emailPromises.push(sendMail(mailOptions));
        }

        // Wait for all emails to be sent
        await Promise.all(emailPromises);

        // Update intimate_team to 1 for all tasks in this work request
        await Tasks.update(
            { intimate_team: 1 },
            { where: { work_request_id: workRequestId } }
        );

        // Update work request status to in_progress
        await workRequestService.updateById(workRequestId, { status: 'assigned' });

        await logUserActivity({
            event: 'work_request_status_updated',
            userId: req.user.id,
            workRequestId: workRequestId,
            oldStatus: 'accepted',
            newStatus: 'assigned',
            reason: 'tasks_assigned_to_users',
            ...extractRequestDetails(req)
        });

        await logUserActivity({
            event: 'task_assignment_notifications_sent',
            userId: req.user.id,
            workRequestId: workRequestId,
            notificationCount: assignedUsers.length,
            totalTasks: tasksWithUsers.length,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: {
                assignedUsers,
                totalTasks: tasksWithUsers.length,
                notificationsSent: assignedUsers.length
            },
            message: 'Task assignment notifications sent successfully and work request status updated to in_progress'
        });
    } catch (error) {
        console.error('Error sending task assignment notifications:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to send task assignment notifications'
        });
    }
};




module.exports = {
    getAssignedWorkRequests,
    getAssignedWorkRequestById,
    acceptWorkRequest,
    deferWorkRequest,
    getAssignableUsers,
    getTaskTypesByWorkRequest,
    createTask,
    getTasksByWorkRequestId,
    getTaskAnalytics,
    getMyTeam,
    assignTasksToUsers,
    getAssignedRequestsWithStatus
};