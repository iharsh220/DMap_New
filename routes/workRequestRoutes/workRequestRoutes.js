const express = require('express');
const router = express.Router();
const { createWorkRequest, getMyWorkRequests, getWorkRequestById, getProjectTypesByRequestType, getAboutProjectOptions } = require('../../controller/workRequestController/workRequestController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');
const path = require('path');
const fs = require('fs');


// GET /work-requests/my-requests - Get user's work requests
router.get('/my-requests', authenticateToken, filterMiddleware, paginationMiddleware, searchMiddleware, getMyWorkRequests);

// GET /work-requests/project-types - Get project types by request type
router.get('/project-types', authenticateToken, getProjectTypesByRequestType);

// GET /work-requests/about-project-options - Get about project options
router.get('/about-project-options', authenticateToken, getAboutProjectOptions);

// GET /work-requests/:id - Get work request by ID
router.get('/:id', authenticateToken, getWorkRequestById);

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


router.get(`/uploads/*`, authenticateToken, (req, res) => {
    const filePath = req.params[0];
    const fullPath = path.resolve('uploads', filePath);
    if (!fullPath.startsWith(path.resolve('uploads') + path.sep)) {
        return res.status(404).json({ error: 'File not found' });
    }
    if (fs.existsSync(fullPath)) {
        res.sendFile(fullPath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

module.exports = router;