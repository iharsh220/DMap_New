const { Op } = require('sequelize');
const {
    Tasks,
    RequestType,
    TaskType,
    TaskAssignments,
    TaskDependencies,
    WorkRequests,
    WorkRequestManagers,
    User,
    TaskDocuments,
    UserDivisions,
    JobRole,
    TaskReviewHistory,
    IssueAssignments,
    IssueAssignmentTypes,
    IssueRegister,
    IssueUserAssignments,
    IssueDocuments,
    Division,
    TaskProjectReference,
    ProjectRequestReference,
    RequestDivisionReference,
    ProjectType
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { recordTaskHistory, recordIssueHistory, recordWorkRequestHistory, getTaskHistory: getTaskHistoryRecords, getIssueHistory: getIssueHistoryRecords } = require('../../services/historyService');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const getAssignedTasks = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { status, deadline, review, review_stages, assigned_to, sort } = req.query; // Get status, deadline, review, review_stages, and assigned_to filters from query params

        // Check if user is manager (job_role_id = 2)
        const isManager = req.user.jobRole && req.user.jobRole.id === 2;

        let userIds = [user_id]; // Start with current user

        // If assigned_to is 'self', only show tasks assigned to the current user
        // AND the work request must have this user as a manager in WorkRequestManagers
        let selfWorkRequestIds = [];
        if (assigned_to === 'self') {
            userIds = [user_id];

            // Get work requests where the current user is a manager
            const managedWorkRequests = await WorkRequestManagers.findAll({
                where: { manager_id: user_id },
                attributes: ['work_request_id']
            });

            selfWorkRequestIds = managedWorkRequests.map(wrm => wrm.work_request_id);
        } else if (assigned_to === 'myTask') {

        } else if (isManager) {
            // Get divisions the manager belongs to
            const managerDivisions = await UserDivisions.findAll({
                where: { user_id: user_id },
                attributes: ['division_id']
            });

            if (managerDivisions.length > 0) {
                const divisionIds = managerDivisions.map(md => md.division_id);

                // Get creative users and leads in these divisions
                const teamUsers = await UserDivisions.findAll({
                    where: { division_id: { [Op.in]: divisionIds } },
                    include: [{
                        model: User,
                        where: {
                            id: { [Op.ne]: user_id }, // Exclude manager himself
                            account_status: 'active'
                        },
                        attributes: ['id']
                    }],
                    attributes: []
                });

                const teamUserIds = teamUsers.map(tu => tu.User.id);
                userIds = userIds.concat(teamUserIds);
            }
        } else {
            // Non-manager users: Check if user is in department 9
            const isInDepartment9 = req.user.department && req.user.department.id === 9;
            if (!isInDepartment9) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. This endpoint is only available for department 9 users or managers.'
                });
            }
        }

        // Build where condition
        let whereCondition = { is_deleted: 0 };

        // By default exclude fully approved tasks unless explicitly requested
        if (!review && !review_stages) {
            whereCondition[Op.not] = [
                {
                    review: 'approved',
                    review_stage: 'final_approved'
                }
            ];
        }

        // Apply filters (excluding user_name/username/status as they're handled separately)
        if (req.filters) {
            const { user_name, username, status, ...otherFilters } = req.filters;
            whereCondition = { ...whereCondition, ...otherFilters };
        }

        // Apply search - handle user_name/username specially since it's on the WorkRequest's user (client)
        if (req.search.term && req.search.fields.length > 0) {
            const searchFields = req.search.fields;
            // Check for user_name or username in search fields
            const hasUserNameSearch = searchFields.includes('user_name') || searchFields.includes('username');

            // Remove user_name and username from search fields for direct query
            const directSearchFields = searchFields.filter(field => field !== 'user_name' && field !== 'username');

            // Build OR condition array combining direct fields and work_request_id subquery (if applicable)
            const orConditions = [];

            // Add direct field conditions (task_name, etc.)
            if (directSearchFields.length > 0) {
                directSearchFields.forEach(field => {
                    if (!['deadline', 'created_at', 'updated_at'].includes(field)) {
                        orConditions.push({
                            [field]: { [Op.like]: `%${req.search.term}%` }
                        });
                    }
                });
            }

            // If user_name/username search is requested, add condition for work_request IDs
            if (hasUserNameSearch) {
                // Find users matching the name (case-insensitive search) - these are the work request creators (clients)
                const matchingUsers = await User.findAll({
                    where: {
                        name: { [Op.like]: `%${req.search.term}%` }
                    },
                    attributes: ['id']
                });

                if (matchingUsers.length > 0) {
                    const matchingUserIds = matchingUsers.map(u => u.id);
                    // Get all work_requests where user_id (client) is in matching user IDs
                    const workRequests = await WorkRequests.findAll({
                        attributes: ['id'],
                        where: { user_id: { [Op.in]: matchingUserIds } }
                    });
                    const matchingWorkRequestIds = workRequests.map(wr => wr.id);

                    if (matchingWorkRequestIds.length > 0) {
                        // Add condition to match tasks whose work_request_id is in the list
                        orConditions.push({ work_request_id: { [Op.in]: matchingWorkRequestIds } });
                    }
                }
                // If no matching users/work_requests found, we simply skip - other direct fields still work
            }

            // Apply the combined OR condition if we have any conditions
            if (orConditions.length > 0) {
                whereCondition[Op.or] = orConditions;
            }
        }

        // Handle multiple comma-separated status values
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());

            // Validate status values
            const validStatuses = ['pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred', 'cancelled', 'overdue'];
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));

            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }

            const hasOverdue = statusArray.includes('overdue');
            const normalStatuses = statusArray.filter(s => s !== 'overdue');

            if (normalStatuses.length > 0) {
                if (normalStatuses.length > 1) {
                    whereCondition.status = { [Op.in]: normalStatuses };
                } else {
                    whereCondition.status = normalStatuses[0];

                    // For pending status, also require intimate_team = 1
                    if (normalStatuses[0] === 'pending') {
                        whereCondition.intimate_team = 1;
                    }
                }
            }

            if (hasOverdue) {
                whereCondition.deadline = { [Op.lt]: new Date() };
                whereCondition.status = { [Op.notIn]: ['completed', 'cancelled'] };
                whereCondition.review = { [Op.ne]: 'approved' };
                whereCondition.review_stage = { [Op.ne]: 'final_approved' };
                whereCondition[Op.or] = [
                    { review: { [Op.ne]: 'change_request' } },
                    { review_stage: { [Op.ne]: 'pm_review' } }
                ];
            }
        }
        // If no status filter, show all tasks (no default filter applied)

        // Apply work_request_id filter for 'self' - only show tasks from work requests where user is a manager
        if (assigned_to === 'self' && selfWorkRequestIds.length > 0) {
            whereCondition.work_request_id = { [Op.in]: selfWorkRequestIds };
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
                whereCondition.review = { [Op.in]: reviewArray };
            } else {
                // Single review
                whereCondition.review = reviewArray[0];
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
                whereCondition.review_stage = { [Op.in]: reviewStageArray };
            } else {
                // Single review_stage
                whereCondition.review_stage = reviewStageArray[0];
            }
        }

        // Apply deadline filter
        if (deadline === 'null') {
            // Filter tasks with null deadline
            whereCondition.deadline = null;
        } else if (deadline && deadline !== 'null') {
            // Parse deadline date
            const deadlineDate = new Date(deadline);
            if (isNaN(deadlineDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid deadline format. Use YYYY-MM-DD format.'
                });
            }

            // Set deadline to start of day and end of day for full day matching
            const deadlineStart = new Date(deadlineDate);
            deadlineStart.setHours(0, 0, 0, 0);

            const deadlineEnd = new Date(deadlineDate);
            deadlineEnd.setHours(23, 59, 59, 999);

            whereCondition.deadline = {
                [Op.between]: [deadlineStart, deadlineEnd]
            };
        }

        const tasks = await Tasks.findAll({
            where: whereCondition,
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: [] },
                    required: false
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
                                    attributes: ['id', 'name', 'email'],
                                    include: [{
                                        model: JobRole,
                                        attributes: ['id', 'role_title', 'level', 'description']
                                    }]
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
            attributes: { exclude: [] },
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [
                ['notification_alert', 'DESC'],
                ['deadline', sort || 'DESC']
            ]
        });

        // Modify notification_alert based on user role and assignment for each task
        // Creative Manager (job_role_id = 2):
        //   - If manager is assigned to the task AND review = 'pending' AND review_stage = 'manager_review': keep notification_alert as is (1)
        //   - Otherwise: notification_alert = 0
        // Creative User (job_role_id = 4):
        //   - If status = 'pending' AND review = 'pending' AND review_stage = 'not_started': keep notification_alert as is (1)
        //   - Otherwise: notification_alert = 0
        const isCreativeUser = req.user.jobRole && req.user.jobRole.id === 4;

        tasks.forEach(task => {
            if (isManager) {
                // Manager: only keep notification_alert = 1 if database already has 1 AND review = 'pending' AND review_stage = 'manager_review'
                if (task.notification_alert == 1 && task.review === 'pending' && task.review_stage === 'manager_review') {
                    // Keep as 1
                } else {
                    task.dataValues.notification_alert = 0;
                }
            } else if (isCreativeUser) {
                // For creative user: only keep notification_alert = 1 if database already has 1 AND:
                // 1. status=pending, review=pending, review_stage=not_started
                // 2. status=in_progress, review=pending, review_stage=manager_review
                const isPendingNotStarted = task.status === 'pending' && task.review === 'pending' && task.review_stage === 'not_started';
                const isInProgressManagerReview = task.status === 'in_progress' && task.review === 'pending' && task.review_stage === 'manager_review';
                if (task.notification_alert == 1 && (isPendingNotStarted || isInProgressManagerReview)) {
                    // Keep as 1
                } else {
                    task.dataValues.notification_alert = 0;
                }
            }
        });

        // Calculate total notification count based on user role
        // Count only tasks that have notification_alert = 1 in database AND meet the conditions
        let totalNotificationAlert = 0;
        if (isManager) {
            // Manager: count tasks with notification_alert = 1 AND review = 'pending' AND review_stage = 'manager_review'
            totalNotificationAlert = tasks.filter(task => task.notification_alert == 1 && task.review === 'pending' && task.review_stage === 'manager_review').length;
        } else if (isCreativeUser) {
            // Creative User: count tasks with notification_alert = 1 AND:
            // 1. status=pending, review=pending, review_stage=not_started
            // 2. status=in_progress, review=pending, review_stage=manager_review
            totalNotificationAlert = tasks.filter(task => {
                const isPendingNotStarted = task.status === 'pending' && task.review === 'pending' && task.review_stage === 'not_started';
                const isInProgressManagerReview = task.status === 'in_progress' && task.review === 'pending' && task.review_stage === 'manager_review';
                return task.notification_alert == 1 && (isPendingNotStarted || isInProgressManagerReview);
            }).length;
        } else {
            // Default: count all tasks with notification_alert = 1
            totalNotificationAlert = tasks.filter(task => task.notification_alert == 1).length;
        }

        // Sort WorkRequestManagers by nested manager ID ascending (23 then 27)
        tasks.forEach(task => {
            if (task.WorkRequest && task.WorkRequest.WorkRequestManagers) {
                task.WorkRequest.WorkRequestManagers.sort((a, b) => {
                    const managerIdA = a.manager?.id || 0;
                    const managerIdB = b.manager?.id || 0;
                    return managerIdA - managerIdB;
                });
            }
        });

        // Collect all unique user IDs from assigned users
        const allAssignedUserIds = [...new Set(tasks.flatMap(task => task.assignedUsers.map(user => user.id)))];

        // Get task counts for these users
        let userTaskCounts = {};
        if (allAssignedUserIds.length > 0) {
            // Get accepted tasks count
            const acceptedCounts = await TaskAssignments.findAll({
                where: { user_id: { [Op.in]: allAssignedUserIds } },
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
                where: { user_id: { [Op.in]: allAssignedUserIds } },
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
                where: { user_id: { [Op.in]: allAssignedUserIds } },
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
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
                }
                userTaskCounts[count.user_id].accepted = parseInt(count.accepted_count);
            });

            inProgressCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
                }
                userTaskCounts[count.user_id].in_progress = parseInt(count.in_progress_count);
            });

            // Organize completed task counts
            completedCounts.forEach(count => {
                if (!userTaskCounts[count.user_id]) {
                    userTaskCounts[count.user_id] = { accepted: 0, in_progress: 0, completed: 0 };
                }
                userTaskCounts[count.user_id].completed = parseInt(count.completed_count);
            });
        }

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
            pagination: req.pagination,
            notification_alert_count: totalNotificationAlert,
            message: 'Assigned tasks retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch assigned tasks'
        });
    }
};


const assignTaskToUser = async (req, res) => {
    try {
        const { task_id, user_id, work_request_id, deadline } = req.body;

        if (!task_id || !user_id || !work_request_id) {
            return res.status(400).json({
                success: false,
                error: 'task_id, user_id, and work_request_id are required'
            });
        }

        const taskId = parseInt(task_id, 10);
        const userId = parseInt(user_id, 10);
        const workRequestId = parseInt(work_request_id, 10);

        if (isNaN(taskId) || isNaN(userId) || isNaN(workRequestId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task_id, user_id, or work_request_id'
            });
        }

        // Check if user is manager or super admin (job_role_id = 2 for manager, assuming super admin has different role)
        const isManager = req.user.jobRole && (req.user.jobRole.id === 2 || req.user.jobRole.id === 1); // Assuming 1 is super admin
        if (!isManager) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Only managers and super admins can assign tasks.'
            });
        }

        // Get task details
        const task = await Tasks.findByPk(taskId);

        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        // Get work request details
        const workRequest = await WorkRequests.findByPk(workRequestId, {
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
                    include: [
                        {
                            model: User,
                            as: 'manager',
                            attributes: ['id', 'name', 'email'],
                            include: [{
                                model: JobRole,
                                attributes: ['id', 'role_title', 'level', 'description']
                            }]
                        }
                    ]
                }
            ]
        });

        if (!workRequest) {
            return res.status(404).json({ success: false, error: 'Work request not found' });
        }
        console.log(workRequest.status);
        // Check if work request is accepted
        if (workRequest.status !== 'accepted' && workRequest.status !== 'in_progress' && workRequest.status !== 'assigned') {
            return res.status(400).json({
                success: false,
                error: 'Work request must be accepted before assigning tasks'
            });
        }

        // Get user details
        const assignedUser = await User.findByPk(userId, {
            attributes: ['id', 'name', 'email']
        });

        if (!assignedUser) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Prepare task update data
        const taskUpdateData = {};

        // Validate and set deadline if provided
        if (deadline) {
            const deadlineDate = new Date(deadline);
            if (isNaN(deadlineDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid deadline format'
                });
            }

            // Validate that deadline is not in the past
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Set to start of day for date comparison
            if (deadlineDate < today) {
                return res.status(400).json({
                    success: false,
                    error: 'Deadline cannot be in the past'
                });
            }

            taskUpdateData.deadline = deadlineDate;
        }

        // Update task deadline if provided
        if (Object.keys(taskUpdateData).length > 0) {
            await Tasks.update(taskUpdateData, {
                where: { id: taskId }
            });
        }

        // Delete all existing task assignments for this task
        await TaskAssignments.destroy({
            where: { task_id: taskId }
        });

        // Reset task status to pending when reassigning to a new user
        // This ensures the new user has to accept the task again
        const statusUpdate = { status: 'pending' };
        if (task.status !== 'pending') {
            statusUpdate.start_date = null;
            statusUpdate.end_date = null;
        }

        // Combine status update with intimate_team update
        await Tasks.update(
            { ...statusUpdate, intimate_team: 1 },
            { where: { id: taskId } }
        );

        // Create new task assignment for the user
        await TaskAssignments.create({
            task_id: taskId,
            user_id: userId
        });

        await recordTaskHistory({
            req,
            taskId,
            workRequestId: workRequest.id,
            action: 'assigned',
            previousStatus: task.status,
            newStatus: 'pending',
            comments: 'Task assigned to user',
            relatedUserId: req.user.id,
            assignedToUserId: userId,
            assignedToUserName: assignedUser.name
        });

        await recordWorkRequestHistory({
            req,
            workRequestId: workRequest.id,
            action: 'task_assigned',
            relatedTaskId: taskId,
            relatedUserId: req.user.id,
            comments: 'Task assigned to user'
        });

        // Send consolidated email to work request creator with CC to managers and assigned user
        const assignedAt = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const taskData = {
            id: task.id,
            task_name: task.task_name,
            description: task.description,
            deadline: task.deadline,
            assigned_user: {
                id: assignedUser.id,
                name: assignedUser.name,
                email: assignedUser.email
            }
        };

        // Collect CC emails (all managers + assigned user)
        const ccEmails = [];

        // Add assigned user to CC if different from creator
        if (workRequest.users && workRequest.users.email !== assignedUser.email) {
            ccEmails.push(assignedUser.email);
        }

        // Add all managers to CC
        if (workRequest.WorkRequestManagers && workRequest.WorkRequestManagers.length > 0) {
            const managerEmails = workRequest.WorkRequestManagers
                .map(wrm => wrm.manager?.email)
                .filter(email => email && email !== workRequest.users?.email); // Don't CC the creator

            ccEmails.push(...managerEmails);
        }

        // Email data
        const emailData = {
            project_name: workRequest.project_name,
            brand: workRequest.brand,
            request_type: workRequest.RequestType?.request_type || 'N/A',
            priority: workRequest.priority,
            request_id: workRequest.id,
            assigned_at: assignedAt,
            tasks: [taskData],
            frontend_url: process.env.FRONTEND_URL
        };

        // Send single email to work request creator with CC to managers and assigned user
        const html = renderTemplate('taskAssignmentNotification', emailData);

        const mailOptions = {
            to: workRequest.users.email,
            subject: 'Task Assigned - D-Map',
            html
        };

        // Add CC if there are recipients
        if (ccEmails.length > 0) {
            mailOptions.cc = ccEmails.join(',');
        }

        await sendMail(mailOptions);

        res.json({
            success: true,
            message: 'Task assigned to user successfully',
            data: {
                task_id: taskId,
                assigned_user: {
                    id: assignedUser.id,
                    name: assignedUser.name,
                    email: assignedUser.email
                },
                work_request_id: workRequest.id
            }
        });
    } catch (error) {
        console.error('Error assigning task to user:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to assign task to user'
        });
    }
};

const getTaskById = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        // Check if user is manager (job_role_id = 2)
        const isManager = req.user.jobRole && req.user.jobRole.id === 2;

        // Get single task with full details
        let userIds = [req.user.id]; // Start with current user
        let includeAssignedUsersFilter = true;

        if (isManager) {
            // Get divisions the manager belongs to
            const managerDivisions = await UserDivisions.findAll({
                where: { user_id: req.user.id },
                attributes: ['division_id']
            });

            if (managerDivisions.length > 0) {
                const divisionIds = managerDivisions.map(md => md.division_id);

                // Get creative users and leads in these divisions
                const teamUsers = await UserDivisions.findAll({
                    where: { division_id: { [Op.in]: divisionIds } },
                    include: [{
                        model: User,
                        where: {
                            id: { [Op.ne]: req.user.id }, // Exclude manager themselves
                            account_status: 'active'
                        },
                        attributes: ['id']
                    }],
                    attributes: []
                });

                const teamUserIds = teamUsers.map(tu => tu.User.id);
                userIds = userIds.concat(teamUserIds);

                // Managers should have access to all tasks in their division - don't filter by assigned users
                includeAssignedUsersFilter = false;
            }
        }

        const taskResult = await Tasks.findOne({
            where: { id: taskId, is_deleted: 0 },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: includeAssignedUsersFilter ? { id: { [Op.in]: userIds } } : undefined,
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: ['created_at'] },
                    required: includeAssignedUsersFilter,
                    include: [
                        {
                            model: UserDivisions,
                            as: 'userDivisions',
                            attributes: ['division_id'],
                            include: [
                                {
                                    model: Division,
                                    as: 'division',
                                    attributes: ['id', 'title']
                                }
                            ]
                        }
                    ]
                },
                {
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description'],
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
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description', 'quantification'],
                    include: [
                        {
                            model: ProjectType,
                            as: 'ProjectTypes',
                            through: {
                                model: TaskProjectReference,
                                as: 'TaskProjectReference',
                                attributes: ['id', 'task_id', 'project_id']
                            },
                            attributes: ['id', 'project_type', 'description'],
                            include: [
                                {
                                    model: RequestType,
                                    as: 'RequestTypes',
                                    through: {
                                        model: ProjectRequestReference,
                                        as: 'ProjectRequestReference',
                                        attributes: ['id', 'project_id', 'request_id']
                                    },
                                    attributes: ['id', 'request_type', 'description'],
                                    include: [
                                        {
                                            model: Division,
                                            as: 'Divisions',
                                            through: {
                                                model: RequestDivisionReference,
                                                as: 'RequestDivisionReference',
                                                attributes: ['id', 'request_id', 'division_id']
                                            },
                                            attributes: ['id', 'title']
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
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
                            attributes: ['id', 'request_type', 'description'],
                            include: [
                                {
                                    model: Division,
                                    attributes: ['id', 'title'],
                                    through: { attributes: [] }
                                }
                            ]
                        },
                        {
                            model: WorkRequestManagers,
                            attributes: ['id'],
                            include: [
                                {
                                    model: User,
                                    as: 'manager',
                                    attributes: ['id', 'name', 'email'],
                                    include: [{
                                        model: JobRole,
                                        attributes: ['id', 'role_title', 'level', 'description']
                                    }]
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
                    model: TaskAssignments,
                    include: [
                        {
                            model: TaskDocuments,
                            attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'status', 'uploaded_at']
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
                }
            ],
            attributes: { exclude: [] } // Include all attributes including timestamps
        });

        if (!taskResult) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        // Reset notification_alert to 0 if it is 1
        // if (taskResult.notification_alert == 1) {
        //     await Tasks.update(
        //         { notification_alert: 0 },
        //         { where: { id: taskId, notification_alert: 1 } }
        //     );
        // }

        // Flatten documents from all task assignments
        taskResult.dataValues.documents = (taskResult.taskAssignments || []).flatMap(ta => ta.taskDocuments || []);
        delete taskResult.dataValues.taskAssignments;

        // Extract division from TaskType chain: task_type -> task_project_reference -> project_type -> project_request_reference -> request_type -> request_division_reference -> division
        let taskDivision = null;

        if (taskResult.TaskType && taskResult.TaskType.ProjectTypes && taskResult.TaskType.ProjectTypes.length > 0) {
            for (const projectType of taskResult.TaskType.ProjectTypes) {
                if (projectType.RequestTypes && projectType.RequestTypes.length > 0) {
                    for (const requestType of projectType.RequestTypes) {
                        if (requestType.Divisions && requestType.Divisions.length > 0) {
                            taskDivision = requestType.Divisions[0];
                            break;
                        }
                    }
                }
                if (taskDivision) break;
            }
        }
        taskResult.dataValues.division = taskDivision;

        // Also keep the division from RequestType (task's request_type_id) as fallback
        if (!taskDivision && taskResult.RequestType && taskResult.RequestType.Divisions && taskResult.RequestType.Divisions.length > 0) {
            taskDivision = taskResult.RequestType.Divisions[0];
            taskResult.dataValues.division = taskDivision;
        }

        // Add division to each assigned user
        if (taskResult.assignedUsers && taskResult.assignedUsers.length > 0) {
            taskResult.assignedUsers = taskResult.assignedUsers.map(user => {
                const userDivision = user.userDivisions && user.userDivisions.length > 0
                    ? user.userDivisions[0].division
                    : null;
                user.dataValues.division = userDivision;
                delete user.dataValues.userDivisions;
                return user;
            });
        }

        res.json({
            success: true,
            data: taskResult,
            message: 'Task details retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching task details:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch task details'
        });
    }
};

const acceptTask = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);
        const { start_date } = req.body;
        const user_id = req.user.id;

        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        // Check if task exists and is assigned to the user
        const task = await Tasks.findOne({
            where: { id: taskId, is_deleted: 0 },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: user_id },
                    attributes: [],
                    through: { attributes: [] },
                    required: true
                }
            ]
        });

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found or not assigned to you'
            });
        }

        // Check if intimate_team is 1
        if (task.intimate_team !== 1) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to accept this task'
            });
        }

        // Check if task is already accepted
        if (task.status === 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Task is already accepted'
            });
        }

        // Check if deadline is today or in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for date comparison
        const deadlineDate = new Date(task.deadline);
        deadlineDate.setHours(0, 0, 0, 0); // Set to start of day for date comparison

        const isDeadlineTodayOrFuture = deadlineDate >= today;
        const isDeadlineToday = deadlineDate.getTime() === today.getTime();

        // Validate start_date if provided
        if (start_date) {
            const providedStartDate = new Date(start_date);
            providedStartDate.setHours(0, 0, 0, 0);
            if (providedStartDate < today) {
                return res.status(400).json({
                    success: false,
                    error: 'Start date cannot be before today'
                });
            }
        }

        // Prepare update data
        const updateData = {
            status: 'accepted', // Default status
            notification_alert: 0 // Reset notification alert when task is accepted
        };

        // Set start_date automatically if deadline is today or in the future and no start_date provided
        if (isDeadlineTodayOrFuture && !start_date) {
            updateData.start_date = new Date();
        } else if (start_date) {
            updateData.start_date = start_date;

            // Check if the selected start date is today
            const providedStartDate = new Date(start_date);
            providedStartDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (providedStartDate.getTime() === today.getTime()) {
                updateData.status = 'in_progress'; // Set status to in_progress if start date is today
            }
        }

        // Update the task
        const [updatedRowsCount] = await Tasks.update(updateData, {
            where: { id: taskId }
        });

        if (updatedRowsCount === 0) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update task'
            });
        }

        await recordTaskHistory({
            req,
            taskId,
            workRequestId: task.work_request_id,
            action: 'accepted',
            previousData: task,
            nextData: updateData,
            previousStatus: task.status,
            newStatus: updateData.status,
            comments: 'Task accepted by assigned user',
            actorOverride: { ...req.user, actor_type: 'user' }
        });


        res.json({
            success: true,
            message: 'Task accepted successfully',
            data: {
                task_id: taskId,
                status: updateData.status,
                start_date: updateData.start_date || start_date || task.start_date
            }
        });
    } catch (error) {
        console.error('Error accepting task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to accept task'
        });
    }
};

const submitTask = async (req, res) => {
    try {
        const user_id = req.user.id;
        const {
            task_id,
            task_count,
            link,
            work_request_id,
            start_date,
            comments,
            // Content Work fields
            no_of_options_provided,
            no_of_words_written,
            options_submitted,
            concept_work,
            resize_work,
            no_of_concepts,
            // Duration fields
            duration_minutes,
            duration_seconds,
            // Shoot/Product work fields
            product_shoot,
            no_of_products_shot,
            shoot_setup,
            // Video/Web work fields
            no_of_resize,
            // Responsive work fields
            responsive_screen,
            no_of_responsive_screen,
            // Media count field
            no_of_images_videos_audio
        } = req.body;

        // Validate required parameters
        if (!task_id || !task_count) {
            return res.status(400).json({
                success: false,
                error: 'task_id and task_count are required'
            });
        }

        const taskId = parseInt(task_id, 10);
        const taskCount = parseInt(task_count, 10);
        const workRequestId = work_request_id ? parseInt(work_request_id, 10) : null;

        if (isNaN(taskId) || isNaN(taskCount)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task_id or task_count'
            });
        }

        if (workRequestId && isNaN(workRequestId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid work_request_id'
            });
        }

        // Get task assignment with task and work request details
        const taskAssignment = await TaskAssignments.findOne({
            where: { task_id: taskId, user_id },
            include: [
                {
                    model: Tasks,
                    include: [
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'priority', 'user_id', 'status'],
                            include: [
                                {
                                    model: RequestType,
                                    attributes: ['request_type']
                                },
                                {
                                    model: WorkRequestManagers,
                                    include: [
                                        {
                                            model: User,
                                            as: 'manager',
                                            attributes: ['id', 'name', 'email'],
                                            include: [{
                                                model: JobRole,
                                                attributes: ['id', 'role_title', 'level', 'description']
                                            }]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: User,
                    attributes: ['id', 'name', 'email']
                }
            ]
        });

        if (!taskAssignment) {
            return res.status(404).json({
                success: false,
                error: 'Task assignment not found or not assigned to you'
            });
        }

        const task = taskAssignment.Task;
        const workRequest = task.WorkRequest;
        const user = taskAssignment.User;

        // Validate work_request_id if provided
        if (workRequestId && workRequest.id !== workRequestId) {
            return res.status(400).json({
                success: false,
                error: `Provided work_request_id (${workRequestId}) does not match the task's work request (${workRequest.id})`
            });
        }

        // Validate that the work request belongs to the authenticated user
        // if (workRequest.user_id !== user_id) {
        //     return res.status(403).json({
        //         success: false,
        //         error: 'Unauthorized: This work request does not belong to you'
        //     });
        // }

        // Check if task status is accepted or in_progress
        if (task.status !== 'accepted' && task.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                error: `Task must be in accepted or in_progress status to submit. Current status: ${task.status}`
            });
        }

        // Update task with task_count and link FIRST
        const taskUpdateData = {
            task_count: taskCount,
            status: 'completed',
            review: 'pending',
            end_date: new Date(),
            review_stage: 'manager_review', // Set review_stage to manager_review when task is completed
            notification_alert: 1
        };

        // Add start_date if provided in request body
        let providedStartDate = null;
        if (start_date) {
            // Validate and parse the start_date
            const startDateObj = new Date(start_date);
            if (isNaN(startDateObj.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid start_date format. Use YYYY-MM-DD format.'
                });
            }
            providedStartDate = startDateObj;
            taskUpdateData.start_date = startDateObj;
        } else if (task.start_date) {
            // If no new start_date provided, use the existing one from the task
            providedStartDate = new Date(task.start_date);
        }

        // Validate that end_date is not before start_date
        if (providedStartDate) {
            const endDate = new Date(); // Current date/time when submitting
            endDate.setHours(0, 0, 0, 0); // Set to start of day for comparison
            const startDateOnly = new Date(providedStartDate);
            startDateOnly.setHours(0, 0, 0, 0);

            if (endDate < startDateOnly) {
                return res.status(400).json({
                    success: false,
                    error: 'End date cannot be before start date'
                });
            }
        }

        if (link) {
            taskUpdateData.link = link;
        }

        // Add comments if provided
        if (comments) {
            taskUpdateData.comments = comments;
        }

        // Add Content Work fields if provided
        if (no_of_options_provided !== undefined) {
            taskUpdateData.no_of_options_provided = parseInt(no_of_options_provided, 10) || 0;
        }
        if (no_of_words_written !== undefined) {
            taskUpdateData.no_of_words_written = parseInt(no_of_words_written, 10) || 0;
        }
        if (options_submitted !== undefined) {
            taskUpdateData.options_submitted = parseInt(options_submitted, 10) || 0;
        }
        if (concept_work !== undefined) {
            taskUpdateData.concept_work = concept_work === true || concept_work === 'true' || concept_work === 1 || concept_work === '1' ? 1 : 0;
        }
        if (resize_work !== undefined) {
            taskUpdateData.resize_work = resize_work === true || resize_work === 'true' || resize_work === 1 || resize_work === '1' ? 1 : 0;
        }
        if (no_of_concepts !== undefined) {
            taskUpdateData.no_of_concepts = parseInt(no_of_concepts, 10) || 0;
        }
        // Duration fields
        if (duration_minutes !== undefined) {
            taskUpdateData.duration_minutes = parseInt(duration_minutes, 10) || 0;
        }
        if (duration_seconds !== undefined) {
            taskUpdateData.duration_seconds = parseInt(duration_seconds, 10) || 0;
        }
        // Shoot/Product work fields
        if (product_shoot !== undefined) {
            taskUpdateData.product_shoot = product_shoot === true || product_shoot === 'true' || product_shoot === 1 || product_shoot === '1' ? 1 : 0;
        }
        if (no_of_products_shot !== undefined) {
            taskUpdateData.no_of_products_shot = parseInt(no_of_products_shot, 10) || 0;
        }
        if (shoot_setup !== undefined) {
            taskUpdateData.shoot_setup = shoot_setup === true || shoot_setup === 'true' || shoot_setup === 1 || shoot_setup === '1' ? 1 : 0;
        }
        // Video/Web work fields
        if (no_of_resize !== undefined) {
            taskUpdateData.no_of_resize = parseInt(no_of_resize, 10) || 0;
        }
        // Responsive work fields
        if (responsive_screen !== undefined) {
            taskUpdateData.responsive_screen = responsive_screen === true || responsive_screen === 'true' || responsive_screen === 1 || responsive_screen === '1' ? 1 : 0;
        }
        if (no_of_responsive_screen !== undefined) {
            taskUpdateData.no_of_responsive_screen = parseInt(no_of_responsive_screen, 10) || 0;
        }

        // Media count field
        if (no_of_images_videos_audio !== undefined) {
            taskUpdateData.no_of_images_videos_audio = parseInt(no_of_images_videos_audio, 10) || 0;
        }

        console.log(`Updating task ${taskId} to completed...`);
        const [affectedRows] = await Tasks.update(taskUpdateData, {
            where: { id: taskId }
        });
        console.log(`Task update result: ${affectedRows} rows affected`);

        const updatedTask = await Tasks.findByPk(taskId);
        console.log(`Task ${taskId} status after update: ${updatedTask?.status}`);

        // Handle file uploads
        const documents = [];
        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];

            // Create user folder with V1 structure if it doesn't exist
            const uploadDir = path.join(__dirname, '../../uploads');
            const sanitizedProjectName = workRequest.project_name.replace(/[^a-zA-Z0-9]/g, '_');
            const projectFolder = path.join(uploadDir, sanitizedProjectName);
            const taskFolder = path.join(projectFolder, task.task_name);
            const userFolder = path.join(taskFolder, user.name);
            const versionFolder = path.join(userFolder, 'V1');

            if (!fs.existsSync(versionFolder)) {
                fs.mkdirSync(versionFolder, { recursive: true });
            }

            for (const file of files) {
                // Generate unique filename for each file
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = file.name.replace(/[^a-zA-Z0-9.]/g, '_') + '-' + uniqueSuffix + path.extname(file.name);

                // Create unique temp directory for this file to avoid conflicts
                const tempDir = path.join('temp', 'uploads', uniqueSuffix);
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                // Save file to temp location
                const tempFilename = `${filename}`;
                const tempFilepath = path.join(tempDir, tempFilename);
                await file.mv(tempFilepath);

                const documentData = {
                    task_assignment_id: taskAssignment.id,
                    document_name: file.name,
                    document_path: `${process.env.BASE_ROUTE}/uploads/${sanitizedProjectName}/${task.task_name}/${user.name}/V1/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    status: 'uploading',
                    uploaded_at: new Date()
                };

                const docResult = await TaskDocuments.create(documentData);
                documents.push(docResult);

                // Move file synchronously instead of using queue
                try {
                    // Ensure V1 directory exists
                    if (!fs.existsSync(versionFolder)) {
                        fs.mkdirSync(versionFolder, { recursive: true });
                    }

                    const finalFilepath = path.join(versionFolder, filename);
                    fs.renameSync(tempFilepath, finalFilepath);

                    // Update document status to uploaded
                    await TaskDocuments.update(
                        { status: 'uploaded' },
                        { where: { id: docResult.id } }
                    );

                    // Clean up temp directory
                    try {
                        fs.rmdirSync(tempDir);
                    } catch (cleanupError) {
                        console.error('Failed to cleanup temp directory:', cleanupError);
                    }

                } catch (uploadError) {
                    console.error(`Failed to upload task file ${filename}:`, uploadError);

                    // Update document status to failed
                    await TaskDocuments.update(
                        { status: 'failed' },
                        { where: { id: docResult.id } }
                    );

                    // Clean up temp directory
                    try {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('Failed to cleanup temp directory on error:', cleanupError);
                    }

                    throw uploadError;
                }
            }
        }

        await recordTaskHistory({
            req,
            taskId,
            workRequestId: workRequest.id,
            action: 'submitted',
            previousData: task,
            nextData: taskUpdateData,
            previousStatus: task.status,
            newStatus: 'completed',
            previousReview: task.review,
            newReview: 'pending',
            previousReviewStage: task.review_stage,
            newReviewStage: 'manager_review',
            comments: comments || 'Task submitted by user',
            actorOverride: { ...req.user, actor_type: 'user' }
        });

        // Send email notification for task completion
        const completedAt = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const emailData = {
            project_name: workRequest.project_name,
            brand: workRequest.brand,
            request_type: workRequest.RequestType?.request_type || 'N/A',
            priority: workRequest.priority,
            request_id: workRequest.id,
            completed_at: completedAt,
            task_id: task.id,
            task_name: task.task_name,
            description: task.description,
            completed_by: user.name,
            task_count: taskCount,
            link: link || null,
            frontend_url: process.env.FRONTEND_URL
        };

        const html = renderTemplate('taskCompletionNotification', emailData);

        // Find the creative lead manager (assuming the first manager is the creative lead)
        const creativeLead = workRequest.WorkRequestManagers && workRequest.WorkRequestManagers.length > 0
            ? workRequest.WorkRequestManagers[0].manager
            : null;

        if (creativeLead) {
            const mailOptions = {
                to: creativeLead.email,
                cc: user.email,
                subject: 'Task Completed - D-Map',
                html
            };

            await sendMail(mailOptions);
        }

        res.json({
            success: true,
            data: {
                task_id: taskId,
                task_count: taskCount,
                link: link || null,
                documents: documents,
                work_request_id: workRequest.id
            },
            message: 'Task submitted successfully'
        });

    } catch (error) {
        console.error('Error submitting task:', error);

        // Return appropriate error response based on error type
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: error.errors.map(e => e.message)
            });
        }

        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({
                success: false,
                error: 'Invalid foreign key reference'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to submit task'
        });
    }
};

const getTaskDocuments = async (req, res) => {
    try {
        const user_id = req.user.id;
        const taskId = parseInt(req.params.task_id, 10);

        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        // Check if task exists and is assigned to the user
        const taskAssignment = await TaskAssignments.findOne({
            where: { task_id: taskId, user_id },
            attributes: ['id'],
            include: [
                {
                    model: Tasks,
                    attributes: ['id', 'status']
                }
            ]
        });

        if (!taskAssignment) {
            return res.status(404).json({
                success: false,
                error: 'Task not found or not assigned to you'
            });
        }

        const task = taskAssignment.Task;

        // Check if task status is accepted
        if (task.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Task must be in accepted status to view documents'
            });
        }

        // Get all documents for this task assignment
        const documents = await TaskDocuments.findAll({
            where: { task_assignment_id: taskAssignment.id },
            order: [['uploaded_at', 'DESC']]
        });


        res.json({
            success: true,
            data: documents,
            message: 'Task documents retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching task documents:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch task documents'
        });
    }
};

const deleteTaskDocument = async (req, res) => {
    try {
        const user_id = req.user.id;
        const documentId = parseInt(req.params.document_id, 10);

        if (isNaN(documentId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid document ID'
            });
        }

        // Find the document and check ownership through task assignment
        const document = await TaskDocuments.findOne({
            where: { id: documentId },
            include: [
                {
                    model: TaskAssignments,
                    where: { user_id },
                    attributes: ['id'],
                    required: true,
                    include: [
                        {
                            model: Tasks,
                            where: { is_deleted: 0 },
                            attributes: ['id', 'status']
                        }
                    ]
                }
            ]
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                error: 'Document not found or not authorized to delete'
            });
        }

        const task = document.TaskAssignments[0]?.Task;

        // Check if task exists (not soft-deleted)
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task no longer exists'
            });
        }

        // Check if task status is accepted
        if (task.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Task must be in accepted status to delete documents'
            });
        }

        // Delete the physical file if it exists
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '../../', document.document_path);

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (fileError) {
            console.error('Error deleting file:', fileError);
            // Continue with database deletion even if file deletion fails
        }

        // Delete from database
        await TaskDocuments.destroy({
            where: { id: documentId }
        });

        await recordTaskHistory({
            req,
            taskId: task.id,
            workRequestId: task.work_request_id,
            action: 'document_deleted',
            previousData: document,
            comments: 'Task document deleted by user'
        });


        res.json({
            success: true,
            message: 'Document deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting task document:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to delete task document'
        });
    }
};

const getMyTeamTasks = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Check if user is in department 9
        const isInDepartment9 = req.user.department && req.user.department.id === 9;
        if (!isInDepartment9) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. This endpoint is only available for department 9 users.'
            });
        }

        // Get user's divisions
        const userDivisions = await UserDivisions.findAll({
            where: { user_id: user_id },
            attributes: ['division_id']
        });

        if (userDivisions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No divisions found for the user.'
            });
        }

        const divisionIds = userDivisions.map(ud => ud.division_id);

        // Get all users in these divisions
        const divisionUsers = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: divisionIds } },
            include: [{
                model: User,
                attributes: ['id']
            }],
            attributes: []
        });

        const userIds = divisionUsers.map(du => du.User.id);

        // Get in_progress tasks assigned to these users
        const tasks = await Tasks.findAll({
            where: {
                status: 'in_progress',
                is_deleted: 0
            },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: { [Op.in]: userIds } },
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
                    attributes: ['id', 'project_name', 'brand', 'priority', 'status'],
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
                                    attributes: ['id', 'name', 'email'],
                                    include: [{
                                        model: JobRole,
                                        attributes: ['id', 'role_title', 'level', 'description']
                                    }]
                                }
                            ]
                        }
                    ]
                }
            ],
            attributes: { exclude: ['created_at', 'updated_at'] },
            order: [['deadline', 'ASC']]
        });

        // Collect all unique user IDs from assigned users
        const allAssignedUserIds = [...new Set(tasks.flatMap(task => task.assignedUsers.map(user => user.id)))];

        // Get task counts for these users
        let userTaskCounts = {};
        if (allAssignedUserIds.length > 0) {
            // Get accepted tasks count
            const acceptedCounts = await TaskAssignments.findAll({
                where: { user_id: { [Op.in]: allAssignedUserIds } },
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
                where: { user_id: { [Op.in]: allAssignedUserIds } },
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

        // Add task counts to assigned users in tasks
        tasks.forEach(task => {
            task.assignedUsers.forEach(user => {
                const counts = userTaskCounts[user.id] || { accepted: 0, in_progress: 0 };
                user.dataValues.acceptedTasksCount = counts.accepted;
                user.dataValues.inProgressTasksCount = counts.in_progress;
            });
        });


        res.json({
            success: true,
            data: tasks,
            message: 'My team tasks retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching my team tasks:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch my team tasks'
        });
    }
};

// Get issues assigned to the user (from issue_user_assignments)
const getAssignedIssues = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { status, sort } = req.query;

        // Get issue_user_assignments for this user
        const userIssueAssignments = await IssueUserAssignments.findAll({
            where: { user_id: user_id },
            attributes: ['issue_assignment_id']
        });

        const issueAssignmentIds = userIssueAssignments.map(ua => ua.issue_assignment_id);

        if (issueAssignmentIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'No issues assigned to you'
            });
        }

        // Build where condition
        let whereCondition = {
            id: { [Op.in]: issueAssignmentIds },
            is_deleted: 0
        };

        // Apply status filter
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());
            const validStatuses = ['m_pending', 'u_pending', 'm_accepted', 'u_accepted', 'in_progress', 'completed', 'rejected', 'on_hold', 'cancelled'];
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
            }
        } else {
            // Default: show u_pending issues
            whereCondition.status = 'u_pending';
        }

        // Get issue assignments with full details
        const issueAssignments = await IssueAssignments.findAll({
            where: whereCondition,
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version'],
                    include: [
                        { model: RequestType, attributes: ['id', 'request_type', 'description'] },
                        { model: TaskType, attributes: ['id', 'task_type', 'description'] },
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'priority', 'status'],
                            include: [
                                { model: User, as: 'users', attributes: ['id', 'name', 'email'] },
                                {
                                    model: WorkRequestManagers,
                                    include: [{ model: User, as: 'manager', attributes: ['id', 'name', 'email'] }]
                                }
                            ]
                        }
                    ]
                },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email'] },
                { model: IssueAssignmentTypes, as: 'issueTypeLinks', include: [{ model: IssueRegister, as: 'issueRegister' }] },
                { model: IssueUserAssignments, as: 'userAssignments', where: { user_id: user_id }, attributes: ['id'] }
            ]
        });

        // Get all unique work request IDs to fetch all task assignments
        const workRequestIds = [...new Set(issueAssignments.map(ia => ia.task?.work_request_id).filter(Boolean))];

        // Get all task assignments for these work requests
        let allTaskAssignments = {};
        if (workRequestIds.length > 0) {
            const tasksWithAssignments = await Tasks.findAll({
                where: { work_request_id: { [Op.in]: workRequestIds }, is_deleted: 0 },
                include: [{ model: TaskAssignments, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }]
            });

            tasksWithAssignments.forEach(task => {
                allTaskAssignments[task.id] = task.TaskAssignments || [];
            });
        }

        const result = issueAssignments.map(ia => {
            // Get manager who sent the request (first manager)
            const manager = ia.task?.WorkRequest?.WorkRequestManagers?.[0]?.manager || null;

            // Get client who created the work request
            const client = ia.task?.WorkRequest?.users || null;

            // Get all managers for this work request
            const managers = ia.task?.WorkRequest?.WorkRequestManagers?.map(m => m.manager).filter(Boolean) || [];

            // Get task assignments for this task
            const taskAssignments = allTaskAssignments[ia.task_id] || [];

            return {
                issue: {
                    id: ia.id,
                    issue_id: ia.issue_id,
                    version: ia.version,
                    description: ia.description,
                    deadline: ia.deadline,
                    start_date: ia.start_date,
                    end_date: ia.end_date,
                    link: ia.link,
                    task_count: ia.task_count,
                    status: ia.status,
                    review: ia.review,
                    review_stage: ia.review_stage,
                    intimate_team: ia.intimate_team,
                    intimate_client: ia.intimate_client,
                    notification_alert: ia.notification_alert,
                    created_at: ia.created_at,
                    updated_at: ia.updated_at
                },
                request_info: {
                    client: client ? { id: client.id, name: client.name, email: client.email } : null,
                    managers: managers.map(m => ({ id: m.id, name: m.name, email: m.email })),
                    assigned_to: taskAssignments.map(ta => ({
                        id: ta.User.id,
                        name: ta.User.name,
                        email: ta.User.email
                    }))
                },
                task: ia.task ? {
                    id: ia.task.id,
                    task_name: ia.task.task_name,
                    description: ia.task.description,
                    request_type: ia.task.RequestType ? ia.task.RequestType.request_type : null,
                    task_type: ia.task.TaskType ? ia.task.TaskType.task_type : null,
                    work_request: ia.task.WorkRequest ? {
                        id: ia.task.WorkRequest.id,
                        project_name: ia.task.WorkRequest.project_name,
                        brand: ia.task.WorkRequest.brand,
                        priority: ia.task.WorkRequest.priority,
                        status: ia.task.WorkRequest.status
                    } : null,
                    deadline: ia.task.deadline,
                    status: ia.task.status,
                    version: ia.task.version
                } : null,
                issue_types: ia.issueTypeLinks ? ia.issueTypeLinks.map(itl => ({
                    id: itl.id,
                    issue_register_id: itl.issue_register_id,
                    change_issue_type: itl.issueRegister ? itl.issueRegister.change_issue_type : null,
                    description: itl.issueRegister ? itl.issueRegister.description : null,
                    quantification: itl.issueRegister ? itl.issueRegister.quantification : null
                })) : [],
                requester: ia.requester ? { id: ia.requester.id, name: ia.requester.name, email: ia.requester.email } : null
            };
        });

        // Calculate total notification count: count of issue assignments with notification_alert = 1
        const totalNotificationAlert = issueAssignments.filter(ia => ia.notification_alert == 1).length;

        res.json({
            success: true,
            data: result,
            notification_alert_count: totalNotificationAlert,
            message: 'Assigned issues retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching assigned issues:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch assigned issues'
        });
    }
};

// Accept an issue
const acceptIssue = async (req, res) => {
    try {
        const issueId = parseInt(req.params.issueId, 10);
        const { start_date } = req.body;
        const user_id = req.user.id;

        if (isNaN(issueId)) {
            return res.status(400).json({ success: false, error: 'Invalid issue ID' });
        }

        // Check if issue exists and is assigned to the user
        const userIssueAssignment = await IssueUserAssignments.findOne({
            where: { issue_assignment_id: issueId, user_id: user_id }
        });

        if (!userIssueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue not found or not assigned to you' });
        }

        // Get the issue assignment with task
        const issueAssignment = await IssueAssignments.findByPk(issueId, {
            include: [
                { model: Tasks, as: 'task', attributes: ['id', 'work_request_id'] }
            ]
        });

        if (!issueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue assignment not found' });
        }

        // Check if intimate_team is 1
        if (issueAssignment.intimate_team !== 1) {
            return res.status(403).json({ success: false, error: 'You do not have permission to accept this issue' });
        }

        const taskId = issueAssignment.task?.id || null;
        const workRequestId = issueAssignment.task?.work_request_id || null;

        // Check if issue is already accepted or in progress
        if (issueAssignment.status === 'u_accepted' || issueAssignment.status === 'in_progress') {
            return res.status(400).json({ success: false, error: 'Issue is already accepted or in progress' });
        }

        if (issueAssignment.status === 'completed') {
            return res.status(400).json({ success: false, error: 'Issue is already completed' });
        }

        // Validate start_date if provided
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let providedStartDate = null;
        if (start_date) {
            providedStartDate = new Date(start_date);
            providedStartDate.setHours(0, 0, 0, 0);
            if (providedStartDate < today) {
                return res.status(400).json({ success: false, error: 'Start date cannot be before today' });
            }
        }

        // Determine status based on start_date
        // If start_date is today -> in_progress
        // If start_date is in the future -> u_accepted
        let newStatus = 'in_progress';
        let finalStartDate = null;

        if (providedStartDate) {
            // Check if start_date is today or in the future
            const isToday = providedStartDate.getTime() === today.getTime();

            if (isToday) {
                newStatus = 'in_progress';
                finalStartDate = providedStartDate;
            } else {
                // Future date
                newStatus = 'u_accepted';
                finalStartDate = providedStartDate;
            }
        } else {
            // No start_date provided, default to today -> in_progress
            finalStartDate = today;
            newStatus = 'in_progress';
        }

        // Prepare update data
        const updateData = {
            status: newStatus,
            start_date: finalStartDate,
            notification_alert: 0
        };

        // Update the issue assignment
        await IssueAssignments.update(updateData, { where: { id: issueId } });

        await recordIssueHistory({
            req,
            issueAssignmentId: issueId,
            taskId,
            workRequestId,
            action: 'accepted',
            previousData: issueAssignment,
            nextData: updateData,
            previousStatus: issueAssignment.status,
            newStatus,
            comments: 'Issue accepted by assigned user'
        });

        res.json({
            success: true,
            message: newStatus === 'in_progress' ? 'Issue accepted and started successfully' : 'Issue accepted successfully (scheduled for future start)',
            data: {
                issue_id: issueId,
                task_id: taskId,
                work_request_id: workRequestId,
                status: updateData.status,
                start_date: updateData.start_date
            }
        });
    } catch (error) {
        console.error('Error accepting issue:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to accept issue' });
    }
};

// Submit/complete an issue
const submitIssue = async (req, res) => {
    try {
        const issueId = parseInt(req.params.issueId, 10);
        const {
            link,
            description,
            task_count,
            comments,
            // Content Work fields
            no_of_options_provided,
            no_of_words_written,
            options_submitted,
            concept_work,
            resize_work,
            no_of_concepts,
            // Duration fields
            duration_minutes,
            duration_seconds,
            // Shoot/Product work fields
            product_shoot,
            no_of_products_shot,
            shoot_setup,
            // Video/Web work fields
            no_of_resize,
            // Responsive work fields
            responsive_screen,
            no_of_responsive_screen,
            // Media count field
            no_of_images_videos_audio
        } = req.body;
        const user_id = req.user.id;

        if (isNaN(issueId)) {
            return res.status(400).json({ success: false, error: 'Invalid issue ID' });
        }

        // Check if issue exists and is assigned to the user
        const userIssueAssignment = await IssueUserAssignments.findOne({
            where: { issue_assignment_id: issueId, user_id: user_id }
        });

        if (!userIssueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue not found or not assigned to you' });
        }

        // Get the issue assignment with full details
        const issueAssignment = await IssueAssignments.findByPk(issueId, {
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    include: [
                        {
                            model: WorkRequests,
                            attributes: ['id', 'project_name', 'brand', 'priority', 'user_id', 'status'],
                            include: [
                                { model: RequestType, attributes: ['request_type'] },
                                {
                                    model: WorkRequestManagers,
                                    include: [
                                        {
                                            model: User,
                                            as: 'manager',
                                            attributes: ['id', 'name', 'email'],
                                            include: [{
                                                model: JobRole,
                                                attributes: ['id', 'role_title', 'level', 'description']
                                            }]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                { model: User, as: 'requester', attributes: ['id', 'name', 'email'] },
                { model: IssueAssignmentTypes, as: 'issueTypeLinks', include: [{ model: IssueRegister, as: 'issueRegister' }] }
            ]
        });

        if (!issueAssignment) {
            return res.status(404).json({ success: false, error: 'Issue assignment not found' });
        }

        const task = issueAssignment.task;
        const workRequest = task ? task.WorkRequest : null;

        // Check if issue is ready to submit
        if (issueAssignment.status !== 'u_accepted' && issueAssignment.status !== 'in_progress') {
            return res.status(400).json({ success: false, error: 'Issue must be u_accepted or in_progress to submit' });
        }

        // Update issue with task_count, link, description FIRST
        const issueUpdateData = {
            status: 'completed',
            end_date: new Date(),
            review: 'pending',
            review_stage: 'manager_review', // Set review_stage to manager_review when issue is completed
            link: link || issueAssignment.link,
            description: description || issueAssignment.description,
            notification_alert: 1
        };

        // Validate that end_date is not before start_date
        // const existingStartDate = issueAssignment.start_date;
        // if (existingStartDate) {
        //     const endDate = new Date(); // Current date/time when submitting
        //     endDate.setHours(0, 0, 0, 0); // Set to start of day for comparison
        //     const startDateOnly = new Date(existingStartDate);
        //     startDateOnly.setHours(0, 0, 0, 0);

        //     if (endDate < startDateOnly) {
        //         return res.status(400).json({
        //             success: false,
        //             error: 'End date cannot be before start date'
        //         });
        //     }
        // }

        if (task_count) {
            issueUpdateData.task_count = parseInt(task_count, 10);
        }

        // Add comments if provided
        if (comments) {
            issueUpdateData.comments = comments;
        }

        // Add Content Work fields if provided
        if (no_of_options_provided !== undefined) {
            issueUpdateData.no_of_options_provided = parseInt(no_of_options_provided, 10) || 0;
        }
        if (no_of_words_written !== undefined) {
            issueUpdateData.no_of_words_written = parseInt(no_of_words_written, 10) || 0;
        }
        if (options_submitted !== undefined) {
            issueUpdateData.options_submitted = parseInt(options_submitted, 10) || 0;
        }
        if (concept_work !== undefined) {
            issueUpdateData.concept_work = concept_work === true || concept_work === 'true' || concept_work === 1 || concept_work === '1' ? 1 : 0;
        }
        if (resize_work !== undefined) {
            issueUpdateData.resize_work = resize_work === true || resize_work === 'true' || resize_work === 1 || resize_work === '1' ? 1 : 0;
        }
        if (no_of_concepts !== undefined) {
            issueUpdateData.no_of_concepts = parseInt(no_of_concepts, 10) || 0;
        }
        // Duration fields
        if (duration_minutes !== undefined) {
            issueUpdateData.duration_minutes = parseInt(duration_minutes, 10) || 0;
        }
        if (duration_seconds !== undefined) {
            issueUpdateData.duration_seconds = parseInt(duration_seconds, 10) || 0;
        }
        // Shoot/Product work fields
        if (product_shoot !== undefined) {
            issueUpdateData.product_shoot = product_shoot === true || product_shoot === 'true' || product_shoot === 1 || product_shoot === '1' ? 1 : 0;
        }
        if (no_of_products_shot !== undefined) {
            issueUpdateData.no_of_products_shot = parseInt(no_of_products_shot, 10) || 0;
        }
        if (shoot_setup !== undefined) {
            issueUpdateData.shoot_setup = shoot_setup === true || shoot_setup === 'true' || shoot_setup === 1 || shoot_setup === '1' ? 1 : 0;
        }
        // Video/Web work fields
        if (no_of_resize !== undefined) {
            issueUpdateData.no_of_resize = parseInt(no_of_resize, 10) || 0;
        }
        // Responsive work fields
        if (responsive_screen !== undefined) {
            issueUpdateData.responsive_screen = responsive_screen === true || responsive_screen === 'true' || responsive_screen === 1 || responsive_screen === '1' ? 1 : 0;
        }
        if (no_of_responsive_screen !== undefined) {
            issueUpdateData.no_of_responsive_screen = parseInt(no_of_responsive_screen, 10) || 0;
        }

        // Media count field
        if (no_of_images_videos_audio !== undefined) {
            issueUpdateData.no_of_images_videos_audio = parseInt(no_of_images_videos_audio, 10) || 0;
        }

        console.log(`Updating issue ${issueId} to completed...`);
        const [affectedRows] = await IssueAssignments.update(issueUpdateData, {
            where: { id: issueId }
        });
        console.log(`Issue update result: ${affectedRows} rows affected`);

        // Handle file uploads for issue documents
        const documents = [];
        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];

            // Create user folder with version structure if it doesn't exist
            const uploadDir = path.join(__dirname, '../../uploads');
            const sanitizedProjectName = workRequest ? workRequest.project_name.replace(/[^a-zA-Z0-9]/g, '_') : 'Issue';
            const projectFolder = path.join(uploadDir, sanitizedProjectName);
            const taskFolder = task ? path.join(projectFolder, task.task_name) : path.join(projectFolder, 'Issue_' + issueId);
            const userFolder = path.join(taskFolder, req.user.name);
            const versionFolder = path.join(userFolder, issueAssignment.version || 'V1');

            if (!fs.existsSync(versionFolder)) {
                fs.mkdirSync(versionFolder, { recursive: true });
            }

            for (const file of files) {
                // Generate unique filename for each file
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = file.name.replace(/[^a-zA-Z0-9.]/g, '_') + '-' + uniqueSuffix + path.extname(file.name);

                // Create unique temp directory for this file to avoid conflicts
                const tempDir = path.join('temp', 'uploads', uniqueSuffix);
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                // Save file to temp location
                const tempFilename = `${filename}`;
                const tempFilepath = path.join(tempDir, tempFilename);
                await file.mv(tempFilepath);

                const documentData = {
                    issue_user_assignment_id: userIssueAssignment.id,
                    document_name: file.name,
                    document_path: `${process.env.BASE_ROUTE}/uploads/${sanitizedProjectName}/${task ? task.task_name : 'Issue_' + issueId}/${req.user.name}/${issueAssignment.version || 'V1'}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    version: issueAssignment.version || 'V1',
                    status: 'uploading',
                    uploaded_at: new Date()
                };

                const docResult = await IssueDocuments.create(documentData);
                documents.push(docResult);

                // Move file synchronously instead of using queue
                try {
                    // Ensure version directory exists
                    if (!fs.existsSync(versionFolder)) {
                        fs.mkdirSync(versionFolder, { recursive: true });
                    }

                    const finalFilepath = path.join(versionFolder, filename);
                    fs.renameSync(tempFilepath, finalFilepath);

                    // Update document status to uploaded
                    await IssueDocuments.update(
                        { status: 'uploaded' },
                        { where: { id: docResult.id } }
                    );

                    // Clean up temp directory
                    try {
                        fs.rmdirSync(tempDir);
                    } catch (cleanupError) {
                        console.error('Failed to cleanup temp directory:', cleanupError);
                    }

                } catch (uploadError) {
                    console.error(`Failed to upload issue file ${filename}:`, uploadError);

                    // Update document status to failed
                    await IssueDocuments.update(
                        { status: 'failed' },
                        { where: { id: docResult.id } }
                    );

                    // Clean up temp directory
                    try {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('Failed to cleanup temp directory on error:', cleanupError);
                    }

                    throw uploadError;
                }
            }
        }

        await recordIssueHistory({
            req,
            issueAssignmentId: issueId,
            taskId: task?.id,
            workRequestId: workRequest?.id,
            action: 'submitted',
            previousData: issueAssignment,
            nextData: issueUpdateData,
            previousStatus: issueAssignment.status,
            newStatus: 'completed',
            previousReview: issueAssignment.review,
            newReview: 'pending',
            previousReviewStage: issueAssignment.review_stage,
            newReviewStage: 'manager_review',
            comments: comments || 'Issue submitted by user'
        });

        // Get user details for email
        const user = await User.findByPk(user_id, { attributes: ['id', 'name', 'email'] });

        // Send email notification for issue completion to the issue's manager(s)
        const completedAt = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Get the issue's requester (manager who created the issue)
        const issueRequester = issueAssignment.requester;

        // Collect all unique manager emails from:
        // 1. Issue requester (the manager who created the issue)
        // 2. All work request managers
        const managerEmails = new Set();

        // Add issue requester email if exists
        if (issueRequester && issueRequester.email) {
            managerEmails.add(issueRequester.email);
        }

        // Add all work request managers
        if (workRequest && workRequest.WorkRequestManagers) {
            workRequest.WorkRequestManagers.forEach(wrm => {
                if (wrm.manager && wrm.manager.email) {
                    managerEmails.add(wrm.manager.email);
                }
            });
        }

        // Get issue type details for email
        const issueRegisters = issueAssignment.issueTypeLinks ? issueAssignment.issueTypeLinks.map(itl => ({
            change_issue_type: itl.issueRegister ? itl.issueRegister.change_issue_type : null,
            description: itl.issueRegister ? itl.issueRegister.description : null,
            quantification: itl.issueRegister ? itl.issueRegister.quantification : null
        })) : [];

        // Get task type if available
        let taskType = 'N/A';
        if (task && task.TaskType) {
            taskType = task.TaskType.task_type;
        } else if (issueAssignment.issueTypeLinks && issueAssignment.issueTypeLinks.length > 0) {
            // Try to get from first issue type link
            taskType = issueAssignment.issueTypeLinks[0].issueRegister?.change_issue_type || 'Issue';
        }

        if (managerEmails.size > 0) {
            // Prepare email data for issueAssignmentNotification template
            const emailData = {
                manager_name: issueRequester ? issueRequester.name : 'Manager',
                task_id: task ? task.id : null,
                task_name: task ? task.task_name : 'Issue ' + issueAssignment.version,
                issue_id: issueAssignment.id,
                task_type: taskType,
                project_name: workRequest ? workRequest.project_name : 'N/A',
                brand: workRequest ? workRequest.brand : 'N/A',
                priority: workRequest ? workRequest.priority : 'N/A',
                request_type: workRequest?.RequestType?.request_type || 'N/A',
                issue_version: issueAssignment.version || 'V1',
                assigned_by: issueRequester ? issueRequester.name : 'System',
                created_at: completedAt,
                issue_description: description || issueAssignment.description || 'No description provided',
                issue_registers: issueRegisters,
                assigned_users: [{ name: user.name, email: user.email }],
                frontend_url: process.env.FRONTEND_URL
            };

            const html = renderTemplate('issueAssignmentNotification', emailData);

            // Convert Set to array and take first as TO, rest as CC
            const emailArray = Array.from(managerEmails);
            const toEmail = emailArray[0];
            const ccEmails = emailArray.slice(1);

            const mailOptions = {
                to: toEmail,
                cc: ccEmails.length > 0 ? ccEmails.join(',') : undefined,
                subject: 'Issue Completed - D-Map',
                html
            };

            await sendMail(mailOptions);
        }

        res.json({
            success: true,
            data: {
                issue_id: issueId,
                task_count: task_count || issueAssignment.task_count || 0,
                link: link || null,
                documents: documents,
                work_request_id: workRequest ? workRequest.id : null
            },
            message: 'Issue submitted successfully'
        });

    } catch (error) {
        console.error('Error submitting issue:', error);

        // Return appropriate error response based on error type
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: error.errors.map(e => e.message)
            });
        }

        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({
                success: false,
                error: 'Invalid foreign key reference'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to submit issue'
        });
    }
};

const getUserTaskHistory = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        const limit = parseInt(req.query.limit, 10) || 200;
        const offset = parseInt(req.query.offset, 10) || 0;
        const history = await getTaskHistoryRecords(taskId, { limit, offset });

        res.json({
            success: true,
            data: history,
            message: 'Task history retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching task history:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch task history' });
    }
};

const getUserIssueHistory = async (req, res) => {
    try {
        const issueAssignmentId = parseInt(req.params.issueAssignmentId, 10);
        if (isNaN(issueAssignmentId)) {
            return res.status(400).json({ success: false, error: 'Invalid issue assignment ID' });
        }

        const limit = parseInt(req.query.limit, 10) || 200;
        const offset = parseInt(req.query.offset, 10) || 0;
        const history = await getIssueHistoryRecords(issueAssignmentId, { limit, offset });

        res.json({
            success: true,
            data: history,
            message: 'Issue history retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue history:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch issue history' });
    }
};

module.exports = {
    getAssignedTasks,
    getMyTeamTasks,
    getTaskById,
    assignTaskToUser,
    acceptTask,
    submitTask,
    getTaskDocuments,
    deleteTaskDocument,
    // Issue functions
    getAssignedIssues,
    acceptIssue,
    submitIssue,
    getUserTaskHistory,
    getUserIssueHistory
};