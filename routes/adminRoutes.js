const express = require('express');
const router = express.Router();
const path = require('path');
const { getAdminData, getTaskDetailsData, getTasksForWorkRequest, getIssueDetailsData, getWorkRequestTasksData, getDeletePreview, deleteProject, deleteTask, deleteIssue } = require('../controller/adminController');

// Serve shared CSS theme
router.get('/admin/dmap-theme.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '..', 'public', 'dmap-theme.css'));
});

// Serve admin panel HTML
router.get('/admin/projectsdetails', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Serve task details HTML
router.get('/admin/taskdetails', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'taskdetails.html'));
});

// Serve issue details HTML
router.get('/admin/issuedetails', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'issuedetails.html'));
});

// Serve workrequest tasks raw data HTML
router.get('/admin/workrequesttasks', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'workrequesttasks.html'));
});

// API endpoint for project details data
router.get('/admin/projectsdetails/data', getAdminData);

// API endpoint for task details data
router.get('/admin/taskdetails/data', getTaskDetailsData);

// API endpoint for issue details data
router.get('/admin/issuedetails/data', getIssueDetailsData);

// API endpoint for workrequest tasks raw data
router.get('/admin/workrequesttasks/data', getWorkRequestTasksData);

// API endpoint for tasks
router.get('/admin/projectsdetails/tasks/:workRequestId', getTasksForWorkRequest);

// Delete preview
router.get('/admin/delete/preview/:type/:id', getDeletePreview);

// Delete endpoints
router.delete('/admin/delete/project/:id', deleteProject);
router.delete('/admin/delete/task/:id', deleteTask);
router.delete('/admin/delete/issue/:id', deleteIssue);

module.exports = router;
