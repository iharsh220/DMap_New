const { Op } = require('sequelize');
const CrudService = require('../../services/crudService');
const {
    WorkRequests,
    RequestType,
    ProjectType,
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
    TaskType,
    TaskDependencies,
    TaskAssignments,
    TaskDocuments,
    AboutProject,
    RequestDivisionReference
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
// const { queueFileUpload } = require('../../services/fileUploadService');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const workRequestService = new CrudService(WorkRequests);

// Create work request
const createWorkRequest = async (req, res) => {
    try {
        let { project_name, brand, request_type_id, project_id, description, about_project, priority = 'medium', remarks, isdraft = 'false' } = req.body;
        const user_id = req.user.id; // From JWT middleware
        // Validate required fields
        if (!project_name || !request_type_id) {
            return res.status(400).json({
                success: false,
                error: 'Project name and request type ID are required'
            });
        }

        // Validate description field
        if (!description) {
            return res.status(400).json({
                success: false,
                error: 'Description is required'
            });
        }

        // Get request type with divisions
        const requestType = await RequestType.findByPk(request_type_id, {
            include: [{
                model: Division,
                through: { attributes: [] },
                attributes: ['id', 'title']
            }]
        });
        if (!requestType) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request type ID'
            });
        }

        const divisionIds = requestType.Divisions.map(d => d.id);

        // Find all assignees (Creative Managers and Creative Leads) in the linked divisions
        const assigneeUserDivisions = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: divisionIds } },
            include: [{
                model: User,
                where: {
                    job_role_id: { [Op.in]: [2, 3] }, // 2: Creative Manager, 3: Creative Lead
                    account_status: 'active'
                },
                include: [
                    { model: Department, as: 'Department', attributes: ['id', 'department_name'] },
                    { model: Division, as: 'Divisions', attributes: ['id', 'title'] },
                    { model: JobRole, as: 'JobRole', attributes: ['id', 'role_title'] },
                    { model: Location, as: 'Location', attributes: ['id', 'location_name'] }
                ]
            }]
        });

        const allAssignees = assigneeUserDivisions.map(ud => ud.User).filter(u => u);
        const managers = allAssignees.filter(u => u.job_role_id === 2);
        const creativeLeads = allAssignees.filter(u => u.job_role_id === 3);

        if (managers.length === 0 && creativeLeads.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No manager or creative lead found for this request type'
            });
        }

        // Validate about_project JSON structure if provided
        if (about_project) {
            try {
                let aboutProjectData;

                // Handle different input formats
                if (typeof about_project === 'string') {
                    // Clean the string first (remove extra whitespace/newlines)
                    const cleanString = about_project.trim();
                    aboutProjectData = JSON.parse(cleanString);
                } else if (typeof about_project === 'object') {
                    aboutProjectData = about_project;
                } else {
                    throw new Error('Invalid format');
                }

                // Validate structure - should have output_devices and target_audience
                if (!aboutProjectData.output_devices || !aboutProjectData.target_audience) {
                    return res.status(400).json({
                        success: false,
                        error: 'about_project must contain output_devices and target_audience arrays'
                    });
                }

                // Validate that arrays are not empty
                if (!Array.isArray(aboutProjectData.output_devices) || !Array.isArray(aboutProjectData.target_audience)) {
                    return res.status(400).json({
                        success: false,
                        error: 'output_devices and target_audience must be arrays'
                    });
                }

                // Store as JSON string
                about_project = JSON.stringify(aboutProjectData);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid JSON format for about_project'
                });
            }
        }

        // Create work request
        const workRequestData = {
            user_id,
            project_name,
            brand,
            request_type_id: request_type_id,
            project_id,
            description: description || '', // Add description field with fallback to empty string
            about_project,
            priority,
            status: isdraft === 'true' ? 'draft' : 'pending',
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

        const workRequestId = result.data.id;

        // Create work request manager entries for all managers and creative leads
        const managerEntries = [];
        for (const assignee of allAssignees) {
            const managerEntry = await WorkRequestManagers.create({
                work_request_id: workRequestId,
                manager_id: assignee.id
            });
            managerEntries.push(managerEntry);
        }

        // Handle file uploads
        const documents = [];

        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];
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
                    work_request_id: workRequestId,
                    document_name: file.name,
                    document_path: `${process.env.BASE_ROUTE}/uploads/${req.projectName}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    status: 'uploading',
                    uploaded_at: new Date()
                };

                const docResult = await WorkRequestDocuments.create(documentData);
                documents.push(docResult);

                // Move file synchronously instead of using queue
                try {
                    // Ensure upload directory exists
                    if (!fs.existsSync(req.uploadPath)) {
                        fs.mkdirSync(req.uploadPath, { recursive: true });
                    }

                    const finalFilepath = path.join(req.uploadPath, filename);
                    fs.renameSync(tempFilepath, finalFilepath);

                    // Update document status to uploaded
                    await WorkRequestDocuments.update(
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
                    console.error(`Failed to upload file ${filename}:`, uploadError);

                    // Update document status to failed
                    await WorkRequestDocuments.update(
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

        // Send notification emails
        if (isdraft === 'false' && req.user && allAssignees.length > 0) {
            // Prepare assignee details for user email
            const assigneeDetails = allAssignees.map((a, index) =>
                `${a.JobRole?.role_title || 'Assignee'} ${index + 1}: ${a.name} (${a.email})`
            ).join(', ');
            const firstAssignee = allAssignees[0];

            // Email to user (confirmation)
            const userEmailHtml = renderTemplate('workRequestUserConfirmation', {
                manager_name: assigneeDetails,
                manager_department: firstAssignee.Department?.department_name || 'N/A',
                manager_division: firstAssignee.Divisions && firstAssignee.Divisions.length > 0 ? firstAssignee.Divisions[0].title : 'N/A',
                manager_job_role: firstAssignee.JobRole?.role_title || 'N/A',
                manager_location: firstAssignee.Location?.location_name || 'N/A',
                project_name: result.data.project_name,
                brand: result.data.brand || 'Not specified',
                request_type_type: requestType.request_type,
                request_type_category: 'N/A',
                priority: result.data.priority,
                division_name: requestType.Divisions.length > 0 ? requestType.Divisions[0].title : 'N/A',
                request_id: result.data.id,
                request_date: new Date(result.data.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                about_project: result.data.about_project ? JSON.parse(result.data.about_project) : null,
                priority_capitalized: result.data.priority.charAt(0).toUpperCase() + result.data.priority.slice(1),
                frontend_url: process.env.FRONTEND_URL
            });

            await sendMail({
                to: req.user.email,
                subject: 'Work Request Submitted Successfully',
                html: userEmailHtml
            });

            // Email to managers (with leads in CC)
            const managerEmails = managers.map(m => m.email);
            const leadEmails = creativeLeads.map(l => l.email);

            const managerEmailHtml = renderTemplate('workRequestManagerNotification', {
                project_name: result.data.project_name,
                brand: result.data.brand || 'Not specified',
                request_type_type: requestType.request_type,
                request_type_category: 'N/A',
                priority: result.data.priority,
                division_name: requestType.Divisions.length > 0 ? requestType.Divisions[0].title : 'N/A',
                request_id: result.data.id,
                request_date: new Date(result.data.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                user_name: req.user.name,
                user_email: req.user.email,
                user_department: req.user.department?.department_name || 'Not specified',
                user_division: req.user.divisions && req.user.divisions.length > 0 ? req.user.divisions[0].title : 'Not specified',
                user_job_role: req.user.jobRole?.role_title || 'Not specified',
                user_location: req.user.location?.location_name || 'Not specified',
                user_designation: req.user.designation?.designation_name || 'Not specified',
                about_project: result.data.about_project ? JSON.parse(result.data.about_project) : null,
                priority_capitalized: result.data.priority.charAt(0).toUpperCase() + result.data.priority.slice(1),
                frontend_url: process.env.FRONTEND_URL
            });

            await sendMail({
                to: managerEmails.join(','),
                cc: leadEmails.join(','),
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


        let where = { user_id };

        // Apply filters
        if (req.filters) {
            // Handle status as comma-separated string
            if (req.filters.status && typeof req.filters.status === 'string') {
                const statuses = req.filters.status.split(',').map(s => s.trim());
                where.status = { [Op.in]: statuses };
                // Remove status from req.filters to avoid overriding
                const { status, ...otherFilters } = req.filters;
                where = { ...where, ...otherFilters };
            } else {
                where = { ...where, ...req.filters };
            }
        }

        // Apply search
        if (req.search.term && req.search.fields.length > 0) {
            where[Op.or] = req.search.fields.map(field => ({
                [field]: { [Op.like]: `%${req.search.term}%` }
            }));
        }

        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['request_type_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, attributes: { exclude: ['created_at', 'updated_at'] }, include: [
                        {
                            model: User, as: 'manager', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                                { model: Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                                { model: Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                                { model: JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                                { model: Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                            ]
                        }
                    ]
                },
                {
                    model: Tasks,
                    attributes: { exclude: ['created_at', 'updated_at'] },
                    include: [
                        {
                            model: User,
                            as: 'assignedUsers',
                            attributes: ['id', 'name', 'email'],
                            through: { attributes: [] }
                        },
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
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
                        }
                    ]
                }
            ],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });

        if (result.success) {
            // Calculate project deadline for each work request
            result.data.forEach(workRequest => {
                let projectDeadline = null;
                if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                    const deadlines = workRequest.Tasks
                        .map(task => task.deadline)
                        .filter(deadline => deadline !== null && deadline !== undefined)
                        .map(deadline => new Date(deadline));
                    if (deadlines.length > 0) {
                        projectDeadline = new Date(Math.max(...deadlines));
                    }
                }
                workRequest.dataValues.project_deadline = projectDeadline;
            });
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
        // Define associations for TaskAssignments
        Tasks.hasMany(TaskAssignments, { foreignKey: 'task_id' });
        TaskAssignments.belongsTo(Tasks, { foreignKey: 'task_id' });
        TaskAssignments.hasMany(TaskDocuments, { foreignKey: 'task_assignment_id' });
        TaskDocuments.belongsTo(TaskAssignments, { foreignKey: 'task_assignment_id' });

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const user_id = req.user.id;

        const result = await workRequestService.getAll({
            where: { id, user_id },
            attributes: { exclude: ['request_type_id', 'created_at', 'updated_at'] },
            include: [
                { 
                    model: User, 
                    as: 'users', 
                    foreignKey: 'user_id', 
                    attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, 
                    include: [
                        { model: Department, attributes: ['id', 'department_name'] },
                        { model: JobRole, attributes: ['id', 'role_title'] },
                        { model: Location, attributes: ['id', 'location_name'] },
                        { model: Designation, attributes: ['id', 'designation_name'] },
                        { model: Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } }
                    ] 
                },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] }, include: [{ model: Division, through: { attributes: [] }, attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: ProjectType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, attributes: { exclude: ['created_at', 'updated_at'] }, include: [
                        {
                            model: User, as: 'manager', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                                { model: Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                                { model: Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                                { model: JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                                { model: Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                            ]
                        }
                    ]
                },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: Tasks,
                    required: false,
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
                                    required: false,
                                    attributes: ['id', 'document_name', 'document_path', 'uploaded_at', 'status', 'version', 'review']
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
            limit: 1,
            order: []
        });

        if (result.success && result.data.length > 0) {
            const workRequest = result.data[0];

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

            // Collect all unique users from tasks with their full details (taskUsers)
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

            // Add taskUsers to the work request response
            workRequest.dataValues.taskUsers = taskUsers;

            res.json({ success: true, data: workRequest });
        } else {
            res.status(404).json({ success: false, error: 'Work request not found' });
        }
    } catch (error) {
        console.error('Error fetching work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getProjectTypesByRequestType = async (req, res) => {
    try {
        const { request_type_id } = req.query;

        if (!request_type_id) {
            return res.status(400).json({
                success: false,
                error: 'request_type_id is required'
            });
        }

        const requestType = await RequestType.findByPk(request_type_id, {
            include: [{
                model: ProjectType,
                through: { attributes: [] },
                attributes: { exclude: ['created_at', 'updated_at'] }
            }]
        });

        if (!requestType) {
            return res.status(404).json({
                success: false,
                error: 'Request type not found'
            });
        }

        res.json({
            success: true,
            data: requestType.ProjectTypes
        });
    } catch (error) {
        console.error('Error fetching project types:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

const getAboutProjectOptions = async (req, res) => {
    try {
        // Get all about_project options grouped by type
        const outputDevices = await AboutProject.findAll({
            where: { type: 'output_devices' },
            attributes: ['category'],
            order: [['category', 'ASC']]
        });

        const targetAudience = await AboutProject.findAll({
            where: { type: 'target_audience' },
            attributes: ['category'],
            order: [['category', 'ASC']]
        });

        res.json({
            success: true,
            data: {
                output_devices: outputDevices.map(item => item.category),
                target_audience: targetAudience.map(item => item.category)
            }
        });
    } catch (error) {
        console.error('Error fetching about project options:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

const getDivisionWorkRequests = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Get user's divisions
        const userDivisions = await UserDivisions.findAll({
            where: { user_id: user_id },
            attributes: ['division_id']
        });

        if (!userDivisions || userDivisions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No divisions found for this user'
            });
        }

        const divisionIds = userDivisions.map(ud => ud.division_id);

        // Get all users in the same divisions
        const divisionUsers = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: divisionIds } },
            attributes: ['user_id']
        });

        const userIds = [...new Set(divisionUsers.map(du => du.user_id))];

        let where = {
            user_id: { [Op.in]: userIds },
            status: { [Op.ne]: 'draft' } // Exclude draft work requests
        };

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
            attributes: { exclude: ['request_type_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, attributes: { exclude: ['created_at', 'updated_at'] }, include: [
                        {
                            model: User, as: 'manager', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                                { model: Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                                { model: Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                                { model: JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                                { model: Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                            ]
                        }
                    ]
                },
                {
                    model: Tasks,
                    attributes: { exclude: ['created_at', 'updated_at'] },
                    include: [
                        {
                            model: User,
                            as: 'assignedUsers',
                            attributes: ['id', 'name', 'email'],
                            through: { attributes: [] }
                        },
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
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
                        }
                    ]
                }
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
        console.error('Error fetching division work requests:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getDivisionWorkRequestById = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const user_id = req.user.id;

        // Get user's divisions
        const userDivisions = await UserDivisions.findAll({
            where: { user_id: user_id },
            attributes: ['division_id']
        });

        if (!userDivisions || userDivisions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No divisions found for this user'
            });
        }

        const divisionIds = userDivisions.map(ud => ud.division_id);

        // Get all users in the same divisions
        const divisionUsers = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: divisionIds } },
            attributes: ['user_id']
        });

        const userIds = [...new Set(divisionUsers.map(du => du.user_id))];

        const result = await workRequestService.getAll({
            where: {
                id,
                user_id: { [Op.in]: userIds },
                status: { [Op.ne]: 'draft' }
            },
            attributes: { exclude: ['request_type_id', 'created_at', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, attributes: { exclude: ['created_at', 'updated_at'] }, include: [
                        {
                            model: User, as: 'manager', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }, include: [
                                { model: Department, as: 'Department', attributes: { exclude: ['created_at', 'updated_at'] } },
                                { model: Division, as: 'Divisions', attributes: { exclude: ['created_at', 'updated_at'] }, through: { attributes: [] } },
                                { model: JobRole, as: 'JobRole', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } },
                                { model: Location, as: 'Location', attributes: { exclude: ['created_at', 'updated_at'] } }
                            ]
                        }
                    ]
                },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: Tasks,
                    attributes: { exclude: ['created_at', 'updated_at'] },
                    include: [
                        {
                            model: User,
                            as: 'assignedUsers',
                            attributes: ['id', 'name', 'email'],
                            through: { attributes: [] }
                        },
                        {
                            model: TaskType,
                            attributes: ['id', 'task_type', 'description']
                        },
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
                        }
                    ]
                }
            ],
            limit: 1,
            order: []
        });

        if (result.success && result.data.length > 0) {
            res.json({ success: true, data: result.data[0] });
        } else {
            res.status(404).json({ success: false, error: 'Work request not found or not accessible' });
        }
    } catch (error) {
        console.error('Error fetching division work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getUserDashboardStats = async (req, res) => {
    try {
        const { request_type_id } = req.query;

        if (!request_type_id) {
            return res.status(400).json({
                success: false,
                error: 'request_type_id is required'
            });
        }

        // Validate request type exists
        const requestType = await RequestType.findByPk(request_type_id);
        if (!requestType) {
            return res.status(404).json({
                success: false,
                error: 'Request type not found'
            });
        }

        // Get divisions linked to this request type with division details
        const requestTypeDivisions = await RequestDivisionReference.findAll({
            where: { request_id: request_type_id },
            include: [{
                model: Division,
                attributes: ['id', 'title']
            }]
        });

        if (!requestTypeDivisions || requestTypeDivisions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No divisions found for this request type'
            });
        }

        const divisionIds = requestTypeDivisions.map(rtd => rtd.division_id);
        const divisions = requestTypeDivisions.map(rtd => ({
            id: rtd.Division.id,
            title: rtd.Division.title
        }));

        // 1. Count accepted + in_progress tasks for this request type
        const ongoingTasksCount = await Tasks.count({
            where: {
                status: { [Op.in]: ['accepted', 'in_progress'] },
                request_type_id: request_type_id
            }
        });

        // 2. Count accepted + in_progress projects for this request type
        const ongoingProjectsCount = await WorkRequests.count({
            where: {
                request_type_id: request_type_id,
                status: { [Op.in]: ['accepted', 'in_progress'] }
            }
        });

        // 3. Count accepted + in_progress tasks with deadlines in the next 7 days for this request type
        const today = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);

        const upcomingDeadlinesCount = await Tasks.count({
            where: {
                request_type_id: request_type_id,
                status: { [Op.in]: ['assigned', 'accepted', 'in_progress'] },
                deadline: {
                    [Op.gte]: today,
                    [Op.lte]: sevenDaysFromNow
                }
            }
        });

        // 4. Find creative manager for this request type
        const managerAssignment = await WorkRequestManagers.findOne({
            include: [{
                model: WorkRequests,
                where: {
                    request_type_id: request_type_id,
                    // status: { [Op.in]: ['accepted', 'in_progress'] }
                },
                attributes: []
            }, {
                model: User,
                as: 'manager',
                where: {
                    job_role_id: 2, // Creative Manager
                    account_status: 'active'
                },
                include: [
                    { model: Department, as: 'Department', attributes: ['id', 'department_name'] },
                    { model: Division, as: 'Divisions', attributes: ['id', 'title'] },
                    { model: JobRole, as: 'JobRole', attributes: ['id', 'role_title'] },
                    { model: Location, as: 'Location', attributes: ['id', 'location_name'] }
                ]
            }],
            limit: 1
        });

        let creativeManagerInfo = null;
        if (managerAssignment && managerAssignment.manager) {
            const manager = managerAssignment.manager;
            creativeManagerInfo = {
                id: manager.id,
                name: manager.name,
                email: manager.email,
                department: manager.Department?.department_name,
                division: divisions.length > 0 ? divisions[0].title : null, // Use request type's division
                job_role: manager.JobRole?.role_title,
                location: manager.Location?.location_name
            };
        }

        res.json({
            success: true,
            data: {
                ongoing_tasks: ongoingTasksCount,
                ongoing_projects: ongoingProjectsCount,
                upcoming_deadlines: upcomingDeadlinesCount,
                creative_manager: creativeManagerInfo
            }
        });
    } catch (error) {
        console.error('Error fetching user dashboard stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// PM Approve Task - Update task status to completed and review to approved
// Only approves tasks where intimate_client = 1 and associated documents with intimate_client = 1
const pmApproveTask = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();
    
    try {
        const { task_id } = req.body;

        if (!task_id) {
            return res.status(400).json({
                success: false,
                error: 'task_id is required'
            });
        }

        // Find the task
        const task = await Tasks.findByPk(task_id);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        // Check if task has intimate_client = 1
        if (task.intimate_client !== 1) {
            return res.status(400).json({
                success: false,
                error: 'Task is not marked for client review (intimate_client must be 1)'
            });
        }

        // Update the task: status stays 'completed', review = 'approved', review_stage = 'final_approved'
        await task.update({
            status: 'completed',
            review: 'approved',
            review_stage: 'final_approved'
        }, { transaction });

        // Find all task assignments for this task
        const taskAssignments = await require('../../models').TaskAssignments.findAll({
            where: { task_id: task_id }
        });

        const taskAssignmentIds = taskAssignments.map(ta => ta.id);

        // Find and update all documents for this task where intimate_client = 1
        if (taskAssignmentIds.length > 0) {
            await require('../../models').TaskDocuments.update(
                { review: 'approved' },
                {
                    where: {
                        task_assignment_id: { [require('../../models').Op.in]: taskAssignmentIds },
                        intimate_client: 1
                    },
                    transaction
                }
            );
        }

        await transaction.commit();

        // Fetch updated task
        const updatedTask = await Tasks.findByPk(task_id, {
            include: [
                {
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description']
                },
                {
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description']
                },
                {
                    model: WorkRequests,
                    attributes: ['id', 'project_name', 'brand', 'status']
                }
            ]
        });

        res.json({
            success: true,
            data: updatedTask,
            message: 'Task and associated documents (intimate_client=1) approved successfully by PM'
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error in PM approve task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to approve task'
        });
    }
};

module.exports = { createWorkRequest, getMyWorkRequests, getWorkRequestById, getProjectTypesByRequestType, getAboutProjectOptions, getDivisionWorkRequests, getDivisionWorkRequestById, getUserDashboardStats, pmApproveTask };