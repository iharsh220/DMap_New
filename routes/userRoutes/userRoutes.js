const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');
const { getAssignedTasks, getMyTeamTasks, getTaskById, assignTaskToUser, acceptTask, submitTask, getTaskDocuments, deleteTaskDocument, getAssignedIssues, acceptIssue, submitIssue } = require('../../controller/userController/userController');

// GET /api/users/tasks - Get assigned tasks (only for division 9 users or managers)
router.get('/tasks', authenticateToken, filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedTasks);

// GET /api/users/my-team - Get in-progress tasks from user's division (only for division 9 users)
router.get('/my-team', authenticateToken, getMyTeamTasks);

// GET /api/users/tasks/:task_id - Get single task details by task ID (no division restriction)
router.get('/tasks/:task_id', authenticateToken, getTaskById);

// POST /api/users/assign-task - Assign task to user (only for managers and super admins)
router.post('/assign-task', authenticateToken, assignTaskToUser);

// PUT /api/users/tasks/:taskId/accept - Accept a task and optionally set start_date (only if intimate_team = 1)
router.put('/tasks/:taskId/accept', authenticateToken, acceptTask);

// POST /api/users/tasks/submit - Submit a task with optional link and files
router.post('/tasks/submit', authenticateToken, submitTask);

// GET /api/users/tasks/:task_id/documents - Get all documents for a task
router.get('/tasks/:task_id/documents', authenticateToken, getTaskDocuments);

// DELETE /api/users/documents/:document_id - Delete a document by ID
router.delete('/documents/:document_id', authenticateToken, deleteTaskDocument);

// Issue Routes
// GET /api/users/issues - Get issues assigned to the user
router.get('/issues', authenticateToken, getAssignedIssues);

// PUT /api/users/issues/:issueId/accept - Accept an issue
router.put('/issues/:issueId/accept', authenticateToken, acceptIssue);

// POST /api/users/issues/submit - Submit/complete an issue
router.post('/issues/submit', authenticateToken, submitIssue);

module.exports = router;