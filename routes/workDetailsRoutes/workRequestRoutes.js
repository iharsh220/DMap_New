const express = require('express');
const router = express.Router();
const createWorkRequest = require('../../controller/workDetailsController/workRequestController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const path = require('path');
const fs = require('fs');


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