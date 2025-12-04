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
    TaskDocuments
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');
const { queueFileUpload } = require('../../services/fileUploadService');
const path = require('path');
const fs = require('fs');

const getAssignedTasks = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { status } = req.query; // Get status filter from query params

        // Check if user is in department 9
        const isInDepartment9 = req.user.department && req.user.department.id === 9;
        if (!isInDepartment9) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. This endpoint is only available for department 9 users.'
            });
        }

        // Build where condition based on status filter
        let whereCondition;
        if (status === 'accepted') {
            whereCondition = { status: 'accepted' };
        } else if (status === 'in_progress') {
            whereCondition = { status: 'in_progress' };
        } else {
            // Default: show pending tasks (not yet accepted)
            whereCondition = { status: 'pending', intimate_team: 1 };
        }

        // Get tasks assigned to the user through TaskAssignments junction table
        const tasks = await Tasks.findAll({
            where: whereCondition,
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: user_id },
                    attributes: [],
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

        await logUserActivity({
            event: 'assigned_tasks_viewed',
            userId: req.user.id,
            taskCount: tasks.length,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: tasks,
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
        const { task_id, user_id, work_request_id } = req.body;

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
        if (workRequest.status !== 'accepted') {
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

        await logUserActivity({
            event: 'task_assigned_to_user',
            userId: req.user.id,
            taskId: taskId,
            assignedUserId: userId,
            workRequestId: workRequest.id,
            ...extractRequestDetails(req)
        });

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

        // Get single task with full details - only if assigned to current user and intimate_team = 1
        const taskResult = await Tasks.findOne({
            where: { id: taskId, intimate_team: 1 },
            include: [
                {
                    model: User,
                    as: 'assignedUsers',
                    where: { id: req.user.id }, // Only show if current user is assigned
                    attributes: ['id', 'name', 'email'],
                    through: { attributes: ['created_at'] },
                    required: true // This ensures the task must be assigned to the user
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

        await logUserActivity({
            event: 'task_details_viewed',
            userId: req.user.id,
            taskId: taskId,
            ...extractRequestDetails(req)
        });

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

        // Prepare update data
        const updateData = {
            status: 'accepted'
        };

        // If start_date is provided, update it
        if (start_date) {
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

        await logUserActivity({
            event: 'task_accepted',
            userId: req.user.id,
            taskId: taskId,
            startDate: start_date || null,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            message: 'Task accepted successfully',
            data: {
                task_id: taskId,
                status: 'accepted',
                start_date: start_date || task.start_date
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
                            attributes: ['project_name']
                        }
                    ]
                },
                {
                    model: User,
                    attributes: ['name']
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
                // Generate unique filename
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = file.name.replace(/[^a-zA-Z0-9.]/g, '_') + '-' + uniqueSuffix + path.extname(file.name);

                // Create temp directory if it doesn't exist
                const tempDir = path.join('temp', 'uploads');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                // Save file to temp location
                const tempFilename = `temp-${uniqueSuffix}-${filename}`;
                const tempFilepath = path.join(tempDir, tempFilename);
                await file.mv(tempFilepath);

                const documentData = {
                    task_assignment_id: taskAssignment.id,
                    document_name: file.name,
                    document_path: `/uploads/${sanitizedProjectName}/${task.task_name}/${user.name}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    status: 'uploading',
                    uploaded_at: new Date()
                };

                const docResult = await TaskDocuments.create(documentData);
                documents.push(docResult);

                // Queue file upload
                await queueFileUpload({
                    documentId: docResult.id,
                    tempFilepath: tempFilepath,
                    uploadPath: userFolder,
                    filename: filename,
                    type: 'task'
                });
            }
        }

        // Update task status to completed if files were uploaded or link provided
        if ((documents.length > 0 || link) && task.status !== 'completed') {
            await Tasks.update(
                { status: 'completed', end_date: new Date() },
                { where: { id: task.id } }
            );
        }

        await logUserActivity({
            event: 'task_submitted',
            userId: req.user.id,
            taskId: task.id,
            taskAssignmentId: taskAssignment.id,
            documentCount: documents.length,
            ...extractRequestDetails(req)
        });

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

        await logUserActivity({
            event: 'task_documents_viewed',
            userId: req.user.id,
            taskId: taskId,
            documentCount: documents.length,
            ...extractRequestDetails(req)
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

        await logUserActivity({
            event: 'task_document_deleted',
            userId: req.user.id,
            documentId: documentId,
            ...extractRequestDetails(req)
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

module.exports = {
    getAssignedTasks,
    getTaskById,
    assignTaskToUser,
    acceptTask,
    submitTask,
    getTaskDocuments,
    deleteTaskDocument
};