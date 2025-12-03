const {
    Tasks,
    RequestType,
    TaskType,
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

const getTasksByWorkRequestId = async (req, res) => {
    try {
        const workRequestId = parseInt(req.params.work_request_id, 10);
        if (isNaN(workRequestId)) {
            return res.status(400).json({ success: false, error: 'Invalid work request ID' });
        }

        const user_id = req.user.id;

        // Check if user is in division 9
        const isInDivision9 = req.user.divisions.some(division => division.id === 9);
        if (!isInDivision9) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. This endpoint is only available for division 9 users.'
            });
        }

        // Get tasks for the work request with full details
        const tasksResult = await Tasks.findAll({
            where: { work_request_id: workRequestId },
            include: [
                {
                    model: TaskAssignments,
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }
                    ],
                    attributes: ['id', 'assigned_at']
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
            attributes: { exclude: ['created_at', 'updated_at'] },
            order: [['created_at', 'ASC']]
        });

        await logUserActivity({
            event: 'work_request_tasks_viewed',
            userId: req.user.id,
            workRequestId: workRequestId,
            taskCount: tasksResult.length,
            ...extractRequestDetails(req)
        });

        res.json({
            success: true,
            data: tasksResult,
            message: 'Tasks retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching tasks by work request:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch tasks'
        });
    }
};

module.exports = {
    getAssignedTasks,
    getTasksByWorkRequestId
};