const { Op } = require('sequelize');
const {
    IssueRegister,
    ChangeIssueTasktype,
    Tasks
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

module.exports = {
    getIssueRegisterByTaskId,
    getAllIssueRegisters
};
