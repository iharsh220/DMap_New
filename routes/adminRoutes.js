const express = require('express');
const router = express.Router();
const path = require('path');
const { cachedAdminData, invalidateAdminCache } = require('../services/adminCacheService');
const { getAdminData, getClientsData, getTaskDetailsData, getTasksForWorkRequest, getIssueDetailsData, getWorkRequestTasksData, getDeletePreview, deleteProject, deleteClient, deleteTask, deleteIssue, getEditData, getRequestTypes, getProjectTypesByProject, getCreativeManagerByProject, updateProject, updateClient, updateTask, updateIssue } = require('../controller/adminController');

// Serve shared CSS theme
router.get('/admin/dmap-theme.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '..', 'public', 'dmap-theme.css'));
});

// Serve clients HTML
router.get('/admin/clients', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'clients.html'));
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

// Serve Power BI dashboard HTML
router.get('/admin/powerbi', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'powerbi.html'));
});

// API endpoint for project details data
router.get('/admin/projectsdetails/data', cachedAdminData(getAdminData));

// API endpoint for clients data
router.get('/admin/clients/data', cachedAdminData(getClientsData));

// API endpoint for task details data
router.get('/admin/taskdetails/data', cachedAdminData(getTaskDetailsData));

// API endpoint for issue details data
router.get('/admin/issuedetails/data', cachedAdminData(getIssueDetailsData));

// API endpoint for workrequest tasks raw data
router.get('/admin/workrequesttasks/data', cachedAdminData(getWorkRequestTasksData));

// API endpoint for tasks
router.get('/admin/projectsdetails/tasks/:workRequestId', cachedAdminData(getTasksForWorkRequest));

// Delete preview
router.get('/admin/delete/preview/:type/:id', cachedAdminData(getDeletePreview));

// Delete endpoints
router.delete('/admin/delete/project/:id', invalidateAdminCache, deleteProject);
router.delete('/admin/delete/client/:id', invalidateAdminCache, deleteClient);
router.delete('/admin/delete/task/:id', invalidateAdminCache, deleteTask);
router.delete('/admin/delete/issue/:id', invalidateAdminCache, deleteIssue);

// Edit - get current data
router.get('/admin/edit/:type/:id', getEditData);

// Get all request types for dropdown
router.get('/admin/edit/project/:id/request-types', getRequestTypes);

// Get project types for a project (optionally filtered by request_type_id)
router.get('/admin/edit/project/:id/project-types', getProjectTypesByProject);

// Get creative manager for a project (optionally filtered by request_type_id)
router.get('/admin/edit/project/:id/creative-manager', getCreativeManagerByProject);

// Edit - update endpoints
router.put('/admin/edit/project/:id', invalidateAdminCache, updateProject);
router.put('/admin/edit/client/:id', invalidateAdminCache, updateClient);
router.put('/admin/edit/task/:id', invalidateAdminCache, updateTask);
router.put('/admin/edit/issue/:id', invalidateAdminCache, updateIssue);

module.exports = router;
