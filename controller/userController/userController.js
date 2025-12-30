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
    UserDivisions
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const path = require('path');
const fs = require('fs');
require('dotenv').config();


const getAssignedTasks = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { status } = req.query; // Get status filter from query params

        // Check if user is manager (job_role_id = 2)
        const isManager = req.user.jobRole && req.user.jobRole.id === 2;

        let userIds = [user_id]; // Start with current user

        if (isManager) {
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
            // Check if user is in department 9
            const isInDepartment9 = req.user.department && req.user.department.id === 9;
            if (!isInDepartment9) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. This endpoint is only available for department 9 users or managers.'
                });
            }
        }

        // Build where condition
        let whereCondition = {};

        // Apply filters
        if (req.filters) {
            whereCondition = { ...whereCondition, ...req.filters };
        }

        // Apply search (only for text fields to avoid date parsing issues)
        if (req.search.term && req.search.fields.length > 0) {
            const textFields = req.search.fields.filter(field => !['deadline', 'created_at', 'updated_at'].includes(field));
            if (textFields.length > 0) {
                whereCondition[Op.or] = textFields.map(field => ({
                    [field]: { [Op.like]: `%${req.search.term}%` }
                }));
            }
        }

        // Handle multiple comma-separated status values
        if (status) {
            const statusArray = status.split(',').map(s => s.trim());
            
            // Validate status values
            const validStatuses = ['pending', 'accepted', 'in_progress', 'completed'];
            const invalidStatuses = statusArray.filter(s => !validStatuses.includes(s));
            
            if (invalidStatuses.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
                });
            }
            
            // If multiple statuses, use OR condition
            if (statusArray.length > 1) {
                whereCondition.status = { [Op.in]: statusArray };
            } else {
                // Single status
                whereCondition.status = statusArray[0];
                
                // For pending status, also require intimate_team = 1
                if (statusArray[0] === 'pending') {
                    whereCondition.intimate_team = 1;
                }
            }
        } else {
            // Default: show pending tasks (not yet accepted)
            whereCondition.status = 'pending';
            whereCondition.intimate_team = 1;
        }

        // Get tasks assigned to the user(s) through TaskAssignments junction table
        const tasks = await Tasks.findAll({
            where: whereCondition,
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
                                    attributes: ['id', 'name', 'email']
                                }
                            ]
                        }
                    ]
                }
            ],
            attributes: { exclude: ['created_at', 'updated_at'] },
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['deadline', 'ASC']] // Sort by deadline ascending by default
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
                            attributes: ['id', 'name', 'email']
                        }
                    ]
                }
            ]
        });

        if (!workRequest) {
            return res.status(404).json({ success: false, error: 'Work request not found' });
        }
        
        // Check if work request is accepted
        if (workRequest.status !== 'accepted' && workRequest.status !== 'in-progress' && workRequest.status !== 'assigned') {
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

        // Create new task assignment for the user
        await TaskAssignments.create({
            task_id: taskId,
            user_id: userId
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

        // Update intimate_team to 1
        await Tasks.update(
            { intimate_team: 1 },
            { where: { id: taskId } }
        );


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

        // Get single task with full details - only if assigned to current user and intimate_team = 1
        let userIds = [req.user.id]; // Start with current user

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
            }
        }

        const taskResult = await Tasks.findOne({
            where: { id: taskId, intimate_team: 1 },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: { [Op.in]: userIds } }, // Allow current user or team members for managers
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: ['created_at'] },
                    required: true // This ensures the task must be assigned to the user or their team
                },
                {
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description']
                },
                {
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description', 'quantification']
                },
                {
                    model: WorkRequests,
                    attributes: ['id', 'project_name', 'brand', 'priority', 'status', 'created_at'],
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
            attributes: { exclude: ['created_at', 'updated_at'] }
        });

        if (!taskResult) {
            return res.status(404).json({ success: false, error: 'Task not found' });
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
            where: { id: taskId },
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
            status: isDeadlineToday ? 'in_progress' : 'accepted'
        };

        // Set start_date automatically if deadline is today or in the future and no start_date provided
        if (isDeadlineTodayOrFuture && !start_date) {
            updateData.start_date = new Date();
        } else if (start_date) {
            updateData.start_date = start_date;
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
        const { task_id, task_count, link } = req.body;

        if (!task_id || !task_count) {
            return res.status(400).json({
                success: false,
                error: 'task_id and task_count are required'
            });
        }

        const taskId = parseInt(task_id, 10);
        const taskCount = parseInt(task_count, 10);

        if (isNaN(taskId) || isNaN(taskCount)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task_id or task_count'
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
                            attributes: ['id', 'project_name', 'brand', 'priority'],
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
                                            attributes: ['id', 'name', 'email']
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

        // Check if task status is accepted
        if (task.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                error: 'Task must be in accepted status to submit'
            });
        }

        const workRequest = task.WorkRequest;
        const user = taskAssignment.User;

        // Update task with task_count and link
        const taskUpdateData = {
            task_count: taskCount
        };

        if (link) {
            taskUpdateData.link = link;
        }

        await Tasks.update(taskUpdateData, {
            where: { id: taskId }
        });

        // Handle file uploads
        const documents = [];
        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];

            // Create user folder if it doesn't exist
            const uploadDir = path.join(__dirname, '../../uploads');
            const sanitizedProjectName = workRequest.project_name.replace(/[^a-zA-Z0-9]/g, '_');
            const projectFolder = path.join(uploadDir, sanitizedProjectName);
            const taskFolder = path.join(projectFolder, task.task_name);
            const userFolder = path.join(taskFolder, user.name);

            if (!fs.existsSync(userFolder)) {
                fs.mkdirSync(userFolder, { recursive: true });
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
                    document_path: `${process.env.BASE_ROUTE}/uploads/${sanitizedProjectName}/${task.task_name}/${user.name}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    status: 'uploading',
                    uploaded_at: new Date()
                };

                const docResult = await TaskDocuments.create(documentData);
                documents.push(docResult);

                // Move file synchronously instead of using queue
                try {

                    // Ensure upload directory exists
                    if (!fs.existsSync(userFolder)) {
                        fs.mkdirSync(userFolder, { recursive: true });
                    }

                    const finalFilepath = path.join(userFolder, filename);
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

        // Update task status to completed if files were uploaded or link provided
        let taskCompleted = false;
        if ((documents.length > 0 || link) && task.status !== 'completed') {
            await Tasks.update(
                { status: 'completed', end_date: new Date() },
                { where: { id: task.id } }
            );
            taskCompleted = true;
        }

        // Send email notification if task was completed
        if (taskCompleted) {
            const workRequest = task.WorkRequest;
            const completedBy = taskAssignment.User;

            // Find the creative lead manager (assuming the first manager is the creative lead)
            const creativeLead = workRequest.WorkRequestManagers && workRequest.WorkRequestManagers.length > 0
                ? workRequest.WorkRequestManagers[0].manager
                : null;

            if (creativeLead) {
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
                    task_name: task.task_name,
                    description: task.description,
                    completed_by: completedBy.name,
                    task_count: taskCount,
                    link: link || null,
                    frontend_url: process.env.FRONTEND_URL
                };

                const html = renderTemplate('taskCompletionNotification', emailData);

                const mailOptions = {
                    to: creativeLead.email,
                    cc: completedBy.email,
                    subject: 'Task Completed - D-Map',
                    html
                };

                await sendMail(mailOptions);
            }
        }


        res.json({
            success: true,
            data: {
                task_id: taskId,
                task_count: taskCount,
                link: link || null,
                documents: documents
            },
            message: 'Task submitted successfully'
        });
    } catch (error) {
        console.error('Error submitting task:', error);
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

        // Check if task status is accepted
        if (!task || task.status !== 'accepted') {
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
                status: 'in_progress'
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
                                    attributes: ['id', 'name', 'email']
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

module.exports = {
    getAssignedTasks,
    getMyTeamTasks,
    getTaskById,
    assignTaskToUser,
    acceptTask,
    submitTask,
    getTaskDocuments,
    deleteTaskDocument
};