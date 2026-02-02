const express = require('express');
const router = express.Router();
const path = require('path');
const { getAdminData, getTaskDetailsData, getTasksForWorkRequest } = require('../controller/adminController');

// Serve admin panel HTML
router.get('/admin/projectsdetails', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Serve task details HTML
router.get('/admin/taskdetails', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'taskdetails.html'));
});

// API endpoint for project details data
router.get('/admin/projectsdetails/data', getAdminData);

// API endpoint for task details data
router.get('/admin/taskdetails/data', getTaskDetailsData);

// API endpoint for tasks
router.get('/admin/projectsdetails/tasks/:workRequestId', getTasksForWorkRequest);

module.exports = router;
