const express = require('express');
const router = express.Router();
const { getAssignedWorkRequests, getAssignedWorkRequestById, acceptWorkRequest, acceptIssueRequest, cancelIssueRequest, deferWorkRequest, updateWorkRequestProject, deleteWorkRequest, cancelWorkRequest, deleteTask, getMyTasks, getAssignableUsers, getTaskTypesByWorkRequest, createTask, getTasksByWorkRequestId, getTaskAnalytics, getMyTeam, getAssignedRequestsWithStatus, getUserTask, updateTask, reviewTaskDocument, reviewIssueDocument, reviewTask, shareForClientReview, assignIssueToUser, getIssueAssignments, completeAllTasksAndIssues, getTaskHistory, getIssueHistory, getCancelPreview } = require('../../controller/managerAssignedController/managerAssignedController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');
const { blockIfProjectCancelled: ro } = require('../../services/projectCancellationService'); // a cancelled project is read-only

// Task management routes (must come before parameterized routes)
router.post('/tasks', authenticateToken, checkRole([1, 2, 3]), ro(req => ['workRequest', req.body.work_request_id]), createTask); // Create a new task
router.put('/tasks/:taskId', authenticateToken, checkRole([1, 2, 3]), ro(req => ['task', req.params.taskId]), updateTask); // Update a task by ID
router.delete('/tasks/:taskId', authenticateToken, checkRole([1, 2, 3]), ro(req => ['task', req.params.taskId]), deleteTask); // Delete a task by ID
router.put('/review', authenticateToken, checkRole([1, 2, 3]), ro(req => (req.body.action === 'change_request' ? (req.body.task_id ? ['task', req.body.task_id] : ['change', req.body.issue_id]) : null)), reviewTask); // Review (approve/change_request) a task or issue (use task_id or issue_id in body)
router.post('/share-for-client-review', authenticateToken, checkRole([1, 2, 3]), shareForClientReview); // Share task or issue with client for PM review (use task_id or issue_id in body)
router.get('/work-request/:work_request_id/tasks', authenticateToken, checkRole([1, 2, 3]), getTasksByWorkRequestId); // Get tasks for a specific work request
router.get('/user/:user_id/tasks', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getUserTask); // Get tasks for a specific user with status filter and pagination

// Document review routes
router.put('/documents/:documentId/review', authenticateToken, checkRole([1, 2, 3]), ro(req => (req.body.review === 'change_request' ? ['taskDocument', req.params.documentId] : null)), reviewTaskDocument); // Review (approve/change_request) a task document
router.put('/issue-documents/:documentId/review', authenticateToken, checkRole([1, 2, 3]), ro(req => (req.body.review === 'change_request' ? ['changeDocument', req.params.documentId] : null)), reviewIssueDocument); // Review (approve/change_request) an issue document

// Manager-specific routes for viewing assigned work requests
router.get('/', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedWorkRequests); // Get all requests assigned to the manager
router.get('/requests', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedRequestsWithStatus); // Get requests assigned to the manager with optional status filter

router.get('/my-team', authenticateToken, checkRole([1, 2, 3]), searchMiddleware, paginationMiddleware, getMyTeam); // Get manager's team with task counts grouped by division
router.get('/my-tasks', authenticateToken, checkRole([1, 2, 3]), getMyTasks); // Get tasks assigned to the manager themselves

// Issue assignment routes - must come before /:id routes
router.get('/issue-assignments', authenticateToken, checkRole([1, 2, 3]), filterMiddleware, paginationMiddleware, searchMiddleware, getIssueAssignments); // Get all issue assignments with filters (status, review_stage, review)
router.post('/assign-issue-to-user', authenticateToken, checkRole([1, 2, 3]), ro(req => ['change', req.body.issue_assignment_id]), assignIssueToUser); // Assign issue to a user
router.put('/issue/:id/accept', authenticateToken, checkRole([1, 2, 3]), ro(req => ['change', req.params.id]), acceptIssueRequest); // Accept an issue request
router.put('/issue/:id/cancel', authenticateToken, checkRole([1, 2, 3]), ro(req => ['change', req.params.id]), cancelIssueRequest); // Cancel an issue request (soft delete + reset parent issue to pm_review + notify PMT)
router.get('/history/task/:taskId', authenticateToken, checkRole([1, 2, 3, 4]), getTaskHistory);
router.get('/history/issue/:issueAssignmentId', authenticateToken, checkRole([1, 2, 3, 4]), getIssueHistory);

router.get('/:id', authenticateToken, checkRole([1, 2, 3, 4]), getAssignedWorkRequestById); // Get specific assigned work request by ID
router.put('/:id/accept', authenticateToken, checkRole([1, 2, 3]), ro(req => ['workRequest', req.params.id]), acceptWorkRequest); // Accept a work request
router.put('/:id/defer', authenticateToken, checkRole([1, 2, 3]), ro(req => ['workRequest', req.params.id]), deferWorkRequest); // Defer a work request
// latest code..!!
router.put('/:id/project', authenticateToken, checkRole([1, 2, 3]), ro(req => ['workRequest', req.params.id]), updateWorkRequestProject); // Update work request project
router.delete('/:id', authenticateToken, checkRole([1, 2, 3]), deleteWorkRequest); // Delete a work request
router.get('/:id/cancel-preview', authenticateToken, checkRole([1, 2, 3]), getCancelPreview); // What cancelling this project today would do (summary before confirming)
router.put('/:id/cancel', authenticateToken, checkRole([1, 2, 3]), cancelWorkRequest); // Cancel a work request (body: reason)

router.get('/:id/assignable-users', authenticateToken, checkRole([1, 2, 3]), getAssignableUsers); // Get users that can be assigned tasks for a specific work request
router.get('/id/task-types', authenticateToken, checkRole([1, 2, 3]), getTaskTypesByWorkRequest); // Get task types for a specific work request based on its project_id or directly by project_id query param
router.get('/:id/analytics', authenticateToken, checkRole([1, 2, 3]), getTaskAnalytics); // Get task analytics for a specific work request

// Complete all tasks and issues for a work request
router.put('/complete', authenticateToken, ro(req => ['workRequest', req.body.work_request_id]), completeAllTasksAndIssues); // Complete all tasks and issues for a work request

module.exports = router;