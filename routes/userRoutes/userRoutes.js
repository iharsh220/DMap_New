const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { getAssignedTasks } = require('../../controller/userController/userController');

// GET /api/users/tasks - Get assigned tasks (only for division 9 users)
router.get('/tasks', authenticateToken, getAssignedTasks);

module.exports = router;