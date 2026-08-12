const express = require('express');
const router = express.Router();
const { createWorkRequest, updateWorkRequest, getMyWorkRequests, getMyTaskRequests, getWorkRequestById, getProjectTypesByRequestType, getAboutProjectOptions, getDivisionWorkRequests, getDivisionWorkRequestById, getUserDashboardStats, pmApproveTask, pmRejectTask, getWorkRequestHistory, submitFeedback, getFeedback } = require('../../controller/workRequestController/workRequestController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');
const path = require('path');
const fs = require('fs');


// GET /work-requests/my-requests - Get user's work requests
router.get('/my-requests', authenticateToken, filterMiddleware, paginationMiddleware, searchMiddleware, getMyWorkRequests);

// GET /work-requests/my-task-requests - Get user's task requests based on issue_assignments
router.get('/my-task-requests', authenticateToken, filterMiddleware, paginationMiddleware, searchMiddleware, getMyTaskRequests);

// GET /work-requests/project-types - Get project types by request type
router.get('/project-types', authenticateToken, getProjectTypesByRequestType);

// GET /work-requests/about-project-options - Get about project options
router.get('/about-project-options', authenticateToken, getAboutProjectOptions);

// GET /work-requests/dashboard-stats - Get user dashboard statistics
router.get('/dashboard-stats', authenticateToken, getUserDashboardStats);

// POST /work-requests/pm-approve - PM approve task
router.post('/pm-approve', authenticateToken, pmApproveTask);
router.post('/pm-reject', authenticateToken, pmRejectTask);

// GET /work-requests/history/:workRequestId - Get work request history
router.get('/history/:workRequestId', authenticateToken, getWorkRequestHistory);

// GET /work-requests/:id - Get work request by ID
router.get('/:id', authenticateToken, getWorkRequestById);

// GET /work-requests/division/all - Get all work requests from users in same division
router.get('/division/all', authenticateToken, filterMiddleware, paginationMiddleware, searchMiddleware, getDivisionWorkRequests);

// GET /work-requests/division/:id - Get work request by ID from same division
router.get('/division/:id', authenticateToken, getDivisionWorkRequestById);
// POST /work-requests - Create work request
router.post('/', authenticateToken, (req, res, next) => {
    req.projectName = req.body.project_name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Unknown';

    // Set upload path
    req.uploadPath = path.join('uploads', req.projectName);

    // Create directory if it doesn't exist
    if (!fs.existsSync(req.uploadPath)) {
        fs.mkdirSync(req.uploadPath, { recursive: true });
    }

    next();
}, createWorkRequest);

// PUT /work-requests/:id - Update work request by ID
router.put('/:id', authenticateToken, (req, res, next) => {
    req.projectName = req.body.project_name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Unknown';

    // Set upload path
    req.uploadPath = path.join('uploads', req.projectName);

    // Create directory if it doesn't exist
    if (!fs.existsSync(req.uploadPath)) {
        fs.mkdirSync(req.uploadPath, { recursive: true });
    }

    next();
}, updateWorkRequest);

// Feedback Routes
// POST /work-requests/tasks/:taskId/feedback - Submit feedback for a task
router.post('/tasks/:taskId/feedback', authenticateToken, submitFeedback);

// GET /work-requests/tasks/:taskId/feedback - Get feedback for a task
router.get('/tasks/:taskId/feedback', authenticateToken, getFeedback);

module.exports = router;