const { Op } = require('sequelize');
const {
    IssueRegister,
    ChangeIssueTasktype,
    Tasks
} = require('../../models');

// Get issue register data by task ID
// Logic: task_id -> get task_type_id from tasks -> find issue_register via change_issue_tasktype
const getIssueRegisterByTaskId = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        // Check if task exists and get task_type_id
        const task = await Tasks.findByPk(taskId, {
            attributes: ['id', 'task_name', 'task_type_id']
        });

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        const taskTypeId = task.task_type_id;

        if (!taskTypeId) {
            return res.status(400).json({
                success: false,
                error: 'Task does not have a task_type_id associated'
            });
        }

        // Get issue register entries linked to this task_type_id through change_issue_tasktype
        // Note: change_issue_tasktype.task_id actually stores task_type_id (naming inconsistency in table)
        const issueRegisters = await IssueRegister.findAll({
            include: [
                {
                    model: ChangeIssueTasktype,
                    as: 'taskChangeIssues',
                    where: { task_id: taskTypeId }, // This is task_type_id
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
                    task_name: task.task_name,
                    task_type_id: task.task_type_id
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
