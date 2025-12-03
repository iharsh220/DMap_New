const {
    Tasks,
    RequestType,
    TaskType,
    TaskAssignments,
    TaskDependencies,
    WorkRequests,
    WorkRequestManagers,
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

const getTaskById = async (req, res) => {
    try {
        const taskId = parseInt(req.params.task_id, 10);
        if (isNaN(taskId)) {
            return res.status(400).json({ success: false, error: 'Invalid task ID' });
        }

        // Get single task with full details - only if assigned to current user
        const taskResult = await Tasks.findOne({
            where: { id: taskId },
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
                    attributes: ['id', 'task_type', 'description']
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

module.exports = {
    getAssignedTasks,
    getTaskById
};