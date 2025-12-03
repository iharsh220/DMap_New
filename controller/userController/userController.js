const {
    Tasks,
    RequestType,
    TaskType,
    WorkRequests,
    User
} = require('../../models');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const getAssignedTasks = async (req, res) => {
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

        // Get tasks assigned to the user through TaskAssignments junction table
        const tasks = await Tasks.findAll({
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
                    model: RequestType,
                    attributes: ['id', 'request_type', 'description']
                },
                {
                    model: TaskType,
                    attributes: ['id', 'task_type', 'description']
                },
                {
                    model: WorkRequests,
                    attributes: ['id', 'project_name', 'brand', 'priority', 'status']
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
        console.error('Error fetching assigned tasks:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch assigned tasks'
        });
    }
};

module.exports = {
    getAssignedTasks
};