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
    TaskProjectReference
} = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { recordWorkRequestHistory, recordTaskHistory, recordIssueHistory, getWorkRequestHistory: getWorkRequestHistoryRecords } = require('../../services/historyService');
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
    const transaction = await require('../../models').sequelize.transaction();

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
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        error: 'about_project must contain output_devices and target_audience arrays'
                    });
                }

                // Validate that arrays are not empty
                if (!Array.isArray(aboutProjectData.output_devices) || !Array.isArray(aboutProjectData.target_audience)) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        error: 'output_devices and target_audience must be arrays'
                    });
                }

                // Store as JSON string
                updateData.about_project = JSON.stringify(aboutProjectData);
            } catch (error) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    error: 'Invalid JSON format for about_project'
                });
            }
        }

        // Update the work request
        if (Object.keys(updateData).length > 0) {
            await workRequest.update(updateData, { transaction });
        }

        if (isCreator) {
            const latestOpenDeferral = await WorkRequestDeferrals.findOne({
                where: {
                    work_request_id: workRequestId,
                    client_resubmitted_at: null
                },
                order: [['deferred_at', 'DESC']],
                transaction
            });

            if (latestOpenDeferral) {
                await latestOpenDeferral.update({
                    client_resubmitted_at: new Date(),
                    resubmitted_by_user_id: user_id,
                    resubmission_count: latestOpenDeferral.resubmission_count + 1
                }, { transaction });
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
                where: { work_request_id: workRequestId },
                transaction
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
                await doc.destroy({ transaction });
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

                const docResult = await WorkRequestDocuments.create(documentData, { transaction });
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
                        { where: { id: docResult.id }, transaction }
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
                        { where: { id: docResult.id }, transaction }
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

        await transaction.commit();

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
        await transaction.rollback();
        console.error('Error updating work request:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to update work request'
        });
    }
};

const getMyWorkRequests = async (req, res) => {
    try {
        const user_id = req.user.id;


        let where = { user_id };

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
                        },
                        {
                            model: IssueAssignments,
                            as: 'issueAssignments',
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

            res.json({ success: true, data: result.data, pagination: req.pagination, notification_alert_count: totalNotificationAlert });
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
                                            attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'version', 'status', 'review', 'intimate_client', 'uploaded_at']
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
const pmApproveTask = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();

    try {
        const { task_id, issue_id } = req.body;

        // If issue_id is provided, handle issue approval
        if (issue_id) {
            return await handleIssuePmApproval(req, res, transaction, issue_id);
        }

        if (!task_id) {
            return res.status(400).json({
                success: false,
                error: 'task_id or issue_id is required'
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
                    },
                    transaction
                }
            );
        }

        await recordTaskHistory({
            req,
            transaction,
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
            transaction,
            workRequestId: task.work_request_id,
            action: 'pm_approved_task',
            previousStatus: task.status,
            newStatus: 'completed',
            relatedTaskId: task.id,
            comments: 'PM approved task'
        });

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

// Handle PM approval for issues
const handleIssuePmApproval = async (req, res, transaction, issueId) => {
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

        if (!issueAssignment) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'Issue not found'
            });
        }

        // Check if issue has intimate_client = 1
        if (issueAssignment.intimate_client !== 1) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'Issue is not marked for client review (intimate_client must be 1)'
            });
        }

        const previousStatus = issueAssignment.status;
        const previousStage = issueAssignment.review_stage;
        const previousReview = issueAssignment.review;

        // If issue has a linked task, update all issues with that task_id and the task itself
        if (issueAssignment.task_id) {
            const taskId = issueAssignment.task_id;
            const allIssuesForTask = await IssueAssignments.findAll({ where: { task_id: taskId }, transaction });

            for (const issue of allIssuesForTask) {
                await recordIssueHistory({
                    req,
                    transaction,
                    issueAssignmentId: issue.id,
                    taskId,
                    workRequestId: issueAssignment.task ? issueAssignment.task.WorkRequest?.id : null,
                    action: 'pm_approved',
                    previousData: issue,
                    nextData: {
                        review: 'approved',
                        review_stage: 'final_approved'
                    },
                    previousStatus: issue.status,
                    newStatus: issue.status,
                    previousReview: issue.review,
                    newReview: 'approved',
                    previousReviewStage: issue.review_stage,
                    newReviewStage: 'final_approved',
                    comments: 'PM approved issue'
                });
            }

            // Update ALL issues with the same task_id to review='approved' and review_stage='final_approved'
            await IssueAssignments.update(
                { review: 'approved', review_stage: 'final_approved' },
                { where: { task_id: taskId }, transaction }
            );

            // Update the task to status='accepted', review='approved', review_stage='final_approved'
            const linkedTask = await Tasks.findByPk(taskId);

            if (linkedTask) {
                await recordTaskHistory({
                    req,
                    transaction,
                    taskId: linkedTask.id,
                    workRequestId: linkedTask.work_request_id,
                    action: 'pm_approved_issue_linked_task',
                    previousData: linkedTask,
                    nextData: {
                        status: 'accepted',
                        review: 'approved',
                        review_stage: 'final_approved'
                    },
                    previousStatus: linkedTask.status,
                    newStatus: 'accepted',
                    previousReview: linkedTask.review,
                    newReview: 'approved',
                    previousReviewStage: linkedTask.review_stage,
                    newReviewStage: 'final_approved',
                    comments: 'PM approved linked task after issue approval'
                });

                await linkedTask.update({
                    status: 'accepted',
                    review: 'approved',
                    review_stage: 'final_approved'
                }, { transaction });

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
                            },
                            transaction
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
                    },
                    transaction
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
            }, { transaction });
        }

        await recordIssueHistory({
            req,
            transaction,
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
            transaction,
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

        await transaction.commit();

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
        await transaction.rollback();
        console.error('Error in PM approve issue:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to approve issue'
        });
    }
};

const pmRejectTask = async (req, res) => {
    const transaction = await require('../../models').sequelize.transaction();

    try {
        const { task_id, issue_id, comments, issue_description, issue_register_ids = [], deadline, start_date, end_date, link, task_count = 0 } = req.body;
        const manager = req.user;

        if (!task_id && !issue_id) {
            await transaction.rollback();
            return res.status(400).json({ success: false, error: 'task_id or issue_id is required' });
        }

        const createChangeRequestIssue = async (targetTaskId, parentIssueId) => {
            const versionCount = await IssueAssignments.count({
                where: parentIssueId ? { issue_id: parentIssueId } : { task_id: targetTaskId }
            });
            const issueAssignment = await IssueAssignments.create({
                issue_id: parentIssueId || null,
                task_id: parentIssueId ? null : targetTaskId,
                requested_by_user_id: manager.id,
                assignment_type: 'mod',
                version: `V${versionCount + 1}`,
                description: issue_description || comments || 'PM change request',
                deadline,
                start_date,
                end_date,
                link,
                task_count: task_count || 0,
                intimate_team: 1,
                intimate_client: 0,
                status: 'm_pending',
                review: 'pending',
                review_stage: 'manager_review',
                notification_alert: 1
            }, { transaction });

            if (issue_register_ids && issue_register_ids.length > 0) {
                const issueTypeLinks = issue_register_ids.map(registerId => ({
                    issue_assignment_id: issueAssignment.id,
                    issue_register_id: registerId
                }));
                await IssueAssignmentTypes.bulkCreate(issueTypeLinks, { transaction });
            }

            return issueAssignment;
        };

        if (task_id) {
            const taskId = parseInt(task_id, 10);
            if (isNaN(taskId)) {
                await transaction.rollback();
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

            if (!task) {
                await transaction.rollback();
                return res.status(404).json({ success: false, error: 'Task not found' });
            }

            if (task.intimate_client !== 1) {
                await transaction.rollback();
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
            }, { transaction });

            await TaskReviewHistory.create({
                task_id: taskId,
                reviewer_id: manager.id,
                reviewer_type: 'project_manager',
                action: 'change_request',
                comments: comments || 'PM rejected task and created change request issue',
                previous_stage: task.review_stage || 'pm_review',
                new_stage: 'change_requested'
            }, { transaction });

            await recordTaskHistory({
                req,
                transaction,
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
                transaction,
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
                transaction,
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

            await transaction.commit();
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
            await transaction.rollback();
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

        if (!issueAssignment) {
            await transaction.rollback();
            return res.status(404).json({ success: false, error: 'Issue not found' });
        }

        if (issueAssignment.intimate_client !== 1) {
            await transaction.rollback();
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

        await issueAssignment.update(nextIssueData, { transaction });

        if (issueAssignment.issue_id) {
            await IssueAssignments.update(
                { review: 'change_request', review_stage: 'change_requested' },
                { where: { id: issueAssignment.issue_id }, transaction }
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
            }, { transaction });
        }

        await recordIssueHistory({
            req,
            transaction,
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
            transaction,
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
            transaction,
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

        await transaction.commit();
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
        await transaction.rollback();
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
const getMyTaskRequests = async (req, res) => {

};

const getWorkRequestHistory = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.workRequestId, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
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
    getWorkRequestHistory
};
