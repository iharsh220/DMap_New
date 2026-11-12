const { Op } = require('sequelize');
const CrudService = require('../../services/crudService');
const {
    WorkRequests,
    WorkRequestDeferrals,
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
    IssueAssignments,
    IssueUserAssignments,
    IssueDocuments,
    IssueAssignmentTypes,
    IssueRegister,
    AboutProject,
    RequestDivisionReference,
    TaskReviewHistory,
    TaskProjectReference,
    Feedbacks
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { recordWorkRequestHistory, recordTaskHistory, recordIssueHistory, getWorkRequestHistory: getWorkRequestHistoryRecords } = require('../../services/historyService');
const { completeWorkRequestIfFinished } = require('../../services/workRequestCompletionService');
const { canActAsRequester, canViewWorkRequest } = require('../../services/accessService');
const { pickModelFilters, pickModelFields } = require('../../utils/queryFilters');
const { parseId, parseIdList, parseDateOnly, todayDateOnly, parseDateRange } = require('../../utils/validators');
const { sequelize } = require('../../config/databaseConfig');
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
            remarks,
            notification_alert: 1
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

        await recordWorkRequestHistory({
            req,
            workRequestId,
            action: 'created',
            previousData: null,
            nextData: result.data,
            changes: {
                project_name: { before: null, after: project_name },
                status: { before: null, after: isdraft === 'true' ? 'draft' : 'pending' }
            },
            comments: isdraft === 'true' ? 'Draft work request created' : 'Work request submitted by user'
        });

        // Send notification emails
        if (isdraft === 'false' && req.user && allAssignees.length > 0) {
            // Prepare assignee details for user email
            const assigneeNames = allAssignees.map(a => a.name).join(', ');
            const firstAssignee = allAssignees[0];

            // Email to user (confirmation)
            const userEmailHtml = renderTemplate('workRequestUserConfirmation', {
                manager_name: assigneeNames,
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

            // Fetch full user details for the email
            const fullUserDetails = await User.findByPk(req.user.id, {
                include: [
                    { model: Department, attributes: ['id', 'department_name'] },
                    { model: Division, as: 'Divisions', attributes: ['id', 'title'], through: { attributes: [] } },
                    { model: JobRole, attributes: ['id', 'role_title'] },
                    { model: Location, attributes: ['id', 'location_name'] },
                    { model: Designation, attributes: ['id', 'designation_name'] }
                ]
            });

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
                user_name: fullUserDetails?.name || req.user.name,
                user_email: fullUserDetails?.email || req.user.email,
                user_department: fullUserDetails?.Department?.department_name || 'Not specified',
                user_division: fullUserDetails?.Divisions && fullUserDetails.Divisions.length > 0 ? fullUserDetails.Divisions[0].title : 'Not specified',
                user_job_role: fullUserDetails?.JobRole?.role_title || 'Not specified',
                user_location: fullUserDetails?.Location?.location_name || 'Not specified',
                user_designation: fullUserDetails?.Designation?.designation_name || 'Not specified',
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

// Update work request by ID
const updateWorkRequest = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const user_id = req.user.id;

        // Find the work request
        const workRequest = await WorkRequests.findByPk(workRequestId, {
            include: [{
                model: WorkRequestManagers,
                attributes: ['id', 'manager_id']
            }]
        });

        if (!workRequest) {
            return res.status(404).json({ success: false, error: 'Work request not found' });
        }

        // Check if user is the creator or a manager
        const isCreator = workRequest.user_id === user_id;
        const isManager = workRequest.WorkRequestManagers && workRequest.WorkRequestManagers.some(wm => wm.manager_id === user_id);

        if (!isCreator && !isManager) {
            return res.status(403).json({ success: false, error: 'You do not have permission to update this work request' });
        }

        // Extract update fields from request body
        let { project_name, brand, request_type_id, project_id, description, about_project, priority, remarks, status, document_ids } = req.body;

        // If the creator (client) is updating, update requested_at to current time
        // Build update data object first
        const updateData = {};

        if (isCreator) {
            updateData.requested_at = new Date();
        }

        if (project_name !== undefined) updateData.project_name = project_name;
        if (brand !== undefined) updateData.brand = brand;
        if (request_type_id !== undefined) updateData.request_type_id = request_type_id;
        if (project_id !== undefined) updateData.project_id = project_id;
        if (description !== undefined) updateData.description = description;
        if (priority !== undefined) updateData.priority = priority;
        if (remarks !== undefined) updateData.remarks = remarks;
        if (status !== undefined) updateData.status = status;
        if (isCreator && workRequest.status === 'deferred' && status === undefined) updateData.status = 'pending';

        // Validate about_project JSON structure if provided
        if (about_project !== undefined) {
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

                if (!Array.isArray(aboutProjectData.output_devices) || !Array.isArray(aboutProjectData.target_audience)) {
                    return res.status(400).json({
                        success: false,
                        error: 'output_devices and target_audience must be arrays'
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
                updateData.about_project = JSON.stringify(aboutProjectData);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid JSON format for about_project'
                });
            }
        }

        // Update the work request
        if (Object.keys(updateData).length > 0) {
            await workRequest.update(updateData);
        }

        if (isCreator) {
            const latestOpenDeferral = await WorkRequestDeferrals.findOne({
                where: {
                    work_request_id: workRequestId,
                    client_resubmitted_at: null
                },
                order: [['deferred_at', 'DESC']]
            });

            if (latestOpenDeferral) {
                await latestOpenDeferral.update({
                    client_resubmitted_at: new Date(),
                    resubmitted_by_user_id: user_id,
                    resubmission_count: latestOpenDeferral.resubmission_count + 1
                });
            }
        }

        // Handle document deletion - remove documents that are not in document_ids array
        if (document_ids !== undefined) {
            // Parse document_ids if it's a string
            let keepDocumentIds = [];
            if (typeof document_ids === 'string') {
                try {
                    keepDocumentIds = JSON.parse(document_ids);
                } catch (e) {
                    keepDocumentIds = document_ids.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
                }
            } else if (Array.isArray(document_ids)) {
                keepDocumentIds = document_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            }

            // Get existing documents for this work request
            const existingDocuments = await WorkRequestDocuments.findAll({
                where: { work_request_id: workRequestId }
            });

            // Find documents to delete (not in keepDocumentIds)
            const documentsToDelete = existingDocuments.filter(doc => !keepDocumentIds.includes(doc.id));

            // Delete documents that are not in the keep list
            for (const doc of documentsToDelete) {
                // Delete file from filesystem if it exists
                if (doc.document_path) {
                    try {
                        // Construct the full file path - the document_path contains the base route
                        // We need to construct the path relative to project root
                        let filePath = doc.document_path;

                        // If the path starts with BASE_ROUTE, remove it
                        if (filePath.startsWith(process.env.BASE_ROUTE)) {
                            filePath = filePath.replace(process.env.BASE_ROUTE, '');
                        }

                        // Also remove leading slash if present
                        if (filePath.startsWith('/')) {
                            filePath = filePath.substring(1);
                        }

                        // Construct full path from project root
                        const fullFilePath = path.join(__dirname, '../../', filePath);

                        console.log(`Attempting to delete file: ${fullFilePath}`);

                        if (fs.existsSync(fullFilePath)) {
                            fs.unlinkSync(fullFilePath);
                            console.log(`Successfully deleted file: ${fullFilePath}`);
                        } else {
                            console.log(`File not found, skipping deletion: ${fullFilePath}`);
                        }
                    } catch (fileError) {
                        console.error(`Failed to delete file ${doc.document_path}:`, fileError);
                    }
                }
                // Delete document from database
                await doc.destroy();
            }
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

        await recordWorkRequestHistory({
            req,
            workRequestId,
            action: isCreator ? 'resubmitted' : 'updated',
            previousData: workRequest,
            comments: isCreator ? 'Work request resubmitted by creator' : 'Work request updated by manager',
            relatedUserId: workRequest.user_id
        });

        // Fetch updated work request with associations
        const updatedWorkRequest = await WorkRequests.findByPk(workRequestId, {
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
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } }
            ]
        });

        res.json({
            success: true,
            data: {
                workRequest: updatedWorkRequest,
                documents: documents
            },
            message: 'Work request updated successfully'
        });
    } catch (error) {
        console.error('Error updating work request:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to update work request'
        });
    }
};

// ---- Requester (PMT) list helpers: my-requests and division/all (R3, 2026-11-04) ----
// Extra query params (all optional; they are not work_requests columns, so pickModelFilters ignores them):
//   deadline_from / deadline_to  YYYY-MM-DD, on the project deadline (latest deadline of its live tasks)
//   artist_name / artist_id      someone assigned to one of its live tasks or changes (name: LIKE)
//   requester_name / requester_id  the user who raised it (name: LIKE)
//   sort_by  created_at | requested_at | deadline | status | project_name | priority | id,  order  asc | desc
// The default order stays created_at DESC; `id` is added as a tie-break so pages are stable.
const PROJECT_DEADLINE_SQL = '(SELECT MAX(dt.deadline) FROM tasks dt WHERE dt.work_request_id = `WorkRequests`.`id` AND dt.is_deleted = 0)';
const REQUESTER_LIST_SORTS = {
    created_at: 'created_at',
    requested_at: 'requested_at',
    status: 'status',
    project_name: 'project_name',
    priority: 'priority',
    id: 'id',
    deadline: 'deadline',
    project_deadline: 'deadline'
};

const singleQueryValue = (value) => (Array.isArray(value) ? value.join(',') : value);

// Returns { conditions, order } or { error } (400)
const buildRequesterListQuery = (query) => {
    const conditions = [];
    const from = query.deadline_from !== undefined && query.deadline_from !== '' ? parseDateOnly(singleQueryValue(query.deadline_from)) : null;
    const to = query.deadline_to !== undefined && query.deadline_to !== '' ? parseDateOnly(singleQueryValue(query.deadline_to)) : null;
    if ((query.deadline_from && !from) || (query.deadline_to && !to)) {
        return { error: 'deadline_from and deadline_to must be valid dates (YYYY-MM-DD)' };
    }
    if (from && to && from > to) {
        return { error: 'deadline_from must not be after deadline_to' };
    }
    if (from) conditions.push(sequelize.literal(`${PROJECT_DEADLINE_SQL} >= ${sequelize.escape(from)}`));
    if (to) conditions.push(sequelize.literal(`${PROJECT_DEADLINE_SQL} <= ${sequelize.escape(to + ' 23:59:59')}`));

    const artistCondition = (userSql) => sequelize.literal(`\`WorkRequests\`.\`id\` IN (
        SELECT at.work_request_id FROM tasks at JOIN task_assignments ata ON ata.task_id = at.id
        WHERE at.is_deleted = 0 AND ata.user_id IN (${userSql})
        UNION
        SELECT at.work_request_id FROM tasks at JOIN issue_assignments aia ON aia.task_id = at.id AND aia.is_deleted = 0
        JOIN issue_user_assignments aiu ON aiu.issue_assignment_id = aia.id
        WHERE at.is_deleted = 0 AND aiu.user_id IN (${userSql}))`);
    if (query.artist_id !== undefined && query.artist_id !== '') {
        const artistId = parseId(singleQueryValue(query.artist_id));
        if (!artistId) return { error: 'artist_id must be a valid ID' };
        conditions.push(artistCondition(String(artistId)));
    }
    const artistName = String(singleQueryValue(query.artist_name) || '').trim();
    if (artistName) {
        conditions.push(artistCondition(`SELECT au.id FROM users au WHERE au.name LIKE ${sequelize.escape(`%${artistName}%`)}`));
    }
    if (query.requester_id !== undefined && query.requester_id !== '') {
        const requesterId = parseId(singleQueryValue(query.requester_id));
        if (!requesterId) return { error: 'requester_id must be a valid ID' };
        conditions.push({ user_id: requesterId });
    }
    const requesterName = String(singleQueryValue(query.requester_name) || '').trim();
    if (requesterName) {
        conditions.push(sequelize.literal(`\`WorkRequests\`.\`user_id\` IN (SELECT ru.id FROM users ru WHERE ru.name LIKE ${sequelize.escape(`%${requesterName}%`)})`));
    }

    const sortBy = String(singleQueryValue(query.sort_by) || 'created_at').trim();
    const sortKey = REQUESTER_LIST_SORTS[sortBy];
    if (!sortKey) {
        return { error: `Invalid sort_by. Valid values are: ${Object.keys(REQUESTER_LIST_SORTS).join(', ')}` };
    }
    const orderParam = String(singleQueryValue(query.order) || '').trim().toLowerCase();
    if (orderParam && !['asc', 'desc'].includes(orderParam)) {
        return { error: 'order must be asc or desc' };
    }
    const direction = (orderParam || (sortKey === 'deadline' ? 'asc' : 'desc')).toUpperCase();
    const order = sortKey === 'deadline'
        // requests without any task deadline go last in both directions
        ? [[sequelize.literal(`${PROJECT_DEADLINE_SQL} IS NULL`), 'ASC'], [sequelize.literal(PROJECT_DEADLINE_SQL), direction]]
        : [[sortKey, direction]];
    order.push(['id', direction]);
    return { conditions, order };
};

// Adds total / total_pages to the pagination object (page, limit, offset are unchanged)
const paginationWithTotal = (pagination, total) => ({
    ...pagination,
    total,
    total_pages: pagination.limit === -1 ? (total > 0 ? 1 : 0) : Math.ceil(total / pagination.limit)
});

// Sequelize turns `limit: -1` into invalid SQL; -1 means all rows
const sqlLimit = (pagination) => (pagination.limit === -1 ? undefined : pagination.limit);
const sqlOffset = (pagination) => (pagination.limit === -1 ? undefined : pagination.offset);

const getMyWorkRequests = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { review, review_stages, review_stage } = req.query;

        let where = { user_id, is_deleted: 0 };

        // Build task and issue review filters
        let taskReviewWhere = { is_deleted: 0 };
        let issueReviewWhere = { is_deleted: 0 };

        if (review || review_stages || review_stage) {
            taskReviewWhere.intimate_client = 1;
            issueReviewWhere.intimate_client = 1;

            if (review) {
                const reviewArray = review.split(',').map(r => r.trim());
                const validReviews = ['pending', 'approved', 'change_request'];
                const invalidReviews = reviewArray.filter(r => !validReviews.includes(r));

                if (invalidReviews.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid review values: ${invalidReviews.join(', ')}. Valid values are: ${validReviews.join(', ')}`
                    });
                }

                taskReviewWhere.review = { [Op.in]: reviewArray };
                issueReviewWhere.review = { [Op.in]: reviewArray };
            }

            if (review_stages || review_stage) {
                const reviewStageParam = review_stages || review_stage;
                const reviewStageArray = reviewStageParam.split(',').map(rs => rs.trim());
                const validReviewStages = ['not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'];
                const invalidReviewStages = reviewStageArray.filter(rs => !validReviewStages.includes(rs));

                if (invalidReviewStages.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid review_stage values: ${invalidReviewStages.join(', ')}. Valid values are: ${validReviewStages.join(', ')}`
                    });
                }

                taskReviewWhere.review_stage = { [Op.in]: reviewStageArray };
                issueReviewWhere.review_stage = { [Op.in]: reviewStageArray };
            }
        }

        // Apply filters
        if (req.filters) {
            // Handle status as comma-separated string or array
            if (req.filters.status) {
                let statuses;
                if (typeof req.filters.status === 'string') {
                    statuses = req.filters.status.split(',').map(s => s.trim());
                } else if (Array.isArray(req.filters.status)) {
                    statuses = req.filters.status;
                } else {
                    statuses = [req.filters.status];
                }

                // Only apply status filter if user explicitly provided it
                if (statuses.length > 0) {
                    where.status = { [Op.in]: statuses };
                }

                // Remove status, review, review_stages, review_stage from req.filters to avoid overriding
                const { status, review, review_stages, review_stage, ...otherFilters } = req.filters;
                where = { ...where, ...pickModelFilters(WorkRequests, otherFilters) };
            } else {
                const { review, review_stages, review_stage, ...otherFilters } = req.filters;
                where = { ...where, ...pickModelFilters(WorkRequests, otherFilters) };
            }
        }

        // Apply search
        const searchFields = pickModelFields(WorkRequests, req.search.fields);
        if (req.search.term && searchFields.length > 0) {
            where[Op.or] = searchFields.map(field => ({
                [field]: { [Op.like]: `%${req.search.term}%` }
            }));
        }

        const listQuery = buildRequesterListQuery(req.query);
        if (listQuery.error) {
            return res.status(400).json({ success: false, error: listQuery.error });
        }
        if (listQuery.conditions.length > 0) {
            where[Op.and] = listQuery.conditions;
        }

        // One-to-many includes are loaded with `separate` queries, so the page query no longer
        // multiplies rows (managers x divisions x tasks x assignees x changes x documents)
        const total = await WorkRequests.count({ where });
        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['request_type_id', 'updated_at'] },
            paranoid: false,
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, separate: true, order: [['id', 'ASC']], attributes: { exclude: ['created_at', 'updated_at'] }, include: [
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
                    separate: true,
                    order: [['id', 'ASC']],
                    attributes: { exclude: ['created_at', 'updated_at'] },
                    where: taskReviewWhere,
                    required: false,
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
                            separate: true,
                            order: [['id', 'ASC']],
                            include: [
                                {
                                    model: Tasks,
                                    as: 'dependencyTask',
                                    attributes: ['id', 'task_name']
                                }
                            ]
                        },
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
                            separate: true,
                            order: [['id', 'ASC']],
                            where: issueReviewWhere,
                            required: false,
                            include: [
                                {
                                    model: IssueUserAssignments,
                                    as: 'userAssignments',
                                    include: [
                                        {
                                            model: IssueDocuments,
                                            as: 'documents'
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ],
            limit: sqlLimit(req.pagination),
            offset: sqlOffset(req.pagination),
            order: listQuery.order
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

            // Calculate total notification_alert count across all tasks in all work requests
            let totalNotificationAlert = 0;
            result.data.forEach(workRequest => {
                if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                    workRequest.Tasks.forEach(task => {
                        if (task.notification_alert == 1) {
                            totalNotificationAlert++;
                        }
                    });
                }
            });

            res.json({ success: true, data: result.data, pagination: paginationWithTotal(req.pagination, total), notification_alert_count: totalNotificationAlert });
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

        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }
        const user_id = req.user.id;

        // First check if user is the creator OR a manager assigned to this work request
        const workRequest = await WorkRequests.findByPk(id, {
            attributes: ['id', 'user_id'],
            include: [{
                model: WorkRequestManagers,
                where: { manager_id: user_id },
                attributes: ['id'],
                required: false
            }]
        });

        if (!workRequest) {
            return res.status(404).json({ success: false, error: 'Work request not found' });
        }

        // Check if user is either the creator or a manager
        const isCreator = workRequest.user_id === user_id;
        const isManager = workRequest.WorkRequestManagers && workRequest.WorkRequestManagers.length > 0;

        if (!isCreator && !isManager) {
            return res.status(403).json({ success: false, error: 'You do not have access to this work request' });
        }

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
                    where: { is_deleted: 0 },
                    attributes: ['id', 'task_name', 'description', 'request_type_id', 'task_type_id', 'work_request_id', 'deadline', 'status', 'version', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'review', 'review_stage', 'shared_with_client_at', 'created_at', 'updated_at'],
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
                                    attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'uploaded_at', 'status', 'version', 'review', 'intimate_client']
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
                        // Include issues for each task
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
                            required: false,
                            attributes: ['id', 'issue_id', 'task_id', 'requested_by_user_id', 'version', 'status', 'review', 'review_stage', 'description', 'deadline', 'assignment_type', 'intimate_team', 'intimate_client', 'task_count', 'link', 'start_date', 'end_date', 'shared_with_client_at', 'created_at', 'updated_at'],
                            include: [
                                // User who requested the issue
                                {
                                    model: User,
                                    as: 'requester',
                                    attributes: ['id', 'name', 'email']
                                },
                                // Issue types (IssueRegister through IssueAssignmentTypes)
                                {
                                    model: IssueAssignmentTypes,
                                    as: 'issueTypeLinks',
                                    attributes: ['id'],
                                    include: [
                                        {
                                            model: IssueRegister,
                                            as: 'issueRegister',
                                            attributes: ['id', 'change_issue_type', 'description']
                                        }
                                    ]
                                },
                                // User assignments with documents
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
                                        // Documents for each user assignment
                                        {
                                            model: IssueDocuments,
                                            as: 'documents',
                                            attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'version', 'status', 'review', 'intimate_client', 'uploaded_at', 'uploaded_by']
                                        }
                                    ]
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
                            where: { status: { [Op.in]: ['accepted', 'in_progress', 'pending'] }, intimate_team: 1 },
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
                            where: { status: { [Op.in]: ['accepted', 'in_progress', 'pending'] }, intimate_team: 1 },
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

            // Reset notification_alert to 0 for all tasks and issue_assignments linked to this work request
            if (workRequest.Tasks && workRequest.Tasks.length > 0) {
                const taskIds = workRequest.Tasks.map(task => task.id);
                const issueAssignmentIds = [];

                workRequest.Tasks.forEach(task => {
                    task.dataValues.notification_alert = 0;
                    if (task.issueAssignments && task.issueAssignments.length > 0) {
                        task.issueAssignments.forEach(issue => {
                            issue.dataValues.notification_alert = 0;
                            issueAssignmentIds.push(issue.id);
                        });
                    }
                });

                // Update tasks in database
                await Tasks.update(
                    { notification_alert: 0 },
                    { where: { id: { [Op.in]: taskIds } } }
                );

                // Update issue_assignments in database
                if (issueAssignmentIds.length > 0) {
                    await IssueAssignments.update(
                        { notification_alert: 0 },
                        { where: { id: { [Op.in]: issueAssignmentIds } } }
                    );
                }
            }

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

        // Get request type with project types
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

        const projectTypes = requestType.ProjectTypes;

        if (!projectTypes || projectTypes.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        // If request_type_id is 4, return normal description
        if (parseInt(request_type_id) === 4) {
            return res.json({
                success: true,
                data: projectTypes.map(pt => ({
                    id: pt.id,
                    project_type: pt.project_type,
                    description: pt.description,
                    quantification: pt.quantification
                }))
            });
        }

        // Get all task project references
        const taskProjectRefs = await TaskProjectReference.findAll({
            attributes: ['task_id', 'project_id']
        });

        // Get all task types excluding 'web application'
        const allTaskTypes = await TaskType.findAll({
            where: {
                task_type: { [Op.ne]: 'web application' }
            },
            attributes: ['id', 'task_type']
        });

        const taskTypeMap = {};
        allTaskTypes.forEach(tt => {
            taskTypeMap[tt.id] = tt.task_type;
        });

        // Build project types with task types in description
        const result = projectTypes.map(pt => {
            // Find task_ids related to this project
            const relatedTaskIds = taskProjectRefs
                .filter(tpr => tpr.project_id === pt.id)
                .map(tpr => tpr.task_id);

            // Get task types excluding web application
            const relatedTaskTypes = relatedTaskIds
                .map(taskId => taskTypeMap[taskId])
                .filter(taskType => taskType !== undefined && taskType !== 'web application');

            // Remove duplicates
            const uniqueTaskTypes = [...new Set(relatedTaskTypes)];

            return {
                id: pt.id,
                project_type: pt.project_type,
                description: uniqueTaskTypes.join(', '),
                quantification: pt.quantification
            };
        });

        res.json({
            success: true,
            data: result
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
            // user_id stays scoped to the caller's divisions
            const { user_id, ...otherFilters } = pickModelFilters(WorkRequests, req.filters);
            where = { ...where, ...otherFilters };
        }

        // Apply search
        const searchFields = pickModelFields(WorkRequests, req.search.fields);
        if (req.search.term && searchFields.length > 0) {
            where[Op.or] = searchFields.map(field => ({
                [field]: { [Op.like]: `%${req.search.term}%` }
            }));
        }

        const listQuery = buildRequesterListQuery(req.query);
        if (listQuery.error) {
            return res.status(400).json({ success: false, error: listQuery.error });
        }
        // requester_id filters inside the caller's divisions, never outside them
        if (listQuery.conditions.length > 0) {
            where[Op.and] = listQuery.conditions;
        }
        const total = await WorkRequests.count({ where });

        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['request_type_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: RequestType, attributes: { exclude: ['created_at', 'updated_at'] } },
                {
                    model: WorkRequestManagers, separate: true, order: [['id', 'ASC']], attributes: { exclude: ['created_at', 'updated_at'] }, include: [
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
                    separate: true,
                    order: [['id', 'ASC']],
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
                            separate: true,
                            order: [['id', 'ASC']],
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
            limit: sqlLimit(req.pagination),
            offset: sqlOffset(req.pagination),
            order: listQuery.order
        });

        if (result.success) {
            res.json({ success: true, data: result.data, pagination: paginationWithTotal(req.pagination, total) });
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

        // 1. Count accepted + in_progress tasks for this request type where intimate_team = 1
        const ongoingTasksCount = await Tasks.count({
            where: {
                status: { [Op.in]: ['accepted', 'in_progress', 'pending'] },
                request_type_id: request_type_id,
                intimate_team: 1
            }
        });

        // 2. Count accepted + in_progress projects for this request type where intimate_team = 1
        const ongoingProjectsCount = await WorkRequests.count({
            where: {
                request_type_id: request_type_id,
                status: { [Op.in]: ['accepted', 'in_progress', 'pending'] }
            },
            include: [{
                model: Tasks,
                where: { intimate_team: 1 },
                attributes: [],
                required: true
            }]
        });

        // 2.1 Count accepted + in_progress issues for this request type where intimate_team = 1
        const ongoingIssuesCount = await IssueAssignments.count({
            where: {
                status: { [Op.in]: ['m_accepted', 'u_accepted', 'in_progress'] },
                intimate_team: 1
            },
            include: [{
                model: Tasks,
                as: 'task',
                where: { request_type_id: request_type_id },
                attributes: [],
                required: true
            }]
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

        // 4. Find creative manager for this request type from the divisions linked to this request type
        // Get managers from the divisions linked to this request type
        const userDivisions = await UserDivisions.findAll({
            where: { division_id: { [Op.in]: divisionIds } },
            include: [{
                model: User,
                where: {
                    job_role_id: 2, // Creative Manager
                    account_status: 'active'
                },
                required: true
            }],
            limit: 1
        });

        let creativeManagerInfo = null;
        if (userDivisions && userDivisions.length > 0 && userDivisions[0].User) {
            const manager = userDivisions[0].User;
            // Fetch full manager details
            const fullManagerDetails = await User.findByPk(manager.id, {
                include: [
                    { model: Department, as: 'Department', attributes: ['id', 'department_name'] },
                    { model: Division, as: 'Divisions', attributes: ['id', 'title'] },
                    { model: JobRole, as: 'JobRole', attributes: ['id', 'role_title'] },
                    { model: Location, as: 'Location', attributes: ['id', 'location_name'] }
                ],
                attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] }
            });

            if (fullManagerDetails) {
                creativeManagerInfo = {
                    id: fullManagerDetails.id,
                    name: fullManagerDetails.name,
                    email: fullManagerDetails.email,
                    department: fullManagerDetails.Department?.department_name,
                    division: divisions.length > 0 ? divisions[0].title : null,
                    job_role: fullManagerDetails.JobRole?.role_title,
                    location: fullManagerDetails.Location?.location_name
                };
            }
        }

        res.json({
            success: true,
            data: {
                ongoing_tasks: ongoingTasksCount,
                ongoing_projects: ongoingProjectsCount,
                ongoing_issues: ongoingIssuesCount,
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
// PM-side review actions are limited to the requester (or a colleague in the requester's division)
const canReviewAsRequester = async (user, workRequestId) => {
    if (!workRequestId) return false;
    const workRequest = await WorkRequests.findByPk(workRequestId, { attributes: ['id', 'user_id'] });
    return !!workRequest && canActAsRequester(user.id, workRequest.user_id);
};

const pmApproveTask = async (req, res) => {
    try {
        const { task_id, issue_id } = req.body;

        // If issue_id is provided, handle issue approval
        if (issue_id) {
            return await handleIssuePmApproval(req, res, issue_id);
        }

        if (!task_id) {
            return res.status(400).json({
                success: false,
                error: 'task_id or issue_id is required'
            });
        }

        const taskId = parseId(task_id);
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        // Find the task
        const task = await Tasks.findByPk(taskId);

        if (!task || task.is_deleted) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        if (!(await canReviewAsRequester(req.user, task.work_request_id))) {
            return res.status(403).json({ success: false, error: 'Only the requester can approve this task' });
        }

        // Check if task has intimate_client = 1
        if (task.intimate_client !== 1) {
            return res.status(400).json({
                success: false,
                error: 'Task is not marked for client review (intimate_client must be 1)'
            });
        }

        // Only submitted (completed) work can be approved: every approval in the history was of a
        // completed task, and approving unfinished work closed it without an end date or pages.
        if (task.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: `Only a completed task can be approved (current status: ${task.status})`
            });
        }

        // Update the task: status stays 'completed', review = 'approved', review_stage = 'final_approved'
        await task.update({
            status: 'completed',
            review: 'approved',
            review_stage: 'final_approved'
        });

        // Find all task assignments for this task
        const taskAssignments = await TaskAssignments.findAll({
            where: { task_id: task_id }
        });

        const taskAssignmentIds = taskAssignments.map(ta => ta.id);

        // Find and update all documents for this task where intimate_client = 1
        if (taskAssignmentIds.length > 0) {
            await TaskDocuments.update(
                { review: 'approved' },
                {
                    where: {
                        task_assignment_id: { [Op.in]: taskAssignmentIds },
                        intimate_client: 1
                    }
                }
            );
        }

        await recordTaskHistory({
            req,
            taskId: task.id,
            workRequestId: task.work_request_id,
            action: 'pm_approved',
            previousData: task,
            nextData: {
                status: 'completed',
                review: 'approved',
                review_stage: 'final_approved'
            },
            previousStatus: task.status,
            newStatus: 'completed',
            previousReview: task.review,
            newReview: 'approved',
            previousReviewStage: task.review_stage,
            newReviewStage: 'final_approved',
            comments: 'PM approved task and associated documents'
        });

        await recordWorkRequestHistory({
            req,
            workRequestId: task.work_request_id,
            action: 'pm_approved_task',
            previousStatus: task.status,
            newStatus: 'completed',
            relatedTaskId: task.id,
            comments: 'PM approved task'
        });

        // Was this the last open item? Then the work request is completed (with history)
        const workRequestCompleted = await completeWorkRequestIfFinished(task.work_request_id, { req, relatedTaskId: task.id });

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
            work_request_completed: workRequestCompleted,
            message: 'Task and associated documents (intimate_client=1) approved successfully by PM'
        });

    } catch (error) {
        console.error('Error in PM approve task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to approve task'
        });
    }
};

// Handle PM approval for issues
const handleIssuePmApproval = async (req, res, issueId) => {
    try {
        const manager = req.user;

        // Find the issue
        const issueAssignment = await IssueAssignments.findByPk(issueId, {
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'work_request_id'],
                    include: [
                        { model: WorkRequests, attributes: ['id', 'project_name', 'brand'] }
                    ]
                }
            ]
        });

        if (!issueAssignment || issueAssignment.is_deleted) {
            return res.status(404).json({
                success: false,
                error: 'Issue not found'
            });
        }

        if (!(await canReviewAsRequester(req.user, issueAssignment.task?.work_request_id))) {
            return res.status(403).json({ success: false, error: 'Only the requester can approve this issue' });
        }

        // Check if issue has intimate_client = 1
        if (issueAssignment.intimate_client !== 1) {
            return res.status(400).json({
                success: false,
                error: 'Issue is not marked for client review (intimate_client must be 1)'
            });
        }

        // Only a submitted (completed) change can be approved (all 1,137 approvals in the history were)
        if (issueAssignment.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: `Only a completed change can be approved (current status: ${issueAssignment.status})`
            });
        }

        const previousStatus = issueAssignment.status;
        const previousStage = issueAssignment.review_stage;
        const previousReview = issueAssignment.review;

        // If issue has a linked task, update all issues with that task_id and the task itself
        if (issueAssignment.task_id) {
            const taskId = issueAssignment.task_id;
            const allIssuesForTask = await IssueAssignments.findAll({ where: { task_id: taskId } });
            const today = todayDateOnly();

            // The other versions of the task are closed with it (UAT ISSUES #2 / #5, 2026-11-06):
            //   - a version that was sent back for changes (in_progress + change_requested, set by
            //     pm-reject) is completed again: before, it stayed in_progress for ever and the project
            //     never completed;
            //   - their history row says "approved with a later version"; the approved change itself
            //     gets its own pm_approved row below (before, it was written twice).
            for (const issue of allIssuesForTask) {
                if (issue.id === issueAssignment.id) continue;
                const superseded = !issue.is_deleted && issue.status === 'in_progress' && issue.review_stage === 'change_requested';
                const issueUpdate = { review: 'approved', review_stage: 'final_approved' };
                if (superseded) {
                    issueUpdate.status = 'completed';
                    const start = issue.start_date && String(issue.start_date).slice(0, 10) <= today ? String(issue.start_date).slice(0, 10) : today;
                    if (!issue.start_date || String(issue.start_date).slice(0, 10) !== start) issueUpdate.start_date = start;
                    if (!issue.end_date || String(issue.end_date).slice(0, 10) < start) issueUpdate.end_date = today;
                    await issue.update({ status: 'completed', start_date: issueUpdate.start_date || issue.start_date, end_date: issueUpdate.end_date || issue.end_date });
                }
                await recordIssueHistory({
                    req,
                    issueAssignmentId: issue.id,
                    taskId,
                    workRequestId: issueAssignment.task ? issueAssignment.task.WorkRequest?.id : null,
                    action: 'approved_with_later_version',
                    previousData: issue,
                    nextData: issueUpdate,
                    previousStatus: issue.status,
                    newStatus: issueUpdate.status || issue.status,
                    previousReview: issue.review,
                    newReview: 'approved',
                    previousReviewStage: issue.review_stage,
                    newReviewStage: 'final_approved',
                    comments: `Closed when ${issueAssignment.version || 'a later version'} (#${issueAssignment.id}) was approved by the PM`
                });
            }

            // Update ALL issues with the same task_id to review='approved' and review_stage='final_approved'
            await IssueAssignments.update(
                { review: 'approved', review_stage: 'final_approved' },
                { where: { task_id: taskId } }
            );

            // Approving the change request finally approves its task too. The task's work is done, so it
            // is (or stays) 'completed'; it used to be moved back to 'accepted', which kept the work
            // request open for good and let the daily scheduler reopen the task as in_progress.
            const linkedTask = await Tasks.findByPk(taskId);

            if (linkedTask) {
                const linkedTaskStatus = ['cancelled', 'rejected'].includes(linkedTask.status) ? linkedTask.status : 'completed';
                await recordTaskHistory({
                    req,
                    taskId: linkedTask.id,
                    workRequestId: linkedTask.work_request_id,
                    action: 'pm_approved_issue_linked_task',
                    previousData: linkedTask,
                    nextData: {
                        status: linkedTaskStatus,
                        review: 'approved',
                        review_stage: 'final_approved'
                    },
                    previousStatus: linkedTask.status,
                    newStatus: linkedTaskStatus,
                    previousReview: linkedTask.review,
                    newReview: 'approved',
                    previousReviewStage: linkedTask.review_stage,
                    newReviewStage: 'final_approved',
                    comments: 'PM approved linked task after issue approval'
                });

                // A task that becomes completed here (it had been re-opened) gets valid dates:
                // start not in the future, end not before start (today when missing or invalid)
                const linkedTaskUpdate = { status: linkedTaskStatus, review: 'approved', review_stage: 'final_approved' };
                if (linkedTaskStatus === 'completed') {
                    const today = todayDateOnly();
                    const start = linkedTask.start_date && String(linkedTask.start_date).slice(0, 10) <= today ? String(linkedTask.start_date).slice(0, 10) : today;
                    if (!linkedTask.start_date || String(linkedTask.start_date).slice(0, 10) !== start) linkedTaskUpdate.start_date = start;
                    if (!linkedTask.end_date || String(linkedTask.end_date).slice(0, 10) < start) linkedTaskUpdate.end_date = today;
                }
                await linkedTask.update(linkedTaskUpdate);

                // Also update all documents for this task where intimate_client = 1
                const taskAssignments = await TaskAssignments.findAll({
                    where: { task_id: linkedTask.id }
                });

                const taskAssignmentIds = taskAssignments.map(ta => ta.id);

                if (taskAssignmentIds.length > 0) {
                    await TaskDocuments.update(
                        { review: 'approved' },
                        {
                            where: {
                                task_assignment_id: { [Op.in]: taskAssignmentIds },
                                intimate_client: 1
                            }
                        }
                    );
                }
            }
        }

        // Find all issue user assignments for this issue
        const issueUserAssignments = await IssueUserAssignments.findAll({
            where: { issue_assignment_id: issueId }
        });

        const issueUserAssignmentIds = issueUserAssignments.map(iua => iua.id);

        // Find and update all documents for this issue where intimate_client = 1
        if (issueUserAssignmentIds.length > 0) {
            await IssueDocuments.update(
                { review: 'approved' },
                {
                    where: {
                        issue_user_assignment_id: { [Op.in]: issueUserAssignmentIds },
                        intimate_client: 1
                    }
                }
            );
        }

        // Create review history entry for PM approval
        if (issueAssignment.task_id) {
            await TaskReviewHistory.create({
                task_id: issueAssignment.task_id,
                reviewer_id: manager.id,
                reviewer_type: 'project_manager',
                action: 'approved',
                comments: 'PM approved the issue',
                previous_stage: previousStage || 'pm_review',
                new_stage: 'final_approved'
            });
        }

        await recordIssueHistory({
            req,
            issueAssignmentId: issueId,
            taskId: issueAssignment.task_id,
            workRequestId: issueAssignment.task?.WorkRequest?.id,
            action: 'pm_approved',
            previousData: issueAssignment,
            nextData: {
                review: 'approved',
                review_stage: 'final_approved'
            },
            previousStatus,
            newStatus: previousStatus,
            previousReview,
            newReview: 'approved',
            previousReviewStage: previousStage,
            newReviewStage: 'final_approved',
            comments: 'PM approved issue'
        });

        await recordWorkRequestHistory({
            req,
            workRequestId: issueAssignment.task?.WorkRequest?.id,
            action: 'pm_approved_issue',
            previousStatus,
            newStatus: previousStatus,
            previousReview,
            newReview: 'approved',
            previousReviewStage: previousStage,
            newReviewStage: 'final_approved',
            relatedTaskId: issueAssignment.task_id,
            relatedIssueId: issueId,
            comments: 'PM approved issue'
        });

        const workRequestCompleted = await completeWorkRequestIfFinished(issueAssignment.task?.WorkRequest?.id, { req, relatedTaskId: issueAssignment.task_id, relatedIssueId: issueAssignment.id });

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
                },
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'status', 'review', 'review_stage']
                }
            ]
        });

        // Fetch all issues updated for this task
        const allUpdatedIssues = issueAssignment.task_id ?
            await IssueAssignments.findAll({
                where: { task_id: issueAssignment.task_id },
                attributes: ['id', 'issue_id', 'version', 'status', 'review', 'review_stage']
            }) : [];

        return res.json({
            success: true,
            data: {
                type: 'issue',
                issue: updatedIssue,
                allIssuesUpdated: allUpdatedIssues,
                linkedTaskUpdated: issueAssignment.task_id ? true : false,
                workRequestCompleted,
                reviewAction: {
                    action: 'approved',
                    previousStage,
                    newStage: 'final_approved',
                    statusChanged: true,
                    previousStatus,
                    newStatus: 'completed'
                }
            },
            message: 'Issue and all related issues approved successfully by PM'
        });

    } catch (error) {
        console.error('Error in PM approve issue:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to approve issue'
        });
    }
};

const pmRejectTask = async (req, res) => {
    try {
        const { task_id, issue_id, comments, issue_description, issue_register_ids = [], deadline, start_date, end_date, link, task_count = 0 } = req.body;
        const manager = req.user;

        if (!task_id && !issue_id) {
            return res.status(400).json({ success: false, error: 'task_id or issue_id is required' });
        }

        // issue_register_ids arrives as an array (JSON) or a string (multipart with files);
        // validate before anything is written so a bad value never leaves a half-created issue
        const issueRegisterIds = parseIdList(req.body['issue_register_ids[]'] ?? issue_register_ids);
        if (issueRegisterIds === null) {
            return res.status(400).json({ success: false, error: 'issue_register_ids must be a list of ids' });
        }
        if (issueRegisterIds.length && await IssueRegister.count({ where: { id: issueRegisterIds } }) !== issueRegisterIds.length) {
            return res.status(400).json({ success: false, error: 'Unknown issue_register_ids' });
        }
        // optional dates of the new change: real dates, end never before start
        const changeDates = parseDateRange(start_date, end_date);
        if (changeDates.error) {
            return res.status(400).json({ success: false, error: changeDates.error });
        }

        const createChangeRequestIssue = async (targetTaskId, parentIssueId) => {
            // Version rule (owner): the task itself is V1, its first change V2, the next V3, ... for the
            // whole task, also for a change requested on a change (before: V1 every time, UAT ISSUES #1)
            const existing = await IssueAssignments.findAll({ where: { task_id: targetTaskId }, attributes: ['version'] });
            const versionCount = existing.reduce((max, row) => {
                const n = parseInt(String(row.version || '').replace(/^V/i, ''), 10);
                return Number.isInteger(n) && n > max ? n : max;
            }, 1);
            const issueAssignment = await IssueAssignments.create({
                issue_id: parentIssueId || null,
                // Child issues keep the task link too; manager issue lists are scoped by task_id
                task_id: targetTaskId,
                requested_by_user_id: manager.id,
                assignment_type: 'mod',
                // the version sent by the frontend (V2, V3, ...) wins; otherwise the next one of the task
                version: /^V\d+$/i.test(String(req.body.version || '').trim()) ? String(req.body.version).trim().toUpperCase() : `V${versionCount + 1}`,
                description: issue_description || comments || 'PM change request',
                deadline,
                start_date: changeDates.start,
                end_date: changeDates.end,
                link,
                task_count: task_count || 0,
                intimate_team: 1,
                intimate_client: 0,
                status: 'm_pending',
                review: 'pending',
                review_stage: 'manager_review',
                notification_alert: 1
            });

            if (issueRegisterIds.length > 0) {
                const issueTypeLinks = issueRegisterIds.map(registerId => ({
                    issue_assignment_id: issueAssignment.id,
                    issue_register_id: registerId
                }));
                await IssueAssignmentTypes.bulkCreate(issueTypeLinks);
            }

            return issueAssignment;
        };

        if (task_id) {
            const taskId = parseInt(task_id, 10);
            if (isNaN(taskId)) {
                return res.status(400).json({ success: false, error: 'Invalid task ID' });
            }

            const task = await Tasks.findByPk(taskId, {
                include: [
                    {
                        model: WorkRequests,
                        attributes: ['id', 'project_name', 'brand', 'user_id']
                    }
                ]
            });

            if (!task || task.is_deleted) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }

            if (!task.WorkRequest || !(await canActAsRequester(manager.id, task.WorkRequest.user_id))) {
                return res.status(403).json({ success: false, error: 'Only the requester can request changes on this task' });
            }

            if (task.intimate_client !== 1) {
                return res.status(400).json({ success: false, error: 'Task is not marked for client review (intimate_client must be 1)' });
            }

            const changeRequestIssue = await createChangeRequestIssue(taskId, null);
            const nextTaskData = {
                status: 'in_progress',
                review: 'change_request',
                review_stage: 'change_requested',
                notification_alert: 1,
                comments: comments || null
            };

            await task.update({
                ...nextTaskData
            });

            await TaskReviewHistory.create({
                task_id: taskId,
                reviewer_id: manager.id,
                reviewer_type: 'project_manager',
                action: 'change_request',
                comments: comments || 'PM rejected task and created change request issue',
                previous_stage: task.review_stage || 'pm_review',
                new_stage: 'change_requested'
            });

            await recordTaskHistory({
                req,
                taskId,
                workRequestId: task.work_request_id,
                action: 'pm_rejected',
                previousData: task,
                nextData: nextTaskData,
                previousStatus: task.status,
                newStatus: 'in_progress',
                previousReview: task.review,
                newReview: 'change_request',
                previousReviewStage: task.review_stage,
                newReviewStage: 'change_requested',
                comments: comments || 'PM rejected task and created change request issue',
                relatedIssueId: changeRequestIssue.id
            });

            await recordIssueHistory({
                req,
                issueAssignmentId: changeRequestIssue.id,
                taskId,
                workRequestId: task.work_request_id,
                action: 'pm_change_request_created',
                previousData: null,
                nextData: changeRequestIssue,
                newStatus: changeRequestIssue.status,
                comments: comments || 'PM change request issue created'
            });

            await recordWorkRequestHistory({
                req,
                workRequestId: task.work_request_id,
                action: 'pm_rejected_task',
                previousStatus: task.status,
                newStatus: 'in_progress',
                previousReview: task.review,
                newReview: 'change_request',
                previousReviewStage: task.review_stage,
                newReviewStage: 'change_requested',
                relatedTaskId: taskId,
                relatedIssueId: changeRequestIssue.id,
                comments: comments || 'PM rejected task and created change request issue'
            });

            return res.json({
                success: true,
                data: {
                    type: 'task',
                    task_id: taskId,
                    change_request_issue: changeRequestIssue
                },
                message: 'Task rejected by PM and change request issue created successfully'
            });
        }

        const issueId = parseInt(issue_id, 10);
        if (isNaN(issueId)) {
            return res.status(400).json({ success: false, error: 'Invalid issue ID' });
        }

        const issueAssignment = await IssueAssignments.findByPk(issueId, {
            include: [
                {
                    model: Tasks,
                    as: 'task',
                    attributes: ['id', 'task_name', 'work_request_id'],
                    include: [
                        { model: WorkRequests, attributes: ['id', 'project_name', 'brand', 'user_id'] }
                    ]
                }
            ]
        });

        if (!issueAssignment || issueAssignment.is_deleted) {
            return res.status(404).json({ success: false, error: 'Issue not found' });
        }

        const issueWorkRequest = issueAssignment.task?.WorkRequest;
        if (!issueWorkRequest || !(await canActAsRequester(manager.id, issueWorkRequest.user_id))) {
            return res.status(403).json({ success: false, error: 'Only the requester can request changes on this issue' });
        }

        if (issueAssignment.intimate_client !== 1) {
            return res.status(400).json({ success: false, error: 'Issue is not marked for client review (intimate_client must be 1)' });
        }

        const changeRequestIssue = await createChangeRequestIssue(issueAssignment.task_id, issueId);
        const nextIssueData = {
            status: 'in_progress',
            review: 'change_request',
            review_stage: 'change_requested',
            notification_alert: 1,
            comments: comments || null
        };

        await issueAssignment.update(nextIssueData);

        if (issueAssignment.issue_id) {
            await IssueAssignments.update(
                { review: 'change_request', review_stage: 'change_requested' },
                { where: { id: issueAssignment.issue_id } }
            );
        }

        if (issueAssignment.task_id) {
            await TaskReviewHistory.create({
                task_id: issueAssignment.task_id,
                reviewer_id: manager.id,
                reviewer_type: 'project_manager',
                action: 'change_request',
                comments: comments || 'PM rejected issue and created change request issue',
                previous_stage: issueAssignment.review_stage || 'pm_review',
                new_stage: 'change_requested'
            });
        }

        await recordIssueHistory({
            req,
            issueAssignmentId: issueId,
            taskId: issueAssignment.task_id,
            workRequestId: issueAssignment.task?.work_request_id,
            action: 'pm_rejected',
            previousData: issueAssignment,
            nextData: nextIssueData,
            previousStatus: issueAssignment.status,
            newStatus: 'in_progress',
            previousReview: issueAssignment.review,
            newReview: 'change_request',
            previousReviewStage: issueAssignment.review_stage,
            newReviewStage: 'change_requested',
            comments: comments || 'PM rejected issue and created change request issue',
            relatedIssueId: changeRequestIssue.id
        });

        await recordIssueHistory({
            req,
            issueAssignmentId: changeRequestIssue.id,
            taskId: issueAssignment.task_id,
            workRequestId: issueAssignment.task?.work_request_id,
            parentIssueId: issueId,
            action: 'pm_change_request_created',
            previousData: null,
            nextData: changeRequestIssue,
            newStatus: changeRequestIssue.status,
            comments: comments || 'PM change request issue created'
        });

        await recordWorkRequestHistory({
            req,
            workRequestId: issueAssignment.task?.work_request_id,
            action: 'pm_rejected_issue',
            previousStatus: issueAssignment.status,
            newStatus: 'in_progress',
            previousReview: issueAssignment.review,
            newReview: 'change_request',
            previousReviewStage: issueAssignment.review_stage,
            newReviewStage: 'change_requested',
            relatedTaskId: issueAssignment.task_id,
            relatedIssueId: issueId,
            comments: comments || 'PM rejected issue and created change request issue'
        });

        return res.json({
            success: true,
            data: {
                type: 'issue',
                issue_id: issueId,
                change_request_issue: changeRequestIssue
            },
            message: 'Issue rejected by PM and change request issue created successfully'
        });
    } catch (error) {
        console.error('Error in PM reject task:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to reject task or issue by PM'
        });
    }
};

// Get my task requests - based on issue_assignments
// This gets work requests where the manager is assigned via issue_assignments -> task -> user -> user's manager
// Not implemented yet: respond immediately instead of leaving the request hanging.
const getMyTaskRequests = async (req, res) => {
    res.status(501).json({ success: false, error: 'my-task-requests is not implemented' });
};

const getWorkRequestHistory = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.workRequestId, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        if (!(await canViewWorkRequest(req.user, workRequestId))) {
            return res.status(403).json({ success: false, error: 'You do not have access to this work request' });
        }

        const limit = parseInt(req.query.limit, 10) || 200;
        const offset = parseInt(req.query.offset, 10) || 0;
        const history = await getWorkRequestHistoryRecords(workRequestId, { limit, offset });

        res.json({
            success: true,
            data: history,
            message: 'Work request history retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching work request history:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch work request history' });
    }
};

// Submit feedback for a task
const submitFeedback = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);
        const user_id = req.user.id;
        const {
            rating_functionality, rating_timeliness, rating_communication, recommendation_score, comments,
            question, rating_functionality_comment, rating_timeliness_comment, rating_communication_comment
        } = req.body;

        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        // Validate required fields
        if (!rating_functionality || !rating_timeliness || !rating_communication || recommendation_score === undefined) {
            return res.status(400).json({ success: false, error: 'All ratings are required' });
        }

        // recommendation_score mandatory comment (reuse the comments field)
        if (!comments || !comments.trim()) {
            return res.status(400).json({ success: false, error: 'A comment is mandatory for the recommendation score' });
        }

        // Validate rating ranges
        if (rating_functionality < 1 || rating_functionality > 5) {
            return res.status(400).json({ success: false, error: 'rating_functionality must be between 1 and 5' });
        }
        if (rating_timeliness < 1 || rating_timeliness > 5) {
            return res.status(400).json({ success: false, error: 'rating_timeliness must be between 1 and 5' });
        }
        if (rating_communication < 1 || rating_communication > 5) {
            return res.status(400).json({ success: false, error: 'rating_communication must be between 1 and 5' });
        }
        if (recommendation_score < 0 || recommendation_score > 10) {
            return res.status(400).json({ success: false, error: 'recommendation_score must be between 0 and 10' });
        }

        // Per-rating comments are required when the rating is below 4
        if (Number(rating_functionality) < 4 && !(rating_functionality_comment && rating_functionality_comment.trim())) {
            return res.status(400).json({ success: false, error: 'A comment for functionality rating is required when rating is below 4' });
        }
        if (Number(rating_timeliness) < 4 && !(rating_timeliness_comment && rating_timeliness_comment.trim())) {
            return res.status(400).json({ success: false, error: 'A comment for timeliness rating is required when rating is below 4' });
        }
        if (Number(rating_communication) < 4 && !(rating_communication_comment && rating_communication_comment.trim())) {
            return res.status(400).json({ success: false, error: 'A comment for communication rating is required when rating is below 4' });
        }

        // Check if task exists
        const task = await Tasks.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        // Check if user has already submitted feedback for this task
        const existingFeedback = await Feedbacks.findOne({
            where: { task_id: taskId, user_id, is_deleted: 0 }
        });

        if (existingFeedback) {
            return res.status(400).json({ success: false, error: 'You have already submitted feedback for this task' });
        }

        // Create feedback
        const feedback = await Feedbacks.create({
            task_id: taskId,
            user_id,
            rating_functionality,
            rating_timeliness,
            rating_communication,
            recommendation_score,
            comments: comments || null,
            question: question || null,
            rating_functionality_comment: rating_functionality_comment || null,
            rating_timeliness_comment: rating_timeliness_comment || null,
            rating_communication_comment: rating_communication_comment || null
        });

        res.json({
            success: true,
            message: 'Feedback submitted successfully',
            data: feedback
        });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to submit feedback' });
    }
};

// Get feedback for a task
const getFeedback = async (req, res) => {
    try {
        const taskId = parseInt(req.params.taskId, 10);

        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        // Check if task exists
        const task = await Tasks.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        if (!(await canViewWorkRequest(req.user, task.work_request_id))) {
            return res.status(403).json({ success: false, error: 'You do not have access to this task' });
        }

        // Get all non-deleted feedbacks for this task with user details
        const feedbacks = await Feedbacks.findAll({
            where: { task_id: taskId, is_deleted: 0 },
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'name', 'email']
            }],
            order: [['created_at', 'DESC']]
        });

        // Calculate average ratings
        let totalFunctionality = 0;
        let totalTimeliness = 0;
        let totalCommunication = 0;
        let totalRecommendation = 0;
        const feedbackCount = feedbacks.length;

        if (feedbackCount > 0) {
            feedbacks.forEach(fb => {
                totalFunctionality += fb.rating_functionality;
                totalTimeliness += fb.rating_timeliness;
                totalCommunication += fb.rating_communication;
                totalRecommendation += fb.recommendation_score;
            });
        }

        const averages = feedbackCount > 0 ? {
            avg_functionality: (totalFunctionality / feedbackCount).toFixed(2),
            avg_timeliness: (totalTimeliness / feedbackCount).toFixed(2),
            avg_communication: (totalCommunication / feedbackCount).toFixed(2),
            avg_recommendation: (totalRecommendation / feedbackCount).toFixed(2)
        } : null;

        res.json({
            success: true,
            data: {
                feedbacks,
                averages,
                total_feedbacks: feedbackCount
            }
        });
    } catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ success: false, error: error.message, message: 'Failed to fetch feedback' });
    }
};

module.exports = {
    createWorkRequest,
    updateWorkRequest,
    getMyWorkRequests,
    getMyTaskRequests,
    getWorkRequestById,
    getProjectTypesByRequestType,
    getAboutProjectOptions,
    getDivisionWorkRequests,
    getDivisionWorkRequestById,
    getUserDashboardStats,
    pmApproveTask,
    pmRejectTask,
    getWorkRequestHistory,
    submitFeedback,
    getFeedback
};
