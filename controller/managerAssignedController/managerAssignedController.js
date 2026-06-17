const { Op, col, literal } = require('sequelize');
const fs = require('fs');
const path = require('path');

const CrudService = require('../../services/crudService');
const {
    WorkRequests,
    WorkRequestDeferrals,
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
    TaskDocuments,
    IssueDocuments,
    IssueUserAssignments,
    IssueAssignments,
    IssueAssignmentTypes,
    IssueRegister,
    TaskReviewHistory
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
            if (workRequest.status !== 'accepted' && workRequest.status !== 'assigned' && workRequest.status !== 'in_progress' && workRequest.status !== 'completed') {
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
        const { status, review, review_stages, user_id, sort, sort_by } = req.query;
        const allowedSortFields = {
            id: 'id',
            project_name: 'project_name',
            brand: 'brand',
            priority: 'priority',
            status: 'status',
            requested_at: 'requested_at',
            created_at: 'created_at',
            deadline: 'deadline',
            user_name: [User, 'name'],
            email: [User, 'email']
        };
        const sortDirection = String(sort || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const sortField = allowedSortFields[sort_by] || 'requested_at';
        const order = [['notification_alert', 'DESC']];

        if (Array.isArray(sortField)) {
            order.push([...sortField, sortDirection]);
        } else if (sortField === 'deadline') {
            order.push([literal('(SELECT MAX(`deadline`) FROM `tasks` WHERE `tasks`.`work_request_id` = `WorkRequests`.`id`)'), sortDirection]);
        } else {
            order.push([sortField, sortDirection]);
        }

        let where = { status: { [Op.ne]: 'draft' } };

        // Handle multiple comma-separated status values
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());

            // Validate status values
            const validStatuses = ['assigned', 'pending', 'accepted', 'in_progress', 'completed', 'rejected', 'deferred'];
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));

            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }

            // If multiple statuses, use OR condition
            if (statusArray.length > 1) {
                where.status = { [Op.in]: statusArray };
            } else {
                // Single status
                where.status = statusArray[0];
            }
        }

        // Handle multiple comma-separated review values
        if (review) {
            const reviewArray = review.split(',').map(r => r.trim());

            // Validate review values
            const validReviews = ['pending', 'approved', 'change_request'];
            const invalidReviews = reviewArray.filter(r => !validReviews.includes(r));

            if (invalidReviews.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid review values: ${invalidReviews.join(', ')}. Valid values are: ${validReviews.join(', ')}`
                });
            }

            // If multiple reviews, use OR condition
            if (reviewArray.length > 1) {
                where.review = { [Op.in]: reviewArray };
            } else {
                // Single review
                where.review = reviewArray[0];
            }
        }

        // Handle multiple comma-separated review_stages values
        if (review_stages) {
            const reviewStageArray = review_stages.split(',').map(rs => rs.trim());

            // Validate review_stage values
            const validReviewStages = ['not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'];
            const invalidReviewStages = reviewStageArray.filter(rs => !validReviewStages.includes(rs));

            if (invalidReviewStages.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid review_stage values: ${invalidReviewStages.join(', ')}. Valid values are: ${validReviewStages.join(', ')}`
                });
            }

            // If multiple review_stages, use OR condition
            if (reviewStageArray.length > 1) {
                where.review_stage = { [Op.in]: reviewStageArray };
            } else {
                // Single review_stage
                where.review_stage = reviewStageArray[0];
            }
        }

        // Handle user_id filter - filter by exact user ID
        if (user_id) {
            const userIdInt = parseInt(user_id, 10);
            if (isNaN(userIdInt)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid user_id. Must be a valid integer'
                });
            }
            where.user_id = userIdInt;
        }

        // Apply filters from middleware, but exclude user_name/username as they may be handled via search
        if (req.filters) {
            const { user_name, username, ...otherFilters } = req.filters;
            where = { ...where, ...otherFilters };
        }

        // Apply search - handle user_name/username specially since it's on the associated User model
        if (req.search.term && req.search.fields.length > 0) {
            const searchFields = req.search.fields;
            // Check for user_name or username in search fields
            const hasUserNameSearch = searchFields.includes('user_name') || searchFields.includes('username');

            // Remove user_name and username from search fields for the direct query
            const directSearchFields = searchFields.filter(field => field !== 'user_name' && field !== 'username');

            // Build OR condition array combining direct fields and user_id (if applicable)
            const orConditions = [];

            // Add direct field conditions (project_name, brand, etc.)
            if (directSearchFields.length > 0) {
                directSearchFields.forEach(field => {
                    orConditions.push({
                        [field]: { [Op.like]: `%${req.search.term}%` }
                    });
                });
            }

            // If user_name/username search is requested, add user_id IN condition
            if (hasUserNameSearch) {
                // Find users matching the name (case-insensitive search)
                const matchingUsers = await User.findAll({
                    where: {
                        name: { [Op.like]: `%${req.search.term}%` }
                    },
                    attributes: ['id']
                });

                if (matchingUsers.length > 0) {
                    const userIds = matchingUsers.map(u => u.id);
                    orConditions.push({ user_id: { [Op.in]: userIds } });
                }
                // If no matching users found, we simply skip adding user_id condition.
                // The search will still match on other direct fields if they match.
            }

            // Apply the combined OR condition if we have any conditions
            if (orConditions.length > 0) {
                where[Op.or] = orConditions;
            }
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
                    attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'created_at', 'updated_at'],
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
                                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version', 'review']
                                }
                            ]
                        },
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
                            include: [
                                {
                                    model: IssueAssignmentTypes,
                                    as: 'issueTypeLinks',
                                    include: [
                                        {
                                            model: IssueRegister,
                                            as: 'issueRegister'
                                        }
                                    ]
                                },
                                {
                                    model: User,
                                    as: 'requester',
                                    attributes: ['id', 'name', 'email']
                                }
                            ]
                        }
                    ],
                    required: false
                }
            ],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order
        });

        if (result.success) {
            const managerId = req.user.id;

            // Calculate total notification count: count of work requests with notification_alert = 1
            const totalNotificationAlert = result.data.filter(wr => wr.notification_alert == 1).length;

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

            res.json({ success: true, data: result.data, pagination: req.pagination, notification_alert_count: totalNotificationAlert });
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
                        attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'created_at', 'updated_at', 'shared_with_client_at'],
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
                                        attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review']
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
                            },
                            {
                                model: TaskReviewHistory,
                                as: 'reviewHistory',
                                attributes: ['id', 'reviewer_id', 'reviewer_type', 'action', 'comments', 'previous_stage', 'new_stage', 'created_at'],
                                include: [
                                    {
                                        model: User,
                                        as: 'reviewer',
                                        attributes: ['id', 'name', 'email']
                                    }
                                ]
                            },
                            {
                                model: IssueAssignments,
                                as: 'issueAssignments',
                                include: [
                                    {
                                        model: IssueAssignmentTypes,
                                        as: 'issueTypeLinks',
                                        include: [
                                            {
                                                model: IssueRegister,
                                                as: 'issueRegister'
                                            }
                                        ]
                                    },
                                    {
                                        model: User,
                                        as: 'requester',
                                        attributes: ['id', 'name', 'email']
                                    },
                                    {
                                        model: IssueUserAssignments,
                                        as: 'userAssignments',
                                        attributes: ['id', 'user_id', 'created_at', 'updated_at'],
                                        include: [
                                            {
                                                model: User,
                                                as: 'user',
                                                attributes: ['id', 'name', 'email']
                                            },
                                            {
                                                model: IssueDocuments,
                                                as: 'documents',
                                                attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review']
                                            }
                                        ]
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
                            attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'created_at', 'updated_at'],
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
                                            attributes: ['id', 'document_name', 'document_path', 'document_size', 'uploaded_at', 'status', 'version', 'review']
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
                                },
                                {
                                    model: TaskReviewHistory,
                                    as: 'reviewHistory',
                                    attributes: ['id', 'reviewer_id', 'reviewer_type', 'action', 'comments', 'previous_stage', 'new_stage', 'created_at'],
                                    include: [
                                        {
                                            model: User,
                                            as: 'reviewer',
                                            attributes: ['id', 'name', 'email']
                                        }
                                    ]
                                },
                                {
                                    model: IssueAssignments,
                                    as: 'issueAssignments',
                                    include: [
                                        {
                                            model: IssueAssignmentTypes,
                                            as: 'issueTypeLinks',
                                            include: [
                                                {
                                                    model: IssueRegister,
                                                    as: 'issueRegister'
                                                }
                                            ]
                                        },
                                        {
                                            model: User,
                                            as: 'requester',
                                            attributes: ['id', 'name', 'email']
                                        },
                                        {
                                            model: IssueUserAssignments,
                                            as: 'userAssignments',
                                            attributes: ['id', 'user_id', 'created_at', 'updated_at'],
                                            include: [
                                                {
                                                    model: User,
                                                    as: 'user',
                                                    attributes: ['id', 'name', 'email']
                                                },
                                                {
                                                    model: IssueDocuments,
                                                    as: 'documents',
                                                    attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review']
                                                }
                                            ]
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
            // Get pending tasks count (status: pending)
            const pendingCounts = await TaskAssignments.findAll({
                where: {
                    user_id: { [Op.in]: uniqueUserIds }
                },
                include: [
                    {
                        model: Tasks,
                        where: { status: 'pending', intimate_team: 1 },
                        attributes: []
                    }
                ],
                attributes: [
                    'user_id',
                    [Tasks.sequelize.fn('COUNT', Tasks.sequelize.col('task_id')), 'pending_count']
                ],
                group: ['user_id'],
                raw: true
            });

            // Get accepted tasks count (status: accepted)
            const acceptedCounts = await TaskAssignments.findAll({
                where: {
                    user_id: { [Op.in]: uniqueUserIds }
                },
                include: [
                    {
                        model: Tasks,
                        where: { status: 'accepted', intimate_team: 1 },
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
                        where: { status: 'in_progress', intimate_team: 1 },
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

            // Get issue counts
            const issuePendingCounts = await IssueUserAssignments.findAll({
                where: { user_id: { [Op.in]: uniqueUserIds } },
                include: [{
                    model: IssueAssignments,
                    as: 'issueAssignment',
                    where: { status: 'm_pending', intimate_team: 1 },
                    attributes: []
                }],
                attributes: ['user_id', [IssueAssignments.sequelize.fn('COUNT', IssueAssignments.sequelize.col('issue_assignment_id')), 'pending_count']],
                group: ['user_id'],
                raw: true
            });

            const issueAcceptedCounts = await IssueUserAssignments.findAll({
                where: { user_id: { [Op.in]: uniqueUserIds } },
                include: [{
                    model: IssueAssignments,
                    as: 'issueAssignment',
                    where: { status: 'm_accepted', intimate_team: 1 },
                    attributes: []
                }],
                attributes: ['user_id', [IssueAssignments.sequelize.fn('COUNT', IssueAssignments.sequelize.col('issue_assignment_id')), 'accepted_count']],
                group: ['user_id'],
                raw: true
            });

            const issueInProgressCounts = await IssueUserAssignments.findAll({
                where: { user_id: { [Op.in]: uniqueUserIds } },
                include: [{
                    model: IssueAssignments,
                    as: 'issueAssignment',
                    where: { status: 'in_progress', intimate_team: 1 },
                    attributes: []
                }],
                attributes: ['user_id', [IssueAssignments.sequelize.fn('COUNT', IssueAssignments.sequelize.col('issue_assignment_id')), 'in_progress_count']],
                group: ['user_id'],
                raw: true
            });

            // Organize counts
            pendingCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].pending = parseInt(count.pending_count);
            });

            acceptedCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].accepted = parseInt(count.accepted_count);
            });

            inProgressCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].in_progress = parseInt(count.in_progress_count);
            });

            issuePendingCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].issuePending = parseInt(count.pending_count);
            });

            issueAcceptedCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].issueAccepted = parseInt(count.accepted_count);
            });

            issueInProgressCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                }
                userTaskCounts[count.user_id].issueInProgress = parseInt(count.in_progress_count);
            });
        }

        // Add task counts to assigned users in the response
        if (workRequest.Tasks && workRequest.Tasks.length > 0) {
            for (const task of workRequest.Tasks) {
                if (task.TaskAssignments && task.TaskAssignments.length > 0) {
                    for (const assignment of task.TaskAssignments) {
                        if (assignment.User && assignment.User.id) {
                            const counts = userTaskCounts[assignment.User.id] || { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                            assignment.User.dataValues.pendingTasksCount = counts.pending;
                            assignment.User.dataValues.acceptedTasksCount = counts.accepted;
                            assignment.User.dataValues.inProgressTasksCount = counts.in_progress;
                            assignment.User.dataValues.totalActiveTasks = counts.pending + counts.accepted + counts.in_progress;
                            assignment.User.dataValues.issuePendingCount = counts.issuePending;
                            assignment.User.dataValues.issueAcceptedCount = counts.issueAccepted;
                            assignment.User.dataValues.issueInProgressCount = counts.issueInProgress;
                            assignment.User.dataValues.totalActiveIssues = counts.issuePending + counts.issueAccepted + counts.issueInProgress;
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
                                const counts = userTaskCounts[assignment.User.id] || { pending: 0, accepted: 0, in_progress: 0, issuePending: 0, issueAccepted: 0, issueInProgress: 0 };
                                taskUsers.push({
                                    ...userDetails.toJSON(),
                                    pendingTasksCount: counts.pending,
                                    acceptedTasksCount: counts.accepted,
                                    inProgressTasksCount: counts.in_progress,
                                    totalActiveTasks: counts.pending + counts.accepted + counts.in_progress,
                                    issuePendingCount: counts.issuePending,
                                    issueAcceptedCount: counts.issueAccepted,
                                    issueInProgressCount: counts.issueInProgress,
                                    totalActiveIssues: counts.issuePending + counts.issueAccepted + counts.issueInProgress
                                });
                            }
                        }
                    }
                }
            }
        }

        // Add task users to the work request response
        workRequest.dataValues.taskUsers = taskUsers;

        // Reset notification_alert to 0 for all tasks in this work request where it is 1
        if (workRequest.Tasks && workRequest.Tasks.length > 0) {
            const taskIds = workRequest.Tasks.map(t => t.id);
            await Tasks.update(
                { notification_alert: 0 },
                { where: { id: { [Op.in]: taskIds }, notification_alert: 1 } }
            );
        }

        // Reset notification_alert to 0 for the work request
        await WorkRequests.update(
            { notification_alert: 0 },
            { where: { id: id, notification_alert: 1 } }
        );

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

        if (reason === 'insufficient_details' && !message) {
            return res.status(400).json({ success: false, error: 'message is required for insufficient_details reason' });
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

        if (reason === 'insufficient_details') {
            // Update work request status and remarks to insufficient_details
            const updateResult = await workRequestService.updateById(id, {
                // status: 'deferred',
                remarks: 'insufficient_details'
            });

            if (!updateResult.success) {
                return res.status(500).json({ success: false, error: 'Failed to update work request' });
            }

            await WorkRequestDeferrals.create({
                work_request_id: id,
                manager_id,
                reason,
                message,
                old_request_type_id: workRequest.request_type_id,
                old_project_type_id: workRequest.project_id,
                deferred_at: new Date()
            });

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
                request_id: workRequest.id,
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
                    attributes: ['id', 'name', 'email', 'job_role_id']
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

            await WorkRequestDeferrals.create({
                work_request_id: id,
                manager_id,
                reason,
                message: message || null,
                old_request_type_id: workRequest.request_type_id,
                new_request_type_id: newRequestTypeId,
                old_project_type_id: workRequest.project_id,
                new_project_type_id: newProjectTypeId,
                deferred_at: new Date()
            });

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

        // If work request is completed, automatically change status back to accepted
        if (workRequest.status === 'completed') {
            await workRequestService.updateById(work_request_id, { status: 'accepted' });
            // Refresh workRequest object after update
            const updatedWorkRequest = await workRequestService.getById(work_request_id);
            if (updatedWorkRequest.success) {
                Object.assign(workRequest, updatedWorkRequest.data);
            }
        }

        // Check if work request is accepted
        if (workRequest.status !== 'accepted' && workRequest.status !== 'assigned' && workRequest.status !== 'in_progress') {
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
            status: 'pending',
            notification_alert: 1,
            intimate_team: 1
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

        // Send email notification to assigned users
        const assignedUsers = await User.findAll({
            where: { id: { [Op.in]: assigned_to_ids } },
            attributes: ['id', 'name', 'email']
        });

        if (assignedUsers.length > 0) {
            const emailPromises = assignedUsers.map(user => {
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
                    tasks: [{
                        id: taskResult.id,
                        task_name: taskResult.task_name,
                        description: taskResult.description,
                        deadline: taskResult.deadline
                    }],
                    frontend_url: process.env.FRONTEND_URL
                });

                const mailOptions = {
                    to: user.email,
                    subject: 'Tasks Assigned - D-Map',
                    html
                };

                return sendMail(mailOptions);
            });

            await Promise.all(emailPromises);
        }

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
                            attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version', 'review']
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
                },
                {
                    model: IssueAssignments,
                    as: 'issueAssignments',
                    include: [
                        {
                            model: IssueAssignmentTypes,
                            as: 'issueTypeLinks',
                            include: [
                                {
                                    model: IssueRegister,
                                    as: 'issueRegister',
                                    attributes: ['id', 'change_issue_type', 'description']
                                }
                            ]
                        }
                    ]
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
            })),
            issueAssignments: task.issueAssignments ? task.issueAssignments.map(issue => ({
                id: issue.id,
                version: issue.version,
                description: issue.description,
                status: issue.status,
                review: issue.review,
                intimate_client: issue.intimate_client,
                issueTypes: issue.issueTypeLinks ? issue.issueTypeLinks.map(issueType => ({
                    id: issueType.id,
                    issue_register_id: issueType.issue_register_id,
                    issueRegister: issueType.issueRegister ? {
                        id: issueType.issueRegister.id,
                        change_issue_type: issueType.issueRegister.change_issue_type,
                        description: issueType.issueRegister.description
                    } : null
                })) : []
            })) : []
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

        // Get unique users by user id
        const uniqueUserMap = new Map();
        assignedUsers.forEach(ta => {
            if (ta.User && !uniqueUserMap.has(ta.User.id)) {
                uniqueUserMap.set(ta.User.id, ta.User);
            }
        });

        const teamMembers = Array.from(uniqueUserMap.values()).map(user => ({
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
            totalUsers: teamMembers.length,
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
                            // id: { [Op.ne]: manager_id },
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

                // Count active tasks (accepted or in_progress) assigned to this user where intimate_team = 1
                const taskCount = await TaskAssignments.count({
                    where: { user_id: user.id },
                    include: [
                        {
                            model: Tasks,
                            where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] }, intimate_team: 1 },
                            attributes: []
                        }
                    ]
                });

                // Count active issues (m_accepted, u_accepted, in_progress) assigned to this user where intimate_team = 1
                const issueCount = await IssueUserAssignments.count({
                    where: { user_id: user.id },
                    include: [
                        {
                            model: IssueAssignments,
                            as: 'issueAssignment',
                            where: { status: { [Op.in]: ['m_accepted', 'u_accepted', 'in_progress'] }, intimate_team: 1 },
                            attributes: []
                        }
                    ]
                });

                divisionTeam.teamMembers.push({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    jobRole: user.job_role_id,
                    taskCount: taskCount,
                    issueCount: issueCount
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
                attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'created_at', 'updated_at'],
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
                },
                {
                    model: IssueAssignments,
                    as: 'issueAssignments',
                    include: [
                        {
                            model: IssueAssignmentTypes,
                            as: 'issueTypeLinks',
                            include: [
                                {
                                    model: IssueRegister,
                                    as: 'issueRegister',
                                    attributes: ['id', 'change_issue_type', 'description']
                                }
                            ]
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
        if (user.job_role_id !== 4 && user.job_role_id !== 3 && user.job_role_id !== 2 && user.job_role_id !== 1) {
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

        // Apply status filter from query parameter if provided
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

        // Apply filters from middleware (only if explicitly provided)
        if (req.filters && Object.keys(req.filters).length > 0) {
            // Handle status from req.filters if provided
            if (req.filters.status) {
                let statusFilter = req.filters.status;
                if (typeof statusFilter === 'string') {
                    statusFilter = statusFilter.split(',').map(s => s.trim());
                } else if (!Array.isArray(statusFilter)) {
                    statusFilter = [statusFilter];
                }
                if (statusFilter.length > 0) {
                    taskWhereCondition.status = { [Op.in]: statusFilter };
                }
            }
            // Apply other filters
            const { status: _, ...otherFilters } = req.filters;
            taskWhereCondition = { ...taskWhereCondition, ...otherFilters };
        }

        // Only add intimate_team = 1 filter when status filter is applied
        // This ensures all tasks are shown by default, and filtered when status is specified
        const hasStatusFilter = status || (req.filters && req.filters.status);
        if (hasStatusFilter) {
            // Only apply intimate_team filter when status is explicitly provided
            if (!taskWhereCondition.status ||
                (taskWhereCondition.status !== 'completed' &&
                    !(taskWhereCondition.status && taskWhereCondition.status[Op.in] && taskWhereCondition.status[Op.in].includes('completed')))) {
                taskWhereCondition.intimate_team = 1;
            }
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
                        },
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
                            // Don't filter by intimate_team by default - show all issues
                            required: false,
                            include: [
                                {
                                    model: IssueAssignmentTypes,
                                    as: 'issueTypeLinks',
                                    include: [
                                        {
                                            model: IssueRegister,
                                            as: 'issueRegister'
                                        }
                                    ]
                                },
                                {
                                    model: User,
                                    as: 'requester',
                                    attributes: ['id', 'name', 'email']
                                }
                            ]
                        }
                    ],
                    attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'created_at', 'updated_at']
                }
            ],
            attributes: ['id'],
            limit: req.pagination.limit,
            offset: req.pagination.offset
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
                } : null,
                issues: taskData.issueAssignments && taskData.issueAssignments.length > 0
                    ? taskData.issueAssignments.map(issue => ({
                        id: issue.id,
                        issue_id: issue.issue_id,
                        version: issue.version,
                        description: issue.description,
                        status: issue.status,
                        deadline: issue.deadline,
                        requester: issue.requester ? {
                            id: issue.requester.id,
                            name: issue.requester.name,
                            email: issue.requester.email
                        } : null,
                        issue_types: issue.issueTypeLinks && issue.issueTypeLinks.length > 0
                            ? issue.issueTypeLinks.map(itl => ({
                                id: itl.id,
                                change_issue_type: itl.issueRegister?.change_issue_type,
                                description: itl.issueRegister?.description
                            }))
                            : []
                    }))
                    : []
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
                },
                {
                    model: IssueAssignments,
                    as: 'issueAssignments',
                    include: [
                        {
                            model: IssueAssignmentTypes,
                            as: 'issueTypeLinks',
                            include: [
                                {
                                    model: IssueRegister,
                                    as: 'issueRegister',
                                    attributes: ['id', 'change_issue_type', 'description']
                                }
                            ]
                        }
                    ]
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
        let userChanged = false;
        let previousUserId = null;

        if (user_id !== undefined) {
            // Get current user_id before any changes
            if (task.TaskAssignments && task.TaskAssignments.length > 0) {
                previousUserId = task.TaskAssignments[0].user_id;
            }

            if (user_id === null || user_id === '') {
                // Remove all assignments for this task
                await TaskAssignments.destroy({ where: { task_id: taskId } });
                if (previousUserId !== null) {
                    userChanged = true;
                }
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

                // Check if user_id is different from previous
                if (previousUserId !== userIdInt) {
                    userChanged = true;
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

        // If user was changed, update task status to pending
        if (userChanged) {
            await Tasks.update({ status: 'pending' }, { where: { id: taskId } });
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

const reviewTaskDocument = async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        if (isNaN(documentId)) {
            return res.status(400).json({ success: false, error: 'Invalid document ID' });
        }

        const manager_id = req.user.id;
        const { review } = req.body;

        // Validate review value
        if (!review || !['approved', 'change_request'].includes(review)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid review value. Allowed values: approved, change_request'
            });
        }

        // Find the document with its task assignment and verify manager access
        const document = await TaskDocuments.findByPk(documentId, {
            include: [
                {
                    model: TaskAssignments,
                    include: [
                        {
                            model: Tasks,
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
                        }
                    ]
                }
            ]
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                error: 'Document not found or not assigned to you'
            });
        }

        // Update the review status
        await TaskDocuments.update({ review }, { where: { id: documentId } });

        // Fetch updated document
        const updatedDocument = await TaskDocuments.findByPk(documentId, {
            attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version', 'review']
        });

        res.json({
            success: true,
            data: updatedDocument,
            message: `Document review status updated to ${review}`
        });
    } catch (error) {
        console.error('Error reviewing task document:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to review task document'
        });
    }
};

const reviewIssueDocument = async (req, res) => {
    try {
        const documentId = parseInt(req.params.documentId, 10);
        if (isNaN(documentId)) {
            return res.status(400).json({ success: false, error: 'Invalid document ID' });
        }

        const manager_id = req.user.id;
        const { review } = req.body;

        // Validate review value
        if (!review || !['approved', 'change_request'].includes(review)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid review value. Allowed values: approved, change_request'
            });
        }

        // Find the document with its issue user assignment and verify manager access
        // IssueDocuments -> IssueUserAssignments -> IssueAssignments -> Tasks -> WorkRequests -> WorkRequestManagers
        const document = await IssueDocuments.findByPk(documentId, {
            include: [
                {
                    model: IssueUserAssignments,
                    as: 'issueUserAssignment',
                    include: [
                        {
                            model: IssueAssignments,
                            as: 'issueAssignment',
                            include: [
                                {
                                    model: Tasks,
                                    as: 'task',
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
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                error: 'Issue document not found or not assigned to you'
            });
        }

        // Update the review status
        await IssueDocuments.update({ review }, { where: { id: documentId } });

        // Fetch updated document
        const updatedDocument = await IssueDocuments.findByPk(documentId, {
            attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review']
        });

        res.json({
            success: true,
            data: updatedDocument,
            message: `Issue document review status updated to ${review}`
        });
    } catch (error) {
        console.error('Error reviewing issue document:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to review issue document'
        });
    }
};

const reviewTask = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { task_id, issue_id, action, comments } = req.body;

        // Validate action value
        if (!action || !['approved', 'change_request'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid action value. Allowed values: approved, change_request'
            });
        }

        // Check if either task_id or issue_id is provided
        if (!task_id && !issue_id) {
            return res.status(400).json({
                success: false,
                error: 'Either task_id or issue_id is required'
            });
        }

        // If task_id is provided, handle task review
        if (task_id) {
            const taskId = parseInt(task_id, 10);
            if (isNaN(taskId)) {
                return res.status(400).json({ success: false, error: 'Invalid task ID' });
            }

            // Find the task with its work request and verify manager access
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
                            },
                            {
                                model: User,
                                as: 'users',
                                attributes: ['id', 'name', 'email']
                            }
                        ]
                    },
                    {
                        model: User,
                        as: 'assignedUsers',
                        attributes: ['id', 'name', 'email'],
                        through: { attributes: [] }
                    },
                    {
                        model: IssueAssignments,
                        as: 'issueAssignments',
                        include: [
                            {
                                model: IssueAssignmentTypes,
                                as: 'issueTypeLinks',
                                include: [
                                    {
                                        model: IssueRegister,
                                        as: 'issueRegister',
                                        attributes: ['id', 'change_issue_type', 'description']
                                    }
                                ]
                            }
                        ]
                    }
                ]
            });

            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Task not found or not assigned to you'
                });
            }

            // Validation: Task must be completed for manager to review
            if (task.status !== 'completed') {
                return res.status(400).json({
                    success: false,
                    error: 'Task must be completed before review. Current status: ' + task.status
                });
            }

            // Validation: Check if manager has already reviewed (review_stage should not be past manager_review)
            const currentReviewStage = task.review_stage || 'not_started';
            const stagesAfterManagerReview = ['pm_review', 'change_requested', 'final_approved'];

            if (stagesAfterManagerReview.includes(currentReviewStage)) {
                return res.status(400).json({
                    success: false,
                    error: 'Manager has already reviewed this task. Current review stage: ' + currentReviewStage + '. Waiting for next level review.'
                });
            }

            // Store previous stage for history
            const previousStage = currentReviewStage;
            let newStatus = task.status;
            let newReview = task.review; // Track review field changes
            let newStage = currentReviewStage; // For history tracking

            // Update the task
            const updateData = {};

            // Determine what to update based on action
            if (action === 'approved') {
                // Manager approved, move to pm_review stage (next level)
                updateData.review_stage = 'pm_review';
                updateData.review = 'pending'; // Reset to pending for next level review (PM)
                newStage = 'pm_review';
            } else if (action === 'change_request') {
                // Change request - only update review field, keep review_stage as is
                // updateData.review = 'change_request';
                updateData.review = 'pending';
                // If task is completed, change status back to in_progress
                if (task.status === 'completed') {
                    newStatus = 'in_progress';
                    updateData.status = newStatus;
                }
            }

            // updateData.notification_alert = 0;
            await Tasks.update(updateData, { where: { id: taskId } });

            // If action is change_request, delete all related task documents
            if (action === 'change_request') {
                // Find all task assignments for this task
                const taskAssignments = await TaskAssignments.findAll({
                    where: { task_id: taskId }
                });

                const taskAssignmentIds = taskAssignments.map(ta => ta.id);

                // Delete all documents for these task assignments
                if (taskAssignmentIds.length > 0) {
                    await TaskDocuments.destroy({
                        where: { task_assignment_id: { [Op.in]: taskAssignmentIds } }
                    });
                }
            }

            // Create review history entry
            await TaskReviewHistory.create({
                task_id: taskId,
                reviewer_id: manager_id,
                reviewer_type: 'manager',
                action: action,
                comments: comments || null,
                previous_stage: previousStage,
                new_stage: newStage
            });

            // Send email to assigned creative users
            if (task.assignedUsers && task.assignedUsers.length > 0) {
                const manager = req.user;
                const workRequest = task.WorkRequest;

                for (const user of task.assignedUsers) {
                    const html = renderTemplate('taskReviewNotification', {
                        user_name: user.name,
                        manager_name: manager.name,
                        manager_email: manager.email,
                        task_name: task.task_name,
                        project_name: workRequest?.project_name || 'N/A',
                        brand: workRequest?.brand || 'N/A',
                        action: action === 'approved' ? 'Approved' : 'Change Requested',
                        comments: comments || 'No comments provided',
                        review_date: new Date().toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        }),
                        frontend_url: process.env.FRONTEND_URL
                    });

                    await sendMail({
                        to: user.email,
                        subject: `Task Review Update - ${action === 'approved' ? 'Approved' : 'Change Requested'}`,
                        html
                    });
                }
            }

            // Fetch updated task
            const updatedTask = await Tasks.findByPk(taskId, {
                attributes: ['id', 'task_name', 'status', 'review_stage', 'deadline'],
                include: [
                    {
                        model: User,
                        as: 'assignedUsers',
                        attributes: ['id', 'name', 'email'],
                        through: { attributes: [] }
                    }
                ]
            });

            return res.json({
                success: true,
                data: {
                    type: 'task',
                    task: updatedTask,
                    reviewAction: {
                        action,
                        previousStage,
                        newStage,
                        statusChanged: newStatus !== task.status,
                        previousStatus: task.status,
                        newStatus
                    }
                },
                message: `Task review ${action === 'approved' ? 'approved' : 'change requested'} successfully`
            });
        }

        // If issue_id is provided, handle issue review
        if (issue_id) {
            const issueId = parseInt(issue_id, 10);
            if (isNaN(issueId)) {
                return res.status(400).json({ success: false, error: 'Invalid issue ID' });
            }

            // Find the issue with its task and work request and verify manager access
            const issueAssignment = await IssueAssignments.findByPk(issueId, {
                include: [
                    {
                        model: Tasks,
                        as: 'task',
                        attributes: ['id', 'task_name', 'work_request_id', 'status', 'review_stage'],
                        include: [
                            {
                                model: WorkRequests,
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
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        model: IssueUserAssignments,
                        as: 'userAssignments',
                        include: [
                            {
                                model: User,
                                as: 'user',
                                attributes: ['id', 'name', 'email']
                            }
                        ]
                    },
                    {
                        model: IssueAssignmentTypes,
                        as: 'issueTypeLinks',
                        include: [
                            {
                                model: IssueRegister,
                                as: 'issueRegister',
                                attributes: ['id', 'change_issue_type', 'description']
                            }
                        ]
                    },
                    {
                        model: User,
                        as: 'requester',
                        attributes: ['id', 'name', 'email']
                    }
                ]
            });

            if (!issueAssignment) {
                return res.status(404).json({
                    success: false,
                    error: 'Issue not found or not assigned to you'
                });
            }

            // Validation: Issue must be completed for manager to review
            if (issueAssignment.status !== 'completed') {
                return res.status(400).json({
                    success: false,
                    error: 'Issue must be completed before review. Current status: ' + issueAssignment.status
                });
            }

            // Validation: Check if manager has already reviewed (review_stage should not be past manager_review)
            const currentReviewStage = issueAssignment.review_stage || 'not_started';
            const stagesAfterManagerReview = ['pm_review', 'change_requested', 'final_approved'];

            if (stagesAfterManagerReview.includes(currentReviewStage)) {
                return res.status(400).json({
                    success: false,
                    error: 'Manager has already reviewed this issue. Current review stage: ' + currentReviewStage + '. Waiting for next level review.'
                });
            }

            // Store previous stage for history
            const previousStage = currentReviewStage;
            let newStatus = issueAssignment.status;
            let newReview = issueAssignment.review;
            let newStage = currentReviewStage;

            // Update the issue
            const updateData = {};

            // Determine what to update based on action
            if (action === 'approved') {
                // Manager approved, move to pm_review stage (next level)
                updateData.review_stage = 'pm_review';
                updateData.review = 'pending'; // Reset to pending for next level review (PM)
                newStage = 'pm_review';
            } else if (action === 'change_request') {
                // Change request - only update review field, keep review_stage as is
                updateData.review = 'change_request';
                // If issue is completed, change status back to in_progress
                if (issueAssignment.status === 'completed') {
                    newStatus = 'in_progress';
                    updateData.status = newStatus;
                }
            }

            updateData.notification_alert = 0;
            await IssueAssignments.update(updateData, { where: { id: issueId } });

            // If action is change_request, delete all related issue documents
            if (action === 'change_request') {
                // Find all issue user assignments for this issue
                const issueUserAssignments = await IssueUserAssignments.findAll({
                    where: { issue_assignment_id: issueId }
                });

                const issueUserAssignmentIds = issueUserAssignments.map(iua => iua.id);

                // Delete all documents for these issue user assignments
                if (issueUserAssignmentIds.length > 0) {
                    await IssueDocuments.destroy({
                        where: { issue_user_assignment_id: { [Op.in]: issueUserAssignmentIds } }
                    });
                }
            }

            // Create review history entry for issue (using task_id)
            if (issueAssignment.task_id) {
                await TaskReviewHistory.create({
                    task_id: issueAssignment.task_id,
                    reviewer_id: manager_id,
                    reviewer_type: 'manager',
                    action: action,
                    comments: comments || null,
                    previous_stage: previousStage,
                    new_stage: newStage
                });
            }

            // Send email to assigned users about the review
            if (issueAssignment.userAssignments && issueAssignment.userAssignments.length > 0) {
                const manager = req.user;
                const task = issueAssignment.task;
                const workRequest = task ? task.WorkRequest : null;

                for (const userAssignment of issueAssignment.userAssignments) {
                    const user = userAssignment.User;
                    if (user && user.email) {
                        const html = renderTemplate('taskReviewNotification', {
                            user_name: user.name,
                            manager_name: manager.name,
                            manager_email: manager.email,
                            task_name: issueAssignment.version ? `Issue ${issueAssignment.version}` : 'Issue',
                            project_name: workRequest?.project_name || 'N/A',
                            brand: workRequest?.brand || 'N/A',
                            action: action === 'approved' ? 'Approved' : 'Change Requested',
                            comments: comments || 'No comments provided',
                            review_date: new Date().toLocaleDateString('en-IN', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            }),
                            frontend_url: process.env.FRONTEND_URL
                        });

                        await sendMail({
                            to: user.email,
                            subject: `Issue Review Update - ${action === 'approved' ? 'Approved' : 'Change Requested'}`,
                            html
                        });
                    }
                }
            }

            // Fetch updated issue
            const updatedIssue = await IssueAssignments.findByPk(issueId, {
                attributes: ['id', 'issue_id', 'version', 'status', 'review_stage', 'deadline', 'description'],
                include: [
                    {
                        model: IssueUserAssignments,
                        as: 'userAssignments',
                        include: [
                            {
                                model: User,
                                as: 'user',
                                attributes: ['id', 'name', 'email']
                            }
                        ]
                    }
                ]
            });

            return res.json({
                success: true,
                data: {
                    type: 'issue',
                    issue: updatedIssue,
                    reviewAction: {
                        action,
                        previousStage,
                        newStage,
                        statusChanged: newStatus !== issueAssignment.status,
                        previousStatus: issueAssignment.status,
                        newStatus
                    }
                },
                message: `Issue review ${action === 'approved' ? 'approved' : 'change requested'} successfully`
            });
        }
    } catch (error) {
        console.error('Error reviewing:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to review'
        });
    }
};

// Share task or issue for client review (PM Review stage)
const shareForClientReview = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { work_request_id, task_ids, issue_ids, task_document_ids, issue_document_ids } = req.body;

        // Check if either task_ids or issue_ids is provided
        if ((!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) &&
            (!issue_ids || !Array.isArray(issue_ids) || issue_ids.length === 0)) {
            return res.status(400).json({
                success: false,
                error: 'Either task_ids (array) or issue_ids (array) is required'
            });
        }

        if (!work_request_id) {
            return res.status(400).json({
                success: false,
                error: 'work_request_id is required'
            });
        }

        // ✅ Check access directly from task/issue instead of work request
        let hasAccess = false;
        let divisionIds = [];

        // First check access from task_ids if provided
        if (task_ids && Array.isArray(task_ids) && task_ids.length > 0) {
            const taskId = parseInt(task_ids[0], 10);
            if (!isNaN(taskId)) {
                const task = await Tasks.findByPk(taskId, {
                    attributes: ['id', 'request_type_id']
                });

                if (task && task.request_type_id) {
                    const requestType = await RequestType.findByPk(task.request_type_id, {
                        include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
                    });

                    if (requestType) {
                        divisionIds = requestType.Divisions?.map(d => d.id) || [];
                    }
                }
            }
        }

        // If no division from task, check from issue_ids
        if (divisionIds.length === 0 && issue_ids && Array.isArray(issue_ids) && issue_ids.length > 0) {
            const issueId = parseInt(issue_ids[0], 10);
            if (!isNaN(issueId)) {
                const issue = await IssueAssignments.findByPk(issueId, {
                    include: [{ model: Tasks, as: 'task', attributes: ['id', 'request_type_id'] }]
                });

                if (issue && issue.task && issue.task.request_type_id) {
                    const requestType = await RequestType.findByPk(issue.task.request_type_id, {
                        include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
                    });

                    if (requestType) {
                        divisionIds = requestType.Divisions?.map(d => d.id) || [];
                    }
                }
            }
        }

        // Check if manager is in any of these divisions
        if (divisionIds.length > 0) {
            const managerDivision = await UserDivisions.findOne({
                where: {
                    user_id: manager_id,
                    division_id: { [Op.in]: divisionIds }
                }
            });

            if (managerDivision) {
                hasAccess = true;
            }
        }

        // Fallback: Check work request manager access if still no access
        if (!hasAccess) {
            const workRequestManager = await WorkRequestManagers.findOne({
                where: {
                    work_request_id: work_request_id,
                    manager_id: manager_id
                }
            });

            if (workRequestManager) {
                hasAccess = true;
            }
        }

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'You are not authorized to share this. Only division manager of this task/issue can share for client review.'
            });
        }

        // Get work request details now
        const workRequest = await WorkRequests.findOne({
            where: { id: work_request_id },
            include: [
                {
                    model: User,
                    as: 'users',
                    attributes: ['id', 'name', 'email']
                }
            ]
        });

        if (!workRequest) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found'
            });
        }

        // Get manager details
        const manager = req.user;

        // Get client (work request creator) details
        const client = workRequest.users;

        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Client (work request creator) not found'
            });
        }

        // Collect all items to share and their documents
        const itemsToShare = [];
        let allDocuments = [];

        // Handle task sharing if task_ids is provided
        if (task_ids && Array.isArray(task_ids) && task_ids.length > 0) {
            for (const taskId of task_ids) {
                const taskIdInt = parseInt(taskId, 10);
                if (isNaN(taskIdInt)) {
                    return res.status(400).json({ success: false, error: 'Invalid task ID: ' + taskId });
                }

                // Get the task details
                const task = await Tasks.findOne({
                    where: { id: taskIdInt, work_request_id: work_request_id },
                    include: [
                        {
                            model: User,
                            as: 'assignedUsers',
                            attributes: ['id', 'name', 'email'],
                            through: { attributes: [] }
                        },
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
                            include: [
                                {
                                    model: IssueAssignmentTypes,
                                    as: 'issueTypeLinks',
                                    include: [
                                        {
                                            model: IssueRegister,
                                            as: 'issueRegister',
                                            attributes: ['id', 'change_issue_type', 'description']
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                });

                if (!task) {
                    return res.status(404).json({
                        success: false,
                        error: 'Task not found or does not belong to this work request: ' + taskId
                    });
                }

                // Check if task is in correct stage for client review
                if (task.review_stage !== 'pm_review') {
                    return res.status(400).json({
                        success: false,
                        error: 'Task must be in pm_review stage to share with client. Current stage: ' + (task.review_stage || 'not_started') + ' for task: ' + taskId
                    });
                }

                // Get task assignment IDs for document lookup
                const taskAssignments = await TaskAssignments.findAll({
                    where: { task_id: taskIdInt },
                    attributes: ['id']
                });
                const taskAssignmentIds = taskAssignments.map(ta => ta.id);

                // Get documents for this task
                let taskDocuments = [];
                if (task_document_ids && task_document_ids.length > 0 && taskAssignmentIds.length > 0) {
                    taskDocuments = await TaskDocuments.findAll({
                        where: {
                            id: { [Op.in]: task_document_ids },
                            task_assignment_id: { [Op.in]: taskAssignmentIds }
                        },
                        attributes: ['id', 'document_name', 'document_path']
                    });
                }

                // If no specific task_document_ids provided, get all approved documents for the task
                if ((!task_document_ids || task_document_ids.length === 0) && taskAssignmentIds.length > 0) {
                    taskDocuments = await TaskDocuments.findAll({
                        where: {
                            task_assignment_id: { [Op.in]: taskAssignmentIds }
                        },
                        attributes: ['id', 'document_name', 'document_path']
                    });
                }

                itemsToShare.push({
                    type: 'task',
                    id: task.id,
                    name: task.task_name,
                    deadline: task.deadline
                });

                allDocuments = [...allDocuments, ...taskDocuments];

                // Update intimate_client to 1 (shared with client for review)
                // Also set the shared_with_client_at date
                await Tasks.update(
                    { intimate_client: 1, shared_with_client_at: new Date() },
                    { where: { id: taskIdInt } }
                );

                // Update intimate_client to 1 for the documents that are being shared
                if (taskDocuments.length > 0) {
                    await TaskDocuments.update(
                        { intimate_client: 1 },
                        { where: { id: { [Op.in]: taskDocuments.map(d => d.id) } } }
                    );
                }
            }
        }

        // Handle issue sharing if issue_ids is provided
        if (issue_ids && Array.isArray(issue_ids) && issue_ids.length > 0) {
            for (const issueId of issue_ids) {
                const issueIdInt = parseInt(issueId, 10);
                if (isNaN(issueIdInt)) {
                    return res.status(400).json({ success: false, error: 'Invalid issue ID: ' + issueId });
                }

                // Get the issue details
                const issueAssignment = await IssueAssignments.findByPk(issueIdInt, {
                    include: [
                        {
                            model: Tasks,
                            as: 'task',
                            attributes: ['id', 'task_name', 'work_request_id'],
                            where: { work_request_id: work_request_id }
                        },
                        {
                            model: IssueUserAssignments,
                            as: 'userAssignments',
                            include: [
                                {
                                    model: User,
                                    as: 'user',
                                    attributes: ['id', 'name', 'email']
                                }
                            ]
                        },
                        {
                            model: IssueAssignmentTypes,
                            as: 'issueTypeLinks',
                            include: [
                                {
                                    model: IssueRegister,
                                    as: 'issueRegister',
                                    attributes: ['id', 'change_issue_type', 'description']
                                }
                            ]
                        },
                        {
                            model: User,
                            as: 'requester',
                            attributes: ['id', 'name', 'email']
                        }
                    ]
                });

                if (!issueAssignment) {
                    return res.status(404).json({
                        success: false,
                        error: 'Issue not found or does not belong to this work request: ' + issueId
                    });
                }

                // Check if issue is in correct stage for client review
                if (issueAssignment.review_stage !== 'pm_review') {
                    return res.status(400).json({
                        success: false,
                        error: 'Issue must be in pm_review stage to share with client. Current stage: ' + (issueAssignment.review_stage || 'not_started') + ' for issue: ' + issueId
                    });
                }

                // Get issue user assignment IDs for document lookup
                const issueUserAssignments = await IssueUserAssignments.findAll({
                    where: { issue_assignment_id: issueIdInt },
                    attributes: ['id']
                });
                const issueUserAssignmentIds = issueUserAssignments.map(iua => iua.id);

                // Get documents for this issue
                let issueDocuments = [];
                if (issue_document_ids && issue_document_ids.length > 0 && issueUserAssignmentIds.length > 0) {
                    issueDocuments = await IssueDocuments.findAll({
                        where: {
                            id: { [Op.in]: issue_document_ids },
                            issue_user_assignment_id: { [Op.in]: issueUserAssignmentIds }
                        },
                        attributes: ['id', 'document_name', 'document_path']
                    });
                }

                // If no specific issue_document_ids provided, get all documents for the issue
                if ((!issue_document_ids || issue_document_ids.length === 0) && issueUserAssignmentIds.length > 0) {
                    issueDocuments = await IssueDocuments.findAll({
                        where: {
                            issue_user_assignment_id: { [Op.in]: issueUserAssignmentIds }
                        },
                        attributes: ['id', 'document_name', 'document_path']
                    });
                }

                itemsToShare.push({
                    type: 'issue',
                    id: issueAssignment.id,
                    name: issueAssignment.version ? `Issue ${issueAssignment.version}` : `Issue ${issueAssignment.id}`,
                    description: issueAssignment.description,
                    deadline: issueAssignment.deadline
                });

                allDocuments = [...allDocuments, ...issueDocuments];

                // Update intimate_client to 1 (shared with client for review)
                // Also set the shared_with_client_at date
                await IssueAssignments.update(
                    { intimate_client: 1, shared_with_client_at: new Date() },
                    { where: { id: issueIdInt } }
                );

                // Update intimate_client to 1 for the documents that are being shared
                if (issueDocuments.length > 0) {
                    await IssueDocuments.update(
                        { intimate_client: 1 },
                        { where: { id: { [Op.in]: issueDocuments.map(d => d.id) } } }
                    );
                }
            }
        }

        // Send email to client with all items and documents
        const html = renderTemplate('clientReviewNotification', {
            client_name: client.name,
            manager_name: manager.name,
            manager_email: manager.email,
            task_name: itemsToShare.map(item => item.name).join(', '),
            task_id: itemsToShare.length > 0 ? itemsToShare[0].id : null,
            project_name: workRequest.project_name || 'N/A',
            brand: workRequest.brand || 'N/A',
            work_request_id: workRequest.id,
            deadline: itemsToShare.length > 0 && itemsToShare[0].deadline
                ? new Date(itemsToShare[0].deadline).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }) : 'Not set',
            documents: allDocuments.map(doc => ({
                document_name: doc.document_name,
                document_path: `${process.env.BACKEND_URL}/${doc.document_path}`
            })),
            frontend_url: process.env.FRONTEND_URL
        });

        await sendMail({
            to: client.email,
            subject: `Review Request - ${itemsToShare.map(item => item.name).join(', ')}`,
            html
        });

        return res.json({
            success: true,
            data: {
                items: itemsToShare,
                work_request: {
                    id: workRequest.id,
                    project_name: workRequest.project_name
                },
                client: {
                    id: client.id,
                    name: client.name,
                    email: client.email
                },
                documents: allDocuments,
                email_sent: true
            },
            message: 'Items shared with client for review successfully'
        });
    } catch (error) {
        console.error('Error sharing for client review:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to share for client review'
        });
    }
};

const acceptIssueRequest = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid issue assignment ID' });
        }
        const manager_id = req.user.id;

        // ✅ SIMPLE DIRECT METHOD as requested:
        // 1. Get issue with task only
        const issueAssignment = await IssueAssignments.findByPk(id, {
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'work_request_id', 'request_type_id']
                },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email'] }
            ]
        });

        if (!issueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue assignment not found' });
        }

        if (!issueAssignment.task) {
            return res.status(400).json({ success: false, error: 'Issue assignment is not linked to a valid task' });
        }

        const task = issueAssignment.task;

        // 2. Check if current user is manager for this task's request_type
        // Get divisions from task's request_type
        const requestType = await RequestType.findByPk(task.request_type_id, {
            include: [{ model: Division, through: { attributes: [] }, attributes: ['id'] }]
        });

        if (!requestType) {
            return res.status(400).json({ success: false, error: 'Invalid request type for this task' });
        }

        const divisionIds = requestType.Divisions?.map(d => d.id) || [];

        // 3. Check if current manager belongs to any of these divisions
        const managerDivision = await UserDivisions.findOne({
            where: {
                user_id: manager_id,
                division_id: { [Op.in]: divisionIds }
            }
        });

        if (!managerDivision) {
            return res.status(403).json({
                success: false,
                error: 'You are not authorized to accept this issue request. Only division managers for this task can accept.'
            });
        }

        if (issueAssignment.status === 'm_accepted') {
            return res.status(400).json({ success: false, error: 'Issue request is already accepted by manager' });
        }

        // Update status to m_accepted and reset notification_alert
        await IssueAssignments.update({ status: 'm_accepted', notification_alert: 0 }, { where: { id } });

        // Get work request details for email
        let workRequest = null;
        if (task.work_request_id) {
            workRequest = await WorkRequests.findByPk(task.work_request_id, {
                attributes: ['id', 'project_name', 'brand']
            });
        }

        // Send email notification
        const requester = issueAssignment.requester;
        if (requester) {
            const html = renderTemplate('issueAcceptanceNotification', {
                user_name: requester.name,
                issue_version: issueAssignment.version,
                issue_description: issueAssignment.description,
                task_name: task.task_name,
                project_name: workRequest ? workRequest.project_name : 'N/A',
                brand: workRequest ? workRequest.brand : 'N/A',
                request_type: requestType.request_type,
                accepted_at: new Date().toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                frontend_url: process.env.FRONTEND_URL
            });

            await sendMail({
                to: requester.email,
                subject: 'Issue Request Accepted',
                html
            });
        }

        res.json({
            success: true,
            message: 'Issue request accepted successfully',
            data: {
                task_id: task.id,
                request_type_id: task.request_type_id,
                division_ids: divisionIds,
                authorized_manager: manager_id
            }
        });
    } catch (error) {
        console.error('Error accepting issue request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getIssueAssignments = async (req, res) => {
    try {
        // Define associations for TaskAssignments
        Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(User, { foreignKey: 'user_id' });

        const manager_id = req.user.id;
        const { status, review_stage, review, intimate_team, sort } = req.query;

        // Define valid enum values
        const validStatuses = ['m_pending', 'u_pending', 'm_accepted', 'u_accepted', 'in_progress', 'completed', 'rejected', 'on_hold', 'cancelled'];
        const validReviewStages = ['not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'];
        const validReviews = ['pending', 'approved', 'change_request'];

        // Build where condition
        let where = {};
        let userSearchTaskIds = null; // Store user search task IDs separately
        let wrProjectNameBrandTaskIds = null; // Store task IDs for project_name/brand searches

        // Apply search - handle fields from related tables
        if (req.search && req.search.term && req.search.fields && req.search.fields.length > 0) {
            const searchFields = req.search.fields;
            const searchTerm = req.search.term;

            // Categorize search fields by which table they belong to
            const directFields = []; // On IssueAssignments
            const wrFields = []; // On WorkRequests (via task)
            const userNameFields = []; // On User (via WorkRequest)

            searchFields.forEach(field => {
                if (field === 'user_name' || field === 'username') {
                    userNameFields.push(field);
                } else if (field === 'project_name' || field === 'brand') {
                    wrFields.push(field);
                } else {
                    directFields.push(field);
                }
            });

            // Build OR condition array
            const orConditions = [];

            // Add direct field conditions (on IssueAssignments)
            if (directFields.length > 0) {
                directFields.forEach(field => {
                    orConditions.push({
                        [field]: { [Op.like]: `%${searchTerm}%` }
                    });
                });
            }

            // Handle WorkRequest fields (project_name, brand) - need to get task IDs from work requests matching these
            if (wrFields.length > 0) {
                // Build where for WorkRequests search
                const wrOrConditions = [];
                wrFields.forEach(field => {
                    wrOrConditions.push({
                        [field]: { [Op.like]: `%${searchTerm}%` }
                    });
                });

                // Find work requests matching the term on these fields
                const matchingWorkRequests = await WorkRequests.findAll({
                    where: {
                        [Op.or]: wrOrConditions
                    },
                    attributes: ['id']
                });

                if (matchingWorkRequests.length > 0) {
                    const wrIds = matchingWorkRequests.map(wr => wr.id);
                    // Get task IDs for these work requests
                    const tasksFromWr = await Tasks.findAll({
                        attributes: ['id'],
                        where: { work_request_id: { [Op.in]: wrIds } },
                        raw: true
                    });
                    const taskIdsFromWr = tasksFromWr.map(t => t.id);
                    if (taskIdsFromWr.length > 0) {
                        orConditions.push({ task_id: { [Op.in]: taskIdsFromWr } });
                        // Also store these for later intersection with division tasks
                        wrProjectNameBrandTaskIds = taskIdsFromWr;
                    }
                }
            }

            // Handle user_name search - get task IDs from work requests belonging to users with matching name
            if (userNameFields.length > 0) {
                const matchingUsers = await User.findAll({
                    where: {
                        name: { [Op.like]: `%${searchTerm}%` }
                    },
                    attributes: ['id']
                });

                if (matchingUsers.length > 0) {
                    const userIds = matchingUsers.map(u => u.id);
                    const taskIdsFromUserSearch = await Tasks.findAll({
                        attributes: ['id'],
                        include: [{
                            model: WorkRequests,
                            where: { user_id: { [Op.in]: userIds } },
                            attributes: []
                        }],
                        raw: true
                    });

                    const taskIds = taskIdsFromUserSearch.map(t => t.id);
                    if (taskIds.length > 0) {
                        orConditions.push({ task_id: { [Op.in]: taskIds } });
                        userSearchTaskIds = taskIds;
                    }
                }
            }

            // Apply the combined OR condition if we have any conditions
            if (orConditions.length > 0) {
                where[Op.or] = orConditions;
            }
        }

        // Apply intimate_team filter if provided (only accept 0 or 1)
        if (intimate_team !== undefined && intimate_team !== null && intimate_team !== '') {
            const intimateTeamValue = parseInt(intimate_team, 10);
            if (isNaN(intimateTeamValue) || (intimateTeamValue !== 0 && intimateTeamValue !== 1)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid intimate_team value. Allowed values are 0 or 1'
                });
            }
            where.intimate_team = intimateTeamValue;
        }

        // Apply status filter if provided (supports comma-separated values)
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());

            // Validate status values
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));

            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }

            // If multiple statuses, use OR condition
            if (statusArray.length > 1) {
                where.status = { [Op.in]: statusArray };
            } else {
                // Single status
                where.status = statusArray[0];
            }
        }

        // Apply review_stage filter if provided (supports comma-separated values)
        if (review_stage) {
            const reviewStageArray = review_stage.split(',').map(rs => rs.trim());

            // Validate review_stage values
            const invalidReviewStages = reviewStageArray.filter(rs => !validReviewStages.includes(rs));

            if (invalidReviewStages.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid review_stage values: ${invalidReviewStages.join(', ')}. Valid values are: ${validReviewStages.join(', ')}`
                });
            }

            // If multiple review_stages, use OR condition
            if (reviewStageArray.length > 1) {
                where.review_stage = { [Op.in]: reviewStageArray };
            } else {
                // Single review_stage
                where.review_stage = reviewStageArray[0];
            }
        }

        // Apply review filter if provided (supports comma-separated values)
        if (review) {
            const reviewArray = review.split(',').map(r => r.trim());

            // Validate review values
            const invalidReviews = reviewArray.filter(r => !validReviews.includes(r));

            if (invalidReviews.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid review values: ${invalidReviews.join(', ')}. Valid values are: ${validReviews.join(', ')}`
                });
            }

            // If multiple reviews, use OR condition
            if (reviewArray.length > 1) {
                where.review = { [Op.in]: reviewArray };
            } else {
                // Single review
                where.review = reviewArray[0];
            }
        }

        // Get manager's divisions
        const managerDivisions = await UserDivisions.findAll({
            where: { user_id: manager_id },
            attributes: ['division_id']
        });

        const managerDivisionIds = managerDivisions.map(md => md.division_id);

        if (managerDivisionIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'No divisions assigned to this manager'
            });
        }

        // Get all active creative users (job_role_id = 4) and creative leads (job_role_id = 3) in manager's divisions
        const usersInManagerDivisions = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: managerDivisionIds } },
            include: [
                {
                    model: User,
                    where: {
                        account_status: 'active',
                        job_role_id: { [Op.in]: [3, 4] } // Creative Lead (3) and Creative User (4)
                    },
                    attributes: ['id', 'name', 'email', 'job_role_id']
                }
            ],
            attributes: []
        });

        // Get user IDs including the manager themselves (since manager also works as creative user)
        const userIdsInDivisions = usersInManagerDivisions.map(ud => ud.User.id);
        userIdsInDivisions.push(manager_id); // Include manager's own ID
        const uniqueUserIds = [...new Set(userIdsInDivisions)];

        // ✅ DIRECT & FAST WAY: Get all tasks that belong to manager's division via RequestType → Division
        // Instead of going through WorkRequestManagers → Tasks (old slow path)
        // Get all request types that are linked to manager's divisions
        const requestTypesOfManagerDivisions = await RequestType.findAll({
            include: [
                {
                    model: Division,
                    through: { attributes: [] },
                    where: { id: { [Op.in]: managerDivisionIds } },
                    attributes: ['id']
                }
            ],
            attributes: ['id'],
            raw: true
        });

        const requestTypeIds = requestTypesOfManagerDivisions.map(rt => rt.id);

        // Get all tasks that use these request types
        const tasksInManagerDivisions = await Tasks.findAll({
            attributes: ['id'],
            where: { request_type_id: { [Op.in]: requestTypeIds } },
            raw: true
        });

        const taskIds = tasksInManagerDivisions.map(t => t.id);

        if (taskIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'No tasks found in your division'
            });
        }

        // Get issue assignments with filters from manager's work requests
        // Only show issues where current manager is assigned to the task's work request
        // 🔒 Security: Only manager of the task's work request can view these issues
        const issueAssignments = await IssueAssignments.findAll({
            where: {
                ...where,
                task_id: { [Op.in]: taskIds }
            },
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'work_request_id', 'deadline', 'status', 'task_type_id'],
                    include: [
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'priority', 'status'],
                            include: [
                                {
                                    model: User,
                                    as: 'users',
                                    attributes: ['id', 'name', 'email']
                                },
                                {
                                    model: RequestType,
                                    attributes: ['id', 'request_type']
                                },
                                {
                                    model: WorkRequestManagers,
                                    attributes: ['id', 'manager_id'],
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
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
                        {
                            model: TaskAssignments,
                            attributes: ['id', 'user_id'],
                            include: [
                                {
                                    model: User,
                                    attributes: ['id', 'name', 'email', 'job_role_id']
                                }
                            ]
                        }
                    ]
                },
                {
                    model: IssueAssignmentTypes,
                    as: 'issueTypeLinks',
                    include: [
                        {
                            model: IssueRegister,
                            as: 'issueRegister',
                            attributes: ['id', 'change_issue_type', 'description']
                        }
                    ]
                },
                {
                    model: User,
                    as: 'requester',
                    attributes: ['id', 'name', 'email']
                },
                {
                    model: IssueUserAssignments,
                    as: 'userAssignments',
                    where: {
                        user_id: { [Op.in]: uniqueUserIds }
                    },
                    required: false,
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        },
                        {
                            model: IssueDocuments,
                            as: 'documents',
                            attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review']
                        }
                    ]
                }
            ],
            order: [['notification_alert', 'DESC'], ['created_at', sort || 'DESC']]
        });

        // Format the response
        const formattedData = issueAssignments.map(issue => {
            const wrManagers = issue.task && issue.task.WorkRequest && issue.task.WorkRequest.WorkRequestManagers
                ? issue.task.WorkRequest.WorkRequestManagers.map(wm => ({
                    id: wm.manager_id,
                    name: wm.manager ? wm.manager.name : null,
                    email: wm.manager ? wm.manager.email : null,
                    source: 'work_request'
                }))
                : [];

            const taskManagers = issue.task && issue.task.TaskAssignments
                ? issue.task.TaskAssignments
                    .filter(ta => ta.User && [1, 2, 3].includes(ta.User.job_role_id))
                    .map(ta => ({
                        id: ta.user_id,
                        name: ta.User.name,
                        email: ta.User.email,
                        source: 'task'
                    }))
                : [];

            // Merge, deduplicate by id
            const allManagerIds = new Set(wrManagers.map(m => m.id));
            const mergedManagers = [
                ...wrManagers,
                ...taskManagers.filter(m => !allManagerIds.has(m.id))
            ];

            return {
                id: issue.id,
                issue_id: issue.issue_id,
                version: issue.version,
                description: issue.description,
                notification_alert: issue.notification_alert,
                // Issue deadline - shown at top level for easy access
                deadline: issue.deadline,
                start_date: issue.start_date,
                end_date: issue.end_date,
                assignment_type: issue.assignment_type,
                intimate_team: issue.intimate_team,
                intimate_client: issue.intimate_client,
                task_count: issue.task_count,
                link: issue.link,
                status: issue.status,
                review: issue.review,
                review_stage: issue.review_stage,
                created_at: issue.created_at,
                updated_at: issue.updated_at,
                // Task type from the linked task - shown at top level for easy access
                task_type: issue.task && issue.task.TaskType ? {
                    id: issue.task.TaskType.id,
                    task_type: issue.task.TaskType.task_type,
                    description: issue.task.TaskType.description
                } : null,
                task_type_name: issue.task && issue.task.TaskType ? issue.task.TaskType.task_type : null,
                task_type_id: issue.task ? issue.task.task_type_id : null,
                task: issue.task ? {
                    id: issue.task.id,
                    task_name: issue.task.task_name,
                    work_request_id: issue.task.work_request_id,
                    // Task deadline
                    deadline: issue.task.deadline,
                    status: issue.task.status,
                    task_type_id: issue.task.task_type_id,
                    // Task type info at task level
                    task_type: issue.task.TaskType ? {
                        id: issue.task.TaskType.id,
                        task_type: issue.task.TaskType.task_type,
                        description: issue.task.TaskType.description
                    } : null,
                    task_type_name: issue.task.TaskType ? issue.task.TaskType.task_type : null,
                    // Include assigned users from the task
                    assignedUsers: issue.task.TaskAssignments ? issue.task.TaskAssignments.map(ta => ({
                        id: ta.id,
                        user_id: ta.user_id,
                        user: ta.User ? {
                            id: ta.User.id,
                            name: ta.User.name,
                            email: ta.User.email
                        } : null
                    })) : [],
                    workRequest: issue.task.WorkRequest ? {
                        id: issue.task.WorkRequest.id,
                        project_name: issue.task.WorkRequest.project_name,
                        brand: issue.task.WorkRequest.brand,
                        priority: issue.task.WorkRequest.priority,
                        status: issue.task.WorkRequest.status,
                        user: issue.task.WorkRequest.users ? {
                            id: issue.task.WorkRequest.users.id,
                            name: issue.task.WorkRequest.users.name,
                            email: issue.task.WorkRequest.users.email
                        } : null,
                        requestType: issue.task.WorkRequest.RequestType ? {
                            id: issue.task.WorkRequest.RequestType.id,
                            request_type: issue.task.WorkRequest.RequestType.request_type
                        } : null,
                        managers: issue.task.WorkRequest.WorkRequestManagers ? issue.task.WorkRequest.WorkRequestManagers.map(wm => ({
                            id: wm.manager_id,
                            name: wm.manager ? wm.manager.name : null,
                            email: wm.manager ? wm.manager.email : null
                        })) : []
                    } : null
                } : null,
                requester: issue.requester ? {
                    id: issue.requester.id,
                    name: issue.requester.name,
                    email: issue.requester.email
                } : null,
                issueTypes: issue.issueTypeLinks ? issue.issueTypeLinks.map(link => ({
                    id: link.id,
                    issue_register_id: link.issue_register_id,
                    issueRegister: link.issueRegister ? {
                        id: link.issueRegister.id,
                        change_issue_type: link.issueRegister.change_issue_type,
                        description: link.issueRegister.description
                    } : null
                })) : [],
                assignedUsers: issue.userAssignments ? issue.userAssignments.map(ua => ({
                    id: ua.id,
                    user_id: ua.user_id,
                    user: ua.user ? {
                        id: ua.user.id,
                        name: ua.user.name,
                        email: ua.user.email
                    } : null,
                    documents: ua.documents
                })) : [],
                managers: mergedManagers
            };
        });

        // Calculate total notification count: count of issue assignments with notification_alert = 1
        const totalNotificationAlert = formattedData.filter(issue => issue.notification_alert == 1).length;

        res.json({
            success: true,
            data: formattedData,
            notification_alert_count: totalNotificationAlert,
            message: 'Issue assignments retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue assignments:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch issue assignments'
        });
    }
};

// Assign issue assignment to a user
const assignIssueToUser = async (req, res) => {
    try {
        const { issue_assignment_id, user_id, deadline } = req.body;
        const manager_id = req.user.id;

        if (!issue_assignment_id || !user_id) {
            return res.status(400).json({ success: false, error: 'issue_assignment_id and user_id are required' });
        }

        // Check if issue_assignment exists with issue_type_links for issue details
        const issueAssignment = await IssueAssignments.findByPk(issue_assignment_id, {
            include: [
                { model: Tasks, as: 'task', attributes: ['id', 'task_name', 'work_request_id'] },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email'] },
                {
                    model: IssueAssignmentTypes,
                    as: 'issueTypeLinks',
                    include: [
                        {
                            model: IssueRegister,
                            as: 'issueRegister',
                            attributes: ['id', 'change_issue_type', 'description', 'quantification']
                        }
                    ]
                }
            ]
        });

        if (!issueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue assignment not found' });
        }

        // Check if user exists
        const assignedUser = await User.findByPk(user_id, {
            attributes: ['id', 'name', 'email', 'job_role_id']
        });

        if (!assignedUser) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Check if already assigned
        const existingAssignment = await IssueUserAssignments.findOne({
            where: { issue_assignment_id, user_id }
        });

        // if (existingAssignment) {
        //     return res.status(400).json({ success: false, error: 'User is already assigned to this issue' });
        // }

        // Create the assignment in issue_user_assignments
        const issueUserAssignment = await IssueUserAssignments.create({
            issue_assignment_id,
            user_id
        });

        // Update issue_assignment status to 'u_pending', intimate_team to 1, and notification_alert to 1
        await IssueAssignments.update(
            { status: 'u_pending', intimate_team: 1, deadline: deadline || null, notification_alert: 1 },
            { where: { id: issue_assignment_id } }
        );

        // Get work request details for email
        let workRequest = null;
        let requestType = null;
        if (issueAssignment.task && issueAssignment.task.work_request_id) {
            workRequest = await WorkRequests.findByPk(issueAssignment.task.work_request_id, {
                attributes: ['id', 'project_name', 'brand', 'priority', 'requested_at'],
                include: [
                    { model: User, as: 'users', attributes: ['id', 'name', 'email'] },
                    { model: RequestType, attributes: ['id', 'request_type'] }
                ]
            });
            requestType = workRequest ? workRequest.RequestType : null;
        }

        // Get manager details for email
        const manager = await User.findByPk(manager_id, {
            attributes: ['id', 'name', 'email']
        });

        // Format issue registers from issue_type_links
        const issueRegisters = issueAssignment.issueTypeLinks ?
            issueAssignment.issueTypeLinks.map(link => ({
                change_issue_type: link.issueRegister?.change_issue_type || 'N/A',
                description: link.issueRegister?.description || 'No description',
                quantification: link.issueRegister?.quantification || null
            })) : [];

        // Format assigned users for email
        const assignedUsersList = [{
            name: assignedUser.name,
            email: assignedUser.email
        }];

        // Send email to the assigned user
        const html = renderTemplate('issueAssignmentNotification', {
            manager_name: manager ? manager.name : 'Manager',
            task_id: issueAssignment.task ? issueAssignment.task.id : 'N/A',
            task_name: issueAssignment.task ? issueAssignment.task.task_name : 'N/A',
            issue_id: issueAssignment.id,
            issue_version: issueAssignment.version,
            issue_description: issueAssignment.description,
            task_type: 'Issue Assignment',
            project_name: workRequest ? workRequest.project_name : 'N/A',
            brand: workRequest ? workRequest.brand : 'N/A',
            priority: workRequest ? workRequest.priority : 'N/A',
            request_type: requestType ? requestType.request_type : 'N/A',
            created_at: workRequest ? new Date(workRequest.requested_at).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }) : new Date().toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            issue_registers: issueRegisters,
            assigned_users: assignedUsersList,
            assigned_by: manager ? manager.name : 'Manager',
            assigned_at: new Date().toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            frontend_url: process.env.FRONTEND_URL
        });

        const mailOptions = {
            to: assignedUser.email,
            subject: `Issue Assignment - ${issueAssignment.task ? issueAssignment.task.task_name : 'Task'} - ${issueAssignment.version}`,
            html
        };

        await sendMail(mailOptions);

        res.json({
            success: true,
            data: {
                id: issueUserAssignment.id,
                issue_assignment_id: issueUserAssignment.issue_assignment_id,
                user_id: issueUserAssignment.user_id,
                status: 'u_pending',
                user: {
                    id: assignedUser.id,
                    name: assignedUser.name,
                    email: assignedUser.email
                },
                email_sent: true
            },
            message: 'Issue assigned to user successfully and email sent'
        });
    } catch (error) {
        console.error('Error assigning issue to user:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to assign issue to user'
        });
    }
};

// Complete all tasks and issues for a work request
const completeAllTasksAndIssues = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();

    try {
        const { work_request_id } = req.body;

        const manager_id = req.user.id;

        if (!work_request_id) {
            return res.status(400).json({
                success: false,
                error: 'work_request_id is required'
            });
        }

        const workRequestId = parseInt(work_request_id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid work_request_id'
            });
        }

        // Check if work request exists
        const workRequest = await WorkRequests.findByPk(workRequestId);
        if (!workRequest) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found'
            });
        }

        // Check if the user is either the creator of the work request OR a manager assigned to it
        const isCreator = workRequest.user_id === manager_id;
        const managerAssignment = await WorkRequestManagers.findOne({
            where: {
                work_request_id: workRequestId,
                manager_id: manager_id
            }
        });

        if (!isCreator && !managerAssignment) {
            return res.status(403).json({
                success: false,
                error: 'You are not authorized to complete this work request'
            });
        }

        // Find all tasks linked to this work_request_id
        const tasks = await Tasks.findAll({
            where: { work_request_id: workRequestId }
        });

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No tasks found for this work request'
            });
        }

        const taskIds = tasks.map(task => task.id);

        // Update all tasks: status = 'completed', review = 'approved', review_stage = 'final_approved'
        const tasksUpdateResult = await Tasks.update(
            {
                status: 'completed',
                review: 'approved',
                review_stage: 'final_approved'
            },
            {
                where: { id: taskIds },
                transaction
            }
        );

        // Also update the work_request status to 'completed'
        const workRequestUpdateResult = await WorkRequests.update(
            {
                status: 'completed'
            },
            {
                where: { id: workRequestId },
                transaction
            }
        );

        // Find all issue_assignments linked to these tasks
        const issueAssignments = await IssueAssignments.findAll({
            where: {
                task_id: taskIds
            }
        });

        let issuesUpdateResult = 0;
        if (issueAssignments.length > 0) {
            const issueIds = issueAssignments.map(issue => issue.id);

            // Update all issue_assignments: status = 'completed', review = 'approved', review_stage = 'final_approved'
            issuesUpdateResult = await IssueAssignments.update(
                {
                    status: 'completed',
                    review: 'approved',
                    review_stage: 'final_approved'
                },
                {
                    where: { id: issueIds },
                    transaction
                }
            );
        }

        // Commit the transaction
        await transaction.commit();

        // Get user details who created the work request
        const requestCreator = await User.findByPk(workRequest.user_id, {
            attributes: ['id', 'name', 'email']
        });

        // Get manager details who completed the tasks
        const manager = await User.findByPk(manager_id, {
            attributes: ['id', 'name', 'email']
        });

        // Get request type for the work request
        const requestType = await RequestType.findByPk(workRequest.request_type_id, {
            attributes: ['request_type']
        });

        // Send email notification to the user who created the work request
        if (requestCreator && requestCreator.email) {
            try {
                const html = renderTemplate('workRequestCompletionNotification', {
                    project_name: workRequest.project_name || 'N/A',
                    brand: workRequest.brand || 'N/A',
                    request_type: requestType ? requestType.request_type : 'N/A',
                    priority: workRequest.priority || 'N/A',
                    request_id: workRequest.id,
                    completed_at: new Date().toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    description: `All ${tasks.length} task(s) and ${issueAssignments.length} issue(s) have been completed successfully.`,
                    completed_by: manager ? manager.name : 'Manager',
                    task_count: tasks.length,
                    issue_count: issueAssignments.length,
                    frontend_url: process.env.FRONTEND_URL
                });

                const mailOptions = {
                    to: requestCreator.email,
                    cc: manager && manager.email ? [manager.email] : [],
                    subject: `Project Completed - Work Request #${workRequest.id} - ${workRequest.project_name}`,
                    html
                };

                await sendMail(mailOptions);
            } catch (emailError) {
                console.error('Error sending completion email:', emailError);
                // Don't fail the request if email fails, just log the error
            }
        }

        return res.status(200).json({
            success: true,
            message: 'All tasks and issues completed successfully',
            data: {
                tasks_updated: tasksUpdateResult[0],
                issues_updated: issuesUpdateResult[0],
                work_request_updated: workRequestUpdateResult[0]
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error completing all tasks and issues:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = {
    getAssignedWorkRequests,
    getAssignedWorkRequestById,
    acceptWorkRequest,
    acceptIssueRequest,
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
    getAssignedRequestsWithStatus,
    getUserTask,
    updateTask,
    reviewTaskDocument,
    reviewIssueDocument,
    reviewTask,
    shareForClientReview,
    assignIssueToUser,
    getIssueAssignments,
    completeAllTasksAndIssues
};
