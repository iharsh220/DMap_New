const express = require('express');
const router = express.Router();
const path = require('path');
const paginationMiddleware = require('../middleware/paginationMiddleware');
const { cachedAdminData, invalidateAdminCache } = require('../services/adminCacheService');
const { getAdminData, getAllFeedback, getClientsData,getTaskDetailsData, getTasksForWorkRequest, getIssueDetailsData, getWorkRequestTasksData, getDeletePreview, deleteProject, deleteClient, deleteTask, deleteIssue, getAllLeaves, getLeaveById, createLeave, updateLeave, deleteLeave, getLeaveKpis, getLeaveUsers, getUserDivision, uploadLeaves, exportLeavesCsv, exportLeavesExcel, getEditData, getRequestTypes, getProjectTypesByProject, getCreativeManagerByProject, updateProject, updateClient, updateTask, updateIssue, getMasterCardData, uploadMasterCard, updateMasterCard, deleteMasterCard, sseProgress, updateMasterCardField, getFinancialYears } = require('../controller/adminController');

// Serve shared CSS theme
router.get('/admin/dmap-theme.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '..', 'public', 'dmap-theme.css'));
});

// Serve shared theme toggle JS
router.get('/admin/admin-theme.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, '..', 'public', 'admin-theme.js'));
});

// Serve login HTML
router.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Serve clients HTML
router.get('/admin/clients', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'clients.html'));
});

// Serve admin panel HTML (tab-based dashboard)
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

// Serve leaves HTML
router.get('/admin/leaves', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'leaves.html'));
 });
 
 // Serve master card HTML
router.get('/admin/master-card', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'master-card.html'));
});

// API endpoint for master card data
router.get('/admin/master-card/data', paginationMiddleware, cachedAdminData(getMasterCardData));

// Upload master card data (Excel/CSV)
router.post('/admin/master-card/upload', uploadMasterCard);

// SSE progress endpoint for master card upload
router.get('/admin/master-card/upload/progress/:jobId', sseProgress);

// Update master card rate
router.put('/admin/master-card/:id', updateMasterCard);

// Get distinct financial years
router.get('/admin/master-card/financial-years', getFinancialYears);

// Bulk update master card field across all records
router.put('/admin/master-card/field/:field', updateMasterCardField);

// Delete master card rate
router.delete('/admin/master-card/:id', deleteMasterCard);

 // API endpoint for project details data
router.get('/admin/projectsdetails/data', paginationMiddleware, cachedAdminData(getAdminData));

// API endpoint for clients data
router.get('/admin/clients/data', paginationMiddleware, cachedAdminData(getClientsData));

// API endpoint for task details data
router.get('/admin/taskdetails/data', paginationMiddleware, cachedAdminData(getTaskDetailsData));

// API endpoint for issue details data
router.get('/admin/issuedetails/data', paginationMiddleware, cachedAdminData(getIssueDetailsData));

// API endpoint for workrequest tasks raw data
router.get('/admin/workrequesttasks/data', paginationMiddleware, cachedAdminData(getWorkRequestTasksData));

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

// Serve feedback HTML
router.get('/admin/feedback', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html'));
});

// API endpoint for feedback data
router.get('/admin/feedback/data', paginationMiddleware, getAllFeedback);

// API endpoint for leaves data
router.get('/admin/leaves/data', paginationMiddleware, getAllLeaves);
router.get('/admin/leaves/users', getLeaveUsers);
router.get('/admin/leaves/users/:userId/division', getUserDivision);
router.get('/admin/leaves/kpis', getLeaveKpis);
router.get('/admin/leaves/export/excel', exportLeavesExcel);
router.get('/admin/leaves/export/csv', exportLeavesCsv);
router.get('/admin/leaves/:id', getLeaveById);
router.post('/admin/leaves', createLeave);
router.put('/admin/leaves/:id', updateLeave);
router.delete('/admin/leaves/:id', deleteLeave);
router.post('/admin/leaves/upload', uploadLeaves);
router.get('/admin/leaves/upload/progress/:jobId', sseProgress);

module.exports = router;
