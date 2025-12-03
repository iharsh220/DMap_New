const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { getAssignedTasks, getTaskById, assignTaskToUser } = require('../../controller/userController/userController');

// GET /api/users/tasks - Get assigned tasks (only for division 9 users)
router.get('/tasks', authenticateToken, getAssignedTasks);

// GET /api/users/tasks/:task_id - Get single task details by task ID (no division restriction)
router.get('/tasks/:task_id', authenticateToken, getTaskById);

// POST /api/users/assign-task - Assign task to user (only for managers and super admins)
router.post('/assign-task', authenticateToken, assignTaskToUser);

module.exports = router;