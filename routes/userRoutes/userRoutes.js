const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { getAssignedTasks, getTasksByWorkRequestId } = require('../../controller/userController/userController');

// GET /api/users/tasks - Get assigned tasks (only for division 9 users)
router.get('/tasks', authenticateToken, getAssignedTasks);

// GET /api/users/work-requests/:work_request_id/tasks - Get all tasks for a work request (only for division 9 users)
router.get('/work-requests/:work_request_id/tasks', authenticateToken, getTasksByWorkRequestId);

module.exports = router;