const CrudService = require('../../services/crudService');
const { WorkRequests, WorkMedium, User, WorkRequestDocuments } = require('../../models');
const path = require('path');

const workRequestService = new CrudService(WorkRequests);

// Create work request
const createWorkRequest = async (req, res) => {
    try {
        const { project_name, brand, work_medium_id, project_details, priority = 'medium', remarks } = req.body;
        const user_id = req.user.id; // From JWT middleware

        // Validate required fields
        if (!project_name || !work_medium_id) {
            return res.status(400).json({
                success: false,
                error: 'Project name and work medium ID are required'
            });
        }

        // Get work medium to find division
        const workMedium = await WorkMedium.findByPk(work_medium_id, {
            include: [{ model: require('../../models').Division, as: 'Division' }]
        });
        if (!workMedium) {
            return res.status(400).json({
                success: false,
                error: 'Invalid work medium ID'
            });
        }

        // Find manager in the same division with Creative Manager role
        const manager = await User.findOne({
            where: {
                division_id: workMedium.division_id,
                job_role_id: 2, // Creative Manager
                account_status: 'active'
            }
        });

        if (!manager) {
            return res.status(400).json({
                success: false,
                error: 'No manager found for this work medium'
            });
        }

        // Create work request
        const workRequestData = {
            user_id,
            project_name,
            brand,
            work_medium_id,
            project_details,
            priority,
            status: 'pending',
            requested_manager_id: manager.id,
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

        // Handle file uploads
        const workRequestId = result.data.id;
        const documents = [];

        if (req.files && req.files.documents) {
            const files = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];
            for (const file of files) {
                // Generate unique filename
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = file.name.replace(/[^a-zA-Z0-9.]/g, '_') + '-' + uniqueSuffix + path.extname(file.name);
                const filepath = path.join(req.uploadPath, filename);

                // Move file to upload path
                await file.mv(filepath);

                const documentData = {
                    work_request_id: workRequestId,
                    document_name: file.name,
                    document_path: `/work-requests/uploads/${req.projectName}/${filename}`,
                    document_type: file.mimetype,
                    document_size: file.size,
                    uploaded_at: new Date()
                };

                const docResult = await WorkRequestDocuments.create(documentData);
                documents.push(docResult);
            }
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

module.exports = createWorkRequest;