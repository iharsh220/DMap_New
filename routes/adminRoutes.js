const express = require('express');
const router = express.Router();
const path = require('path');
const { getAdminData, getTasksForWorkRequest } = require('../controller/adminController');

// Serve admin panel HTML
router.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// API endpoint for data
router.get('/admin/data', getAdminData);

// API endpoint for tasks
router.get('/admin/tasks/:workRequestId', getTasksForWorkRequest);

module.exports = router;