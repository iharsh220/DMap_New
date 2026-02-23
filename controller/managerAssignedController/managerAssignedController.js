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
            if (workRequest.status !== 'accepted' && workRequest.status !== 'assigned' && workRequest.status !== 'in_progress') {
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

        // Get active task count (accepted + in_progress) for each user
        const userIds = assignableUsersResult.data.map(user => user.id);
        const activeTaskCounts = await TaskAssignments.findAll({
            where: {
                user_id: { [Op.in]: userIds }
            },
            include: [
                {
                    model: Tasks,
                    where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } },
                    attributes: []
                }
            ],
            attributes: [
                'user_id',
                [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'active_count']
            ],
            group: ['user_id'],
            raw: true
        });

        // Create a map of user_id to active count
        const activeCountMap = new Map();
        activeTaskCounts.forEach(count => {
            activeCountMap.set(count.user_id, parseInt(count.active_count));
        });

        // Format the response
        const formattedData = assignableUsersResult.data.map(user => ({
            id: user.id,
            name: user.id === manager_id ? 'Self' : user.name,
            activeTasks: activeCountMap.get(user.id) || 0,
            manager: {
                id: manager.id,
                name: manager.name
            },
            divisions: user.Divisions.map(div => ({
                id: div.id,
                name: div.title
            }))
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
                                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version']
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
            // Collect unique user IDs
            const userIds = [...new Set(result.data.map(wr => wr.user_id))];

            // Fetch complete user details
            const users = await User.findAll({
                where: { id: { [Op.in]: userIds } },
                include: [
                    { model: Department, attributes: ['id', 'department_name'] },
                    { model: JobRole, attributes: ['id', 'role_title'] },
                    { model: Location, attributes: ['id', 'location_name'] },
                    { model: Designation, attributes: ['id', 'designation_name'] },
                    {
                        model: Division,
                        as: 'Divisions',
                        attributes: ['id', 'title'],
                        through: { attributes: [] }
                    }
                ],
                attributes: { exclude: ['password', 'created_at', 'updated_at', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }
            });

            const userMap = new Map(users.map(u => [u.id, u.toJSON()]));

            // Add deadline field and complete user details for each work request
            for (const workRequest of result.data) {
                if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                    const latestDeadline = workRequest.Tasks.reduce((latest, task) => {
                        return task.deadline && (!latest || task.deadline > latest) ? task.deadline : latest;
                    }, null);
                    workRequest.dataValues.deadline = latestDeadline;
                } else {
                    workRequest.dataValues.deadline = null;
                }

                // Replace users with complete details
                workRequest.dataValues.users = userMap.get(workRequest.user_id);
            }

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
        const user_id = req.user.id;
        const user_type = req.user.userType;

        let workRequest = null;
        let hasAccess = false;

        // First, try to get work request if user is a manager assigned to it
        if (user_type === 'user') {
            const managerResult = await workRequestService.getAll({
                where: { id },
                attributes: { exclude: ['request_type_id', 'requested_manager_link_id', 'updated_at'] },
                include: [
                    {
                        model: WorkRequestManagers,
                        where: { manager_id: user_id },
                        required: true,
                        attributes: []
                    },
                    {
                        model: User, as: 'users', attributes: { exclude: ['password', 'created_at', 'updated_at', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] },
                        include: [
                            { model: Department, attributes: ['id', 'department_name'] },
                            { model: JobRole, attributes: ['id', 'role_title'] },
                            { model: Location, attributes: ['id', 'location_name'] },
                            { model: Designation, attributes: ['id', 'designation_name'] },
                            {
                                model: Division,
                                as: 'Divisions',
                                attributes: ['id', 'title'],
                                through: { attributes: [] }
                            }
                        ]
                    },
                    { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                    { model: ProjectType, attributes: { exclude: ['created_at', 'updated_at'] } },
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
                                        attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version']
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

            if (managerResult.success && managerResult.data.length > 0) {
                workRequest = managerResult.data[0];
                hasAccess = true;
            }
        }

        // If not a manager or manager access failed, check if user is assigned to tasks in this work request
        if (!hasAccess) {
            // Check if user is assigned to any tasks in this work request
            const taskCheck = await Tasks.findAll({
                where: { work_request_id: id },
                include: [
                    {
                        model: TaskAssignments,
                        where: { user_id: user_id },
                        required: true,
                        attributes: []
                    }
                ],
                limit: 1
            });

            if (taskCheck.length > 0) {
                // User is assigned to tasks, get the work request
                const userResult = await workRequestService.getAll({
                    where: { id },
                    attributes: { exclude: ['request_type_id', 'requested_manager_link_id', 'updated_at'] },
                    include: [
                        {
                            model: User, as: 'users', attributes: { exclude: ['password', 'created_at', 'updated_at', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] },
                            include: [
                                { model: Department, attributes: ['id', 'department_name'] },
                                { model: JobRole, attributes: ['id', 'role_title'] },
                                { model: Location, attributes: ['id', 'location_name'] },
                                { model: Designation, attributes: ['id', 'designation_name'] },
                                {
                                    model: Division,
                                    as: 'Divisions',
                                    attributes: ['id', 'title'],
                                    through: { attributes: [] }
                                }
                            ]
                        },
                        { model: RequestType, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                        { model: ProjectType, attributes: { exclude: ['created_at', 'updated_at'] } },
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
                                            attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version']
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

                if (userResult.success && userResult.data.length > 0) {
                    workRequest = userResult.data[0];
                    hasAccess = true;
                }
            }
        }

        if (!hasAccess || !workRequest) {
            return res.status(404).json({ success: false, error: 'Assigned work request not found' });
        }

        // Fetch complete user details with associations
        if (workRequest.users) {
            const userDetails = await User.findByPk(workRequest.users.id, {
                include: [
                    { model: Department, attributes: ['id', 'department_name'] },
                    { model: JobRole, attributes: ['id', 'role_title'] },
                    { model: Location, attributes: ['id', 'location_name'] },
                    { model: Designation, attributes: ['id', 'designation_name'] },
                    {
                        model: Division,
                        as: 'Divisions',
                        attributes: ['id', 'title'],
                        through: { attributes: [] }
                    }
                ],
                attributes: { exclude: ['password', 'created_at', 'updated_at', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }
            });
            workRequest.dataValues.users = userDetails.toJSON();
        }

        // Get user task counts (accepted + in_progress) for all assigned users
        const allAssignedUserIds = [];
        if (workRequest.Tasks && workRequest.Tasks.length > 0) {
            for (const task of workRequest.Tasks) {
                if (task.TaskAssignments && task.TaskAssignments.length > 0) {
                    for (const assignment of task.TaskAssignments) {
                        if (assignment.User && assignment.User.id) {
                            allAssignedUserIds.push(assignment.User.id);
                        }
                    }
                }
            }
        }

        // Remove duplicates
        const uniqueUserIds = [...new Set(allAssignedUserIds)];

        let userTaskCounts = {};
        if (uniqueUserIds.length > 0) {
            // Get accepted tasks count
            const acceptedCounts = await TaskAssignments.findAll({
                where: {
                    user_id: { [Op.in]: uniqueUserIds }
                },
                include: [
                    {
                        model: Tasks,
                        where: { status: 'accepted' },
                        attributes: []
                    }
                ],
                attributes: [
                    'user_id',
                    [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'accepted_count']
                ],
                group: ['user_id'],
                raw: true
            });

            // Get in_progress tasks count
            const inProgressCounts = await TaskAssignments.findAll({
                where: {
                    user_id: { [Op.in]: uniqueUserIds }
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
                    [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'in_progress_count']
                ],
                group: ['user_id'],
                raw: true
            });

            // Organize counts
            acceptedCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0 };
                }
                userTaskCounts[count.user_id].accepted = parseInt(count.accepted_count);
            });

            inProgressCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0 };
                }
                userTaskCounts[count.user_id].in_progress = parseInt(count.in_progress_count);
            });
        }

        // Add task counts to assigned users in the response
        if (workRequest.Tasks && workRequest.Tasks.length > 0) {
            for (const task of workRequest.Tasks) {
                if (task.TaskAssignments && task.TaskAssignments.length > 0) {
                    for (const assignment of task.TaskAssignments) {
                        if (assignment.User && assignment.User.id) {
                            const counts = userTaskCounts[assignment.User.id] || { accepted: 0, in_progress: 0 };
                            assignment.User.dataValues.acceptedTasksCount = counts.accepted;
                            assignment.User.dataValues.inProgressTasksCount = counts.in_progress;
                            assignment.User.dataValues.totalActiveTasks = counts.accepted + counts.in_progress;
                        }
                    }
                }
            }
        }

        // Collect all unique users from tasks with their full details
        const taskUsers = [];
        const userIds = new Set();

        if (workRequest.Tasks && workRequest.Tasks.length > 0) {
            for (const task of workRequest.Tasks) {
                if (task.TaskAssignments && task.TaskAssignments.length > 0) {
                    for (const assignment of task.TaskAssignments) {
                        if (assignment.User && assignment.User.id && !userIds.has(assignment.User.id)) {
                            userIds.add(assignment.User.id);

                            // Get full user details with associations
                            const userDetails = await User.findByPk(assignment.User.id, {
                                include: [
                                    { model: Department, attributes: ['id', 'department_name'] },
                                    { model: JobRole, attributes: ['id', 'role_title'] },
                                    { model: Location, attributes: ['id', 'location_name'] },
                                    { model: Designation, attributes: ['id', 'designation_name'] },
                                    {
                                        model: Division,
                                        as: 'Divisions',
                                        attributes: ['id', 'title'],
                                        through: { attributes: [] }
                                    }
                                ],
                                attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }
                            });

                            if (userDetails) {
                                const counts = userTaskCounts[assignment.User.id] || { accepted: 0, in_progress: 0 };
                                taskUsers.push({
                                    ...userDetails.toJSON(),
                                    acceptedTasksCount: counts.accepted,
                                    inProgressTasksCount: counts.in_progress,
                                    totalActiveTasks: counts.accepted + counts.in_progress
                                });
                            }
                        }
                    }
                }
            }
        }

        // Add task users to the work request response
        workRequest.dataValues.taskUsers = taskUsers;

        res.json({ success: true, data: workRequest });
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

        }

        res.json({ success: true, message: 'Work request deferred successfully' });
    } catch (error) {
        console.error('Error deferring work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getTaskTypesByWorkRequest = async (req, res) => {
    try {
        const manager_id = req.user.id;
        let projectId;
        // Check if project_id is provided as query parameter
        if (req.query.project_id) {
            projectId = parseInt(req.query.project_id, 10);
            if (isNaN(projectId)) {
                return res.status(400).json({ success: false, error: 'Invalid project ID' });
            }
        } else {
            // Use work_request_id from params
            const workRequestId = parseInt(req.query.work_request_id, 10);
            if (isNaN(workRequestId)) {
                return res.status(400).json({ success: false, error: 'Invalid work request ID' });
            }

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
            projectId = workRequest.project_id;
        }

        if (!projectId) {
            return res.json({
                success: true,
                data: [],
                message: 'No project type associated'
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
        if (workRequest.status !== 'accepted' && workRequest.status !== 'assigned') {
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
                            attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version']
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

        // Check if work request is assigned to this manager and get complete work request details
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
                    model: User,
                    as: 'users',
                    foreignKey: 'user_id',
                    attributes: ['id', 'name', 'email', 'job_role_id', 'department_id', 'location_id', 'designation_id']
                },
                {
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description']
                },
                {
                    model: ProjectType,
                    attributes: ['id', 'project_type', 'description']
                },
                {
                    model: WorkRequestDocuments,
                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status']
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

        // Get the work request details to access updated_at date
        const workRequest = workRequestResult.data[0];

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

        // 3. Estimated TAT (from work request updated_at to latest task deadline, excluding weekends)
        let estimatedTAT = null;

        // Only calculate if work request is not pending and has an updated_at date
        if (workRequest.status !== 'pending' && workRequest.updated_at) {
            const latestDeadlineTaskForTAT = await Tasks.findOne({
                where: { work_request_id: workRequestId },
                order: [['deadline', 'DESC']],
                attributes: ['deadline']
            });

            if (latestDeadlineTaskForTAT && latestDeadlineTaskForTAT.deadline) {
                const startDate = new Date(workRequest.updated_at);
                const endDate = new Date(latestDeadlineTaskForTAT.deadline);

                // Calculate business days (excluding weekends)
                let businessDays = 0;
                const currentDate = new Date(startDate);

                while (currentDate <= endDate) {
                    const dayOfWeek = currentDate.getDay();
                    // 0 = Sunday, 6 = Saturday - skip these
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                        businessDays++;
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }

                estimatedTAT = businessDays;
            }
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

        // Format work request details
        const workRequestDetails = {
            id: workRequest.id,
            project_name: workRequest.project_name,
            brand: workRequest.brand,
            description: workRequest.description,
            about_project: workRequest.about_project,
            priority: workRequest.priority,
            status: workRequest.status,
            requested_at: workRequest.requested_at,
            remarks: workRequest.remarks,
            created_at: workRequest.created_at,
            updated_at: workRequest.updated_at,
            user: workRequest.users ? {
                id: workRequest.users.id,
                name: workRequest.users.name,
                email: workRequest.users.email,
                job_role_id: workRequest.users.job_role_id,
                department_id: workRequest.users.department_id,
                location_id: workRequest.users.location_id,
                designation_id: workRequest.users.designation_id
            } : null,
            request_type: workRequest.RequestType ? {
                id: workRequest.RequestType.id,
                request_type: workRequest.RequestType.request_type,
                description: workRequest.RequestType.description
            } : null,
            project_type: workRequest.ProjectType ? {
                id: workRequest.ProjectType.id,
                project_type: workRequest.ProjectType.project_type,
                description: workRequest.ProjectType.description
            } : null,
            documents: workRequest.WorkRequestDocuments || []
        };

        const analytics = {
            workRequest: workRequestDetails,
            totalTasks,
            publishDate,
            estimatedTAT,
            teamMembers,
            smeRequest
        };

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
                            where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } },
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

            // Apply search filter if provided
            if (req.search && req.search.term) {
                const searchTerm = req.search.term.toLowerCase();
                divisionTeam.teamMembers = divisionTeam.teamMembers.filter(member =>
                    member.name.toLowerCase().includes(searchTerm) ||
                    member.email.toLowerCase().includes(searchTerm)
                );
            }

            // Only add division if it has team members
            if (divisionTeam.teamMembers.length > 0) {
                teamData.push(divisionTeam);
            }
        }

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

        // Handle array values for status (from comma-separated)
        if (where.status && Array.isArray(where.status)) {
            where.status = { [Op.in]: where.status };
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
            {
                model: User, as: 'users', attributes: { exclude: ['password', 'created_at', 'updated_at', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] },
                include: [
                    { model: Department, attributes: ['id', 'department_name'] },
                    { model: JobRole, attributes: ['id', 'role_title'] },
                    { model: Location, attributes: ['id', 'location_name'] },
                    { model: Designation, attributes: ['id', 'designation_name'] },
                    {
                        model: Division,
                        as: 'Divisions',
                        attributes: ['id', 'title'],
                        through: { attributes: [] }
                    }
                ]
            },
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
        if (workRequest.status !== 'accepted' && workRequest.status !== 'assigned') {
            return res.status(400).json({
                success: false,
                error: 'Work request must be accepted before sending task notifications'
            });
        }

        // Get the latest task assignment for this work request with task details
        const latestTaskAssignment = await TaskAssignments.findOne({
            where: {},
            include: [
                {
                    model: Tasks,
                    where: { work_request_id: workRequestId },
                    attributes: ['id', 'task_name', 'description', 'deadline']
                },
                {
                    model: User,
                    attributes: ['id', 'name', 'email']
                }
            ],
            attributes: [],
            order: [['created_at', 'DESC']]
        });

        if (!latestTaskAssignment) {
            return res.status(404).json({
                success: false,
                error: 'No tasks found for this work request'
            });
        }

        // Only send notification for the latest task
        const user = latestTaskAssignment.User;
        const task = latestTaskAssignment.Task;

        const userTasksMap = new Map();
        userTasksMap.set(user.id, {
            user,
            tasks: [{
                id: task.id,
                task_name: task.task_name,
                description: task.description,
                deadline: task.deadline
            }]
        });

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

        res.json({
            success: true,
            data: {
                assignedUsers,
                totalTasks: 1, // Only sending latest task
                notificationsSent: assignedUsers.length
            },
            message: 'Task assignment notification sent successfully for the latest task and work request status updated to assigned'
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


const updateWorkRequestProject = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const manager_id = req.user.id;
        const { project_id, project_name } = req.body;

        // Validate required fields
        if (!project_id || !project_name) {
            return res.status(400).json({
                success: false,
                error: 'project_id and project_name are required'
            });
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

        // Update the work request
        const updateResult = await workRequestService.updateById(id, { project_id, project_name });

        if (updateResult.success) {
            res.json({ success: true, message: 'Work request project updated successfully' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to update work request project' });
        }
    } catch (error) {
        console.error('Error updating work request project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteWorkRequest = async (req, res) => {
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

        // Get all task IDs for this work request
        const tasks = await Tasks.findAll({ where: { work_request_id: id }, attributes: ['id'] });
        const taskIds = tasks.map(t => t.id);

        // Get all task assignment IDs for these tasks
        const taskAssignments = await TaskAssignments.findAll({ where: { task_id: { [Op.in]: taskIds } }, attributes: ['id'] });
        const taskAssignmentIds = taskAssignments.map(ta => ta.id);

        // Delete related records first to avoid foreign key constraints
        // Delete TaskDocuments for these task assignments
        if (taskAssignmentIds.length > 0) {
            await TaskDocuments.destroy({ where: { task_assignment_id: { [Op.in]: taskAssignmentIds } } });
        }

        // Delete TaskAssignments for these tasks
        if (taskIds.length > 0) {
            await TaskAssignments.destroy({ where: { task_id: { [Op.in]: taskIds } } });
        }

        // Delete TaskDependencies for these tasks
        if (taskIds.length > 0) {
            await TaskDependencies.destroy({ where: { task_id: { [Op.in]: taskIds } } });
            await TaskDependencies.destroy({ where: { dependency_task_id: { [Op.in]: taskIds } } });
        }

        // Delete Tasks
        await Tasks.destroy({ where: { work_request_id: id } });

        // Delete WorkRequestDocuments
        await WorkRequestDocuments.destroy({ where: { work_request_id: id } });

        // Delete WorkRequestManagers
        await WorkRequestManagers.destroy({ where: { work_request_id: id } });

        // Finally, delete the WorkRequest
        const deleteResult = await workRequestService.deleteById(id);

        if (deleteResult.success) {
            res.json({ success: true, message: 'Work request and all related data deleted successfully' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to delete work request' });
        }
    } catch (error) {
        console.error('Error deleting work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteTask = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }
        const manager_id = req.user.id;

        // Find the task with its work request
        const task = await Tasks.findByPk(taskId, {
            include: [
                {
                    model: WorkRequests,
                    include: [
                        {
                            model: WorkRequestManagers,
                            where: { manager_id: manager_id },
                            required: true,
                            attributes: []
                        }
                    ]
                }
            ]
        });

        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found or not assigned to you' });
        }

        // Get all task assignment IDs for this task
        const taskAssignments = await TaskAssignments.findAll({ where: { task_id: taskId }, attributes: ['id'] });
        const taskAssignmentIds = taskAssignments.map(ta => ta.id);

        // Delete related records first to avoid foreign key constraints
        // Delete TaskDocuments for these task assignments
        if (taskAssignmentIds.length > 0) {
            await TaskDocuments.destroy({ where: { task_assignment_id: { [Op.in]: taskAssignmentIds } } });
        }

        // Delete TaskAssignments for this task
        await TaskAssignments.destroy({ where: { task_id: taskId } });

        // Delete TaskDependencies for this task (both as main task and as dependency)
        await TaskDependencies.destroy({ where: { task_id: taskId } });
        await TaskDependencies.destroy({ where: { dependency_task_id: taskId } });

        // Delete the Task
        await Tasks.destroy({ where: { id: taskId } });

        res.json({
            success: true,
            message: `Task ${taskId} and all related data deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getMyTasks = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { status } = req.query;

        // Build where condition for tasks
        let whereCondition = {};

        // Apply status filter if provided
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());

            const validStatuses = ['pending', 'accepted', 'in_progress', 'completed'];
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));

            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }

            if (statusArray.length > 1) {
                whereCondition.status = { [Op.in]: statusArray };
            } else {
                whereCondition.status = statusArray[0];
                if (statusArray[0] === 'pending') {
                    whereCondition.intimate_team = 1;
                }
            }
        } else {
            whereCondition.status = 'pending';
            whereCondition.intimate_team = 1;
        }

        // Get tasks assigned to the user
        const tasks = await Tasks.findAll({
            where: whereCondition,
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: user_id },
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: [] },
                    required: true
                },
                {
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description']
                },
                {
                    model: WorkRequests,
                    attributes: ['id', 'project_name', 'brand', 'priority', 'status', 'created_at', 'updated_at'],
                    include: [
                        {
                            model: User,
                            as: 'users',
                            attributes: ['id', 'name', 'email']
                        },
                        {
                            model: RequestType,
                            attributes: ['id', 'request_type', 'description']
                        },
                        {
                            model: WorkRequestManagers,
                            attributes: ['id'],
                            include: [
                                {
                                    model: User,
                                    as: 'manager',
                                    attributes: ['id', 'name', 'email']
                                }
                            ]
                        }
                    ]
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
            ],
            attributes: { exclude: [] },
            order: [['deadline', 'ASC']]
        });

        // Get task counts for the user
        let userTaskCounts = {};

        // Get accepted tasks count
        const acceptedCounts = await TaskAssignments.findAll({
            where: { user_id: user_id },
            include: [
                {
                    model: Tasks,
                    where: { status: 'accepted' },
                    attributes: []
                }
            ],
            attributes: [
                'user_id',
                [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'accepted_count']
            ],
            group: ['user_id'],
            raw: true
        });

        // Get in_progress tasks count
        const inProgressCounts = await TaskAssignments.findAll({
            where: { user_id: user_id },
            include: [
                {
                    model: Tasks,
                    where: { status: 'in_progress' },
                    attributes: []
                }
            ],
            attributes: [
                'user_id',
                [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'in_progress_count']
            ],
            group: ['user_id'],
            raw: true
        });

        // Get completed tasks count
        const completedCounts = await TaskAssignments.findAll({
            where: { user_id: user_id },
            include: [
                {
                    model: Tasks,
                    where: { status: 'completed' },
                    attributes: []
                }
            ],
            attributes: [
                'user_id',
                [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'completed_count']
            ],
            group: ['user_id'],
            raw: true
        });

        // Organize counts
        acceptedCounts.forEach(count => {
            userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
            userTaskCounts[count.user_id].accepted = parseInt(count.accepted_count);
        });

        inProgressCounts.forEach(count => {
            if (!userTaskCounts[count.user_id]) {
                userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
            }
            userTaskCounts[count.user_id].in_progress = parseInt(count.in_progress_count);
        });

        completedCounts.forEach(count => {
            if (!userTaskCounts[count.user_id]) {
                userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
            }
            userTaskCounts[count.user_id].completed = parseInt(count.completed_count);
        });

        // Add task counts to assigned users in tasks
        tasks.forEach(task => {
            task.assignedUsers.forEach(user => {
                const counts = userTaskCounts[user.id] || { accepted: 0, in_progress: 0, completed: 0 };
                user.dataValues.acceptedTasksCount = counts.accepted;
                user.dataValues.inProgressTasksCount = counts.in_progress;
                user.dataValues.completedTasksCount = counts.completed;
            });
        });

        res.json({
            success: true,
            data: tasks,
            message: 'My tasks retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching my tasks:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch my tasks'
        });
    }
};

const getUserTask = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const user_id = parseInt(req.params.user_id, 10);
        const { status } = req.query; // Optional status query parameter

        if (isNaN(user_id)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        // Check if the user is a creative user and the manager is assigned to them
        // First, get the user with their divisions
        const user = await User.findByPk(user_id, {
            include: [
                {
                    model: Division,
                    as: 'Divisions',
                    through: { attributes: [] },
                    attributes: ['id']
                }
            ],
            attributes: ['id', 'name', 'email', 'job_role_id']
        });

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Check if the user is a creative user (job_role_id = 4) or creative lead (job_role_id = 3)
        if (user.job_role_id !== 4 && user.job_role_id !== 3) {
            return res.status(403).json({ success: false, error: 'User is not a creative user or creative lead' });
        }

        // Get manager's division IDs
        const managerDivisions = await UserDivisions.findAll({
            where: { user_id: manager_id },
            attributes: ['division_id']
        });

        const managerDivisionIds = managerDivisions.map(md => md.division_id);

        // If manager has no divisions, they can't have any team members
        if (managerDivisionIds.length === 0) {
            return res.status(403).json({ success: false, error: 'Manager is not assigned to any divisions' });
        }

        // Get user's division IDs
        const userDivisionIds = user.Divisions && user.Divisions.length > 0
            ? user.Divisions.map(d => d.id)
            : [];

        // Check if manager and user share at least one common division
        const hasCommonDivision = userDivisionIds.length > 0 && managerDivisionIds.length > 0 &&
            userDivisionIds.some(divisionId =>
                managerDivisionIds.includes(divisionId)
            );

        if (!hasCommonDivision) {
            return res.status(403).json({ success: false, error: 'User is not assigned to you' });
        }

        // Build where condition for tasks
        let taskWhereCondition = {};

        // Apply status filter if provided
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());

            const validStatuses = ['pending', 'accepted', 'in_progress', 'completed'];
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));

            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }

            if (statusArray.length > 1) {
                taskWhereCondition.status = { [Op.in]: statusArray };
            } else {
                taskWhereCondition.status = statusArray[0];
            }
        }

        // Apply filters from middleware
        if (req.filters) {
            taskWhereCondition = { ...taskWhereCondition, ...req.filters };
        }

        const tasks = await TaskAssignments.findAll({
            where: { user_id: user_id },
            include: [
                {
                    model: Tasks,
                    where: taskWhereCondition,
                    include: [
                        {
                            model: RequestType,
                            attributes: ['id', 'request_type', 'description']
                        },
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'status']
                        }
                    ],
                    attributes: ['id', 'task_name', 'description', 'deadline', 'status']
                }
            ],
            attributes: ['id'],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });


        // If no tasks found, try a simpler query to check if assignments exist
        if (tasks.length === 0) {
            const simpleAssignments = await TaskAssignments.findAll({
                where: { user_id: user_id },
                attributes: ['id', 'task_id']
            });


            if (simpleAssignments.length > 0) {
                const taskIds = simpleAssignments.map(sa => sa.task_id);
                const directTasks = await Tasks.findAll({
                    where: { id: taskIds },
                    attributes: ['id', 'task_name', 'status']
                });
            }
        }

        // Format the response

        const formattedTasks = tasks.map(task => {
            // Check the actual structure of the task object

            // Based on the error, the task object might be the TaskAssignments directly
            // Let's try to access it differently
            let taskData = null;

            // Try different ways to access the task data
            if (task.Tasks) {
                // Original way
                taskData = task.Tasks;
            } else if (task.task) {
                // Alternative way
                taskData = task.task;
            } else if (task.Task) {
                // Another alternative way
                taskData = task.Task;
            } else {
                // If no task data found, this might be just the assignment
                console.error('No task data found in assignment:', task);
                return null;
            }

            return {
                id: taskData.id,
                task_name: taskData.task_name,
                description: taskData.description,
                deadline: taskData.deadline,
                status: taskData.status,
                requestType: taskData.RequestType ? {
                    id: taskData.RequestType.id,
                    request_type: taskData.RequestType.request_type,
                    description: taskData.RequestType.description
                } : null,
                taskType: taskData.TaskType ? {
                    id: taskData.TaskType.id,
                    task_type: taskData.TaskType.task_type,
                    description: taskData.TaskType.description
                } : null,
                workRequest: taskData.WorkRequests ? {
                    id: taskData.WorkRequests.id,
                    project_name: taskData.WorkRequests.project_name,
                    brand: taskData.WorkRequests.brand,
                    status: taskData.WorkRequests.status
                } : null
            };
        }).filter(task => task !== null);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email
                },
                tasks: formattedTasks
            },
            pagination: req.pagination,
            message: 'User tasks retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching user tasks:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch user tasks'
        });
    }
};

const updateTask = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const manager_id = req.user.id;
        const { task_name, deadline, user_id } = req.body;

        // Validate that at least one field is provided
        if (!task_name && !deadline && user_id === undefined) {
            return res.status(400).json({
                success: false,
                error: 'At least one of task_name, deadline, or user_id is required'
            });
        }

        // Find the task with its work request to verify manager access
        const task = await Tasks.findByPk(taskId, {
            include: [
                {
                    model: WorkRequests,
                    include: [
                        {
                            model: WorkRequestManagers,
                            where: { manager_id: manager_id },
                            required: true,
                            attributes: []
                        }
                    ]
                },
                {
                    model: TaskAssignments,
                    attributes: ['id', 'user_id']
                }
            ]
        });

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found or not assigned to you'
            });
        }

        // Build update data for task
        const taskUpdateData = {};

        if (task_name) {
            // Validate task_name
            if (typeof task_name !== 'string' || task_name.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Task name must be a non-empty string'
                });
            }
            taskUpdateData.task_name = task_name.trim();
        }

        if (deadline) {
            // Validate date format
            const dateRegex = /^\d{4}-\d{1,2}-\d{1,2}$/;
            if (!dateRegex.test(deadline)) {
                return res.status(400).json({
                    success: false,
                    error: 'Deadline must be in YYYY-MM-DD format'
                });
            }

            // Parse and validate the date
            const dateParts = deadline.split('-');
            const year = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]);
            const day = parseInt(dateParts[2]);

            if (month < 1 || month > 12 || day < 1 || day > 31) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date components in deadline'
                });
            }

            const formattedDeadline = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const testDate = new Date(formattedDeadline);

            if (isNaN(testDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date provided for deadline'
                });
            }

            taskUpdateData.deadline = formattedDeadline;
        }

        // Update task if there are updates
        if (Object.keys(taskUpdateData).length > 0) {
            await Tasks.update(taskUpdateData, { where: { id: taskId } });
        }

        // Update user assignment if user_id is provided
        if (user_id !== undefined) {
            if (user_id === null || user_id === '') {
                // Remove all assignments for this task
                await TaskAssignments.destroy({ where: { task_id: taskId } });
            } else {
                // Validate user_id
                const userIdInt = parseInt(user_id, 10);
                if (isNaN(userIdInt)) {
                    return res.status(400).json({
                        success: false,
                        error: 'user_id must be a valid integer'
                    });
                }

                // Check if user exists
                const user = await User.findByPk(userIdInt, {
                    attributes: ['id', 'name', 'account_status']
                });

                if (!user) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found'
                    });
                }

                if (user.account_status !== 'active') {
                    return res.status(400).json({
                        success: false,
                        error: 'User is not active'
                    });
                }

                // Check if assignment already exists
                const existingAssignment = await TaskAssignments.findOne({
                    where: { task_id: taskId, user_id: userIdInt }
                });

                if (existingAssignment) {
                    // Assignment already exists, no need to create new one
                } else {
                    // Remove existing assignments and create new one
                    await TaskAssignments.destroy({ where: { task_id: taskId } });
                    await TaskAssignments.create({ task_id: taskId, user_id: userIdInt });
                }
            }
        }

        // Fetch updated task with assignments
        const updatedTask = await Tasks.findByPk(taskId, {
            include: [
                {
                    model: TaskAssignments,
                    include: [
                        {
                            model: User,
                            attributes: ['id', 'name', 'email']
                        }
                    ]
                }
            ]
        });

        res.json({
            success: true,
            data: updatedTask,
            message: 'Task updated successfully'
        });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to update task'
        });
    }
};

module.exports = {
    getAssignedWorkRequests,
    getAssignedWorkRequestById,
    acceptWorkRequest,
    deferWorkRequest,
    updateWorkRequestProject,
    deleteWorkRequest,
    deleteTask,
    getMyTasks,
    getAssignableUsers,
    getTaskTypesByWorkRequest,
    createTask,
    getTasksByWorkRequestId,
    getTaskAnalytics,
    getMyTeam,
    assignTasksToUsers,
    getAssignedRequestsWithStatus,
    getUserTask,
    updateTask
};