const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { getAssignedTasks, getTaskById, assignTaskToUser, acceptTask, submitTask } = require('../../controller/userController/userController');

// GET /api/users/tasks - Get assigned tasks (only for division 9 users)
router.get('/tasks', authenticateToken, getAssignedTasks);

// GET /api/users/tasks/:task_id - Get single task details by task ID (no division restriction)
router.get('/tasks/:task_id', authenticateToken, getTaskById);

// POST /api/users/assign-task - Assign task to user (only for managers and super admins)
router.post('/assign-task', authenticateToken, assignTaskToUser);

// PUT /api/users/tasks/:taskId/accept - Accept a task and optionally set start_date (only if intimate_team = 1)
router.put('/tasks/:taskId/accept', authenticateToken, acceptTask);

// POST /api/users/tasks/submit - Submit a task with optional link and files
router.post('/tasks/submit', authenticateToken, submitTask);

module.exports = router;