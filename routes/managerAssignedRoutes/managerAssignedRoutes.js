const express = require('express');
const router = express.Router();
const { getAssignedWorkRequests, getAssignedWorkRequestById, acceptWorkRequest, deferWorkRequest, getAssignableUsers, getTaskTypesByWorkRequest, createTask, getTasks, getTasksByWorkRequestId } = require('../../controller/managerAssignedController/managerAssignedController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');

// Task management routes (must come before parameterized routes)
router.post('/tasks', authenticateToken, checkRole([1, 2, 3]), createTask); // Create a new task
router.get('/tasks', authenticateToken, checkRole([1, 2, 3]), getTasks); // Get all tasks for the manager
router.get('/work-request/:work_request_id/tasks', authenticateToken, checkRole([1, 2, 3]), getTasksByWorkRequestId); // Get tasks for a specific work request

// Manager-specific routes for viewing assigned work requests
router.get('/', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedWorkRequests); // Get all requests assigned to the manager
router.get('/:id', authenticateToken, checkRole([1, 2, 3]), getAssignedWorkRequestById); // Get specific assigned work request by ID
router.put('/:id/accept', authenticateToken, checkRole([1, 2, 3]), acceptWorkRequest); // Accept a work request
router.put('/:id/defer', authenticateToken, checkRole([1, 2, 3]), deferWorkRequest); // Defer a work request

router.get('/:id/assignable-users', authenticateToken, checkRole([1, 2, 3]), getAssignableUsers); // Get users that can be assigned tasks for a specific work request
router.get('/:id/task-types', authenticateToken, checkRole([1, 2, 3]), getTaskTypesByWorkRequest); // Get task types for a specific work request based on its project_id

module.exports = router;