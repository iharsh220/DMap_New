const { Op } = require('sequelize');
const {
    IssueRegister,
    ChangeIssueTasktype,
    Tasks,
    WorkRequests,
    TaskAssignments,
    TaskDocuments
} = require('../../models');

// Get issue register data by task ID
const getIssueRegisterByTaskId = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        // Check if task exists
        const task = await Tasks.findByPk(taskId, {
            attributes: ['id', 'task_name']
        });

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        // Get issue register entries linked to this task through change_issue_tasktype
        const issueRegisters = await IssueRegister.findAll({
            include: [
                {
                    model: ChangeIssueTasktype,
                    as: 'taskChangeIssues',
                    where: { task_id: taskId },
                    attributes: ['id', 'task_id', 'change_issue_id', 'created_at', 'updated_at'],
                    required: true
                }
            ],
            attributes: ['id', 'change_issue_type', 'description', 'quantification', 'created_at', 'updated_at']
        });

        res.json({
            success: true,
            data: {
                task: {
                    id: task.id,
                    task_name: task.task_name
                },
                issue_registers: issueRegisters
            },
            message: 'Issue register data retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch issue register data'
        });
    }
};

// Get all issue register entries
const getAllIssueRegisters = async (req, res) => {
    try {
        const issueRegisters = await IssueRegister.findAll({
            attributes: ['id', 'change_issue_type', 'description', 'quantification', 'created_at', 'updated_at'],
            order: [['id', 'ASC']]
        });

        res.json({
            success: true,
            data: issueRegisters,
            message: 'All issue register entries retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching issue register data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch issue register data'
        });
    }
};

// Get tasks by work request ID for client review (intimate_client=1 and review_stage=pm_review)
const getTasksForClientReview = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.work_request_id, 10);
        
        if (isNaN(workRequestId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid work request ID'
            });
        }

        // Check if work request exists
        const workRequest = await WorkRequests.findByPk(workRequestId, {
            attributes: ['id', 'project_name', 'brand', 'status']
        });

        if (!workRequest) {
            return res.status(404).json({
                success: false,
                error: 'Work request not found'
            });
        }

        // Get tasks where intimate_client=1 and review_stage=pm_review
        const tasks = await Tasks.findAll({
            where: {
                work_request_id: workRequestId,
                intimate_client: 1,
                review_stage: 'pm_review'
            },
            attributes: ['id', 'task_name', 'status', 'review_stage', 'intimate_client', 'deadline'],
            order: [['id', 'ASC']]
        });

        // Get documents for each task where intimate_client=1
        const tasksWithDocuments = await Promise.all(tasks.map(async (task) => {
            // Get task assignments for this task
            const taskAssignments = await TaskAssignments.findAll({
                where: { task_id: task.id },
                attributes: ['id']
            });

            const taskAssignmentIds = taskAssignments.map(ta => ta.id);

            // Get documents where intimate_client=1
            const documents = await TaskDocuments.findAll({
                where: {
                    task_assignment_id: { [Op.in]: taskAssignmentIds },
                    intimate_client: 1
                },
                attributes: ['id', 'document_name', 'document_path', 'document_type', 'document_size', 'version', 'status', 'review', 'intimate_client', 'uploaded_at']
            });

            return {
                ...task.toJSON(),
                documents: documents
            };
        }));

        res.json({
            success: true,
            data: {
                work_request: {
                    id: workRequest.id,
                    project_name: workRequest.project_name,
                    brand: workRequest.brand,
                    status: workRequest.status
                },
                tasks: tasksWithDocuments,
                total_tasks: tasksWithDocuments.length
            },
            message: 'Tasks for client review retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching tasks for client review:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch tasks for client review'
        });
    }
};

module.exports = {
    getIssueRegisterByTaskId,
    getAllIssueRegisters,
    getTasksForClientReview
};
