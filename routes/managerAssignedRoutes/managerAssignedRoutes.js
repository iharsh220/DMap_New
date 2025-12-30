const express = require('express');
const router = express.Router();
const { getAssignedWorkRequests, getAssignedWorkRequestById, acceptWorkRequest, deferWorkRequest, getAssignableUsers, getTaskTypesByWorkRequest, createTask, getTasksByWorkRequestId, getTaskAnalytics, getMyTeam, assignTasksToUsers, getAssignedRequestsWithStatus, getUserTask } = require('../../controller/managerAssignedController/managerAssignedController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');

// Task management routes (must come before parameterized routes)
router.post('/tasks', authenticateToken, checkRole([1, 2, 3]), createTask); // Create a new task
router.get('/work-request/:work_request_id/tasks', authenticateToken, checkRole([1, 2, 3]), getTasksByWorkRequestId); // Get tasks for a specific work request
router.get('/user/:user_id/tasks', authenticateToken, checkRole([1, 2, 3]), getUserTask); // Get tasks for a specific user

// Manager-specific routes for viewing assigned work requests
router.get('/', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedWorkRequests); // Get all requests assigned to the manager
router.get('/requests', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedRequestsWithStatus); // Get requests assigned to the manager with optional status filter

router.get('/my-team', authenticateToken, checkRole([1, 2, 3]), searchMiddleware, paginationMiddleware, getMyTeam); // Get manager's team with task counts grouped by division
router.get('/:id', authenticateToken, checkRole([1, 2, 3, 4]), getAssignedWorkRequestById); // Get specific assigned work request by ID
router.put('/:id/accept', authenticateToken, checkRole([1, 2, 3]), acceptWorkRequest); // Accept a work request
router.put('/:id/defer', authenticateToken, checkRole([1, 2, 3]), deferWorkRequest); // Defer a work request

router.get('/:id/assignable-users', authenticateToken, checkRole([1, 2, 3]), getAssignableUsers); // Get users that can be assigned tasks for a specific work request
router.get('/:id/task-types', authenticateToken, checkRole([1, 2, 3]), getTaskTypesByWorkRequest); // Get task types for a specific work request based on its project_id
router.get('/:id/analytics', authenticateToken, checkRole([1, 2, 3]), getTaskAnalytics); // Get task analytics for a specific work request
router.post('/:id/assign-tasks', authenticateToken, checkRole([1, 2, 3]), assignTasksToUsers); // Send task assignment notifications to users

module.exports = router;