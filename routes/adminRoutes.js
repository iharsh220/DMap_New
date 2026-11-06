const express = require('express');
const router = express.Router();
const path = require('path');
const paginationMiddleware = require('../middleware/paginationMiddleware');
const { authenticateToken } = require('../middleware/jwtMiddleware');
const { checkRole } = require('../middleware/roleMiddleware');
const { reportAccess, getReportData, postReportAction, uploadHighlight, generateReport, downloadReport, highlightImage } = require('../controller/weeklyReportController');
const { cachedAdminData, invalidateAdminCache } = require('../services/adminCacheService');
const { getAdminData, getAllFeedback, getClientsData,getTaskDetailsData, getTasksForWorkRequest, getIssueDetailsData, getWorkRequestTasksData, getDeletePreview, deleteProject, deleteClient, deleteTask, deleteIssue, getAllLeaves, getLeaveById, createLeave, updateLeave, deleteLeave, getLeaveKpis, getLeaveUsers, getUserDivision, uploadLeaves, exportLeavesCsv, exportLeavesExcel, getEditData, getRequestTypes, getProjectTypesByProject, getCreativeManagerByProject, updateProject, updateClient, updateTask, updateIssue, getMasterCardData, uploadMasterCard, updateMasterCard, deleteMasterCard, sseProgress, updateMasterCardField, getFinancialYears, getFilterOptions, getOverviewData } = require('../controller/adminController');

// Every admin API call needs a valid access token. Only the HTML pages, their shared
// CSS/JS and the upload progress streams (EventSource cannot send headers; they are
// keyed by a random job id) are served without one.
const PUBLIC_ADMIN_GET_PATHS = /^\/admin\/(login|overview|master-data|whats-new|clients|projectsdetails|taskdetails|issuedetails|workrequesttasks|powerbi|leaves|master-card|feedback|reports|dmap-theme\.css|admin-app\.js)$|^\/admin\/(leaves|master-card)\/upload\/progress\/[^/]+$/;

router.use((req, res, next) => {
    if (req.method === 'GET' && PUBLIC_ADMIN_GET_PATHS.test(req.path)) {
        return next();
    }
    return authenticateToken(req, res, next);
});

// The "Manage" pages (feedback, leaves, rate card) and Raw data are for the super admin only.
// Their HTML stays public like the other pages (admin-app.js sends other roles to the
// overview); every API behind them needs role 1. The upload progress streams stay
// public (see above): only an admin can start an upload and get its job id.
const adminOnly = checkRole([1]);

// Edit / delete on the Work grids (client requests, projects, tasks, changes): Super Admin and
// managers (Creative Manager 2, Creative Lead 3) only; every other role has view + filter access.
const canEditWork = checkRole([1, 2, 3]);

// Serve shared CSS theme
router.get('/admin/dmap-theme.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '..', 'public', 'dmap-theme.css'));
});

// Serve the shared admin UI script (layout, data grid, filters, KPIs, export, dialogs)
router.get('/admin/admin-app.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, '..', 'public', 'admin-app.js'));
});

// Serve login HTML
router.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Serve overview dashboard HTML
router.get('/admin/overview', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'overview.html'));
});

// Overview KPIs / trends (scoped to the caller: admin sees all, others themselves and their
// team, so it is cached per user) and the select-filter values used by every grid
router.get('/admin/overview/data', cachedAdminData(getOverviewData, { perUser: true }));
router.get('/admin/filter-options', cachedAdminData(getFilterOptions));

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
router.get('/admin/master-card/data', adminOnly, paginationMiddleware, cachedAdminData(getMasterCardData));

// Upload master card data (Excel/CSV)
router.post('/admin/master-card/upload', adminOnly, uploadMasterCard);

// SSE progress endpoint for master card upload
router.get('/admin/master-card/upload/progress/:jobId', sseProgress);

// Update master card rate
router.put('/admin/master-card/:id', adminOnly, updateMasterCard);

// Get distinct financial years
router.get('/admin/master-card/financial-years', adminOnly, getFinancialYears);

// Bulk update master card field across all records
router.put('/admin/master-card/field/:field', adminOnly, updateMasterCardField);

// Delete master card rate
router.delete('/admin/master-card/:id', adminOnly, deleteMasterCard);

 // API endpoint for project details data
router.get('/admin/projectsdetails/data', paginationMiddleware, cachedAdminData(getAdminData));

// API endpoint for clients data
router.get('/admin/clients/data', paginationMiddleware, cachedAdminData(getClientsData));

// API endpoint for task details data
router.get('/admin/taskdetails/data', paginationMiddleware, cachedAdminData(getTaskDetailsData));

// API endpoint for issue details data
router.get('/admin/issuedetails/data', paginationMiddleware, cachedAdminData(getIssueDetailsData));

// API endpoint for workrequest tasks raw data
router.get('/admin/workrequesttasks/data', adminOnly, paginationMiddleware, cachedAdminData(getWorkRequestTasksData));

// Linked work for the detail drawers: project -> tasks -> changes (any logged-in user, like the grids)
const { getLinkedWork } = require('../controller/adminLinkedController');
router.get('/admin/linked/:kind/:id', cachedAdminData(getLinkedWork));

// API endpoint for tasks
router.get('/admin/projectsdetails/tasks/:workRequestId', cachedAdminData(getTasksForWorkRequest));

// Delete preview
router.get('/admin/delete/preview/:type/:id', canEditWork, cachedAdminData(getDeletePreview));

// Delete endpoints
router.delete('/admin/delete/project/:id', canEditWork, invalidateAdminCache, deleteProject);
router.delete('/admin/delete/client/:id', canEditWork, invalidateAdminCache, deleteClient);
router.delete('/admin/delete/task/:id', canEditWork, invalidateAdminCache, deleteTask);
router.delete('/admin/delete/issue/:id', canEditWork, invalidateAdminCache, deleteIssue);

// Edit - get current data
router.get('/admin/edit/:type/:id', canEditWork, getEditData);

// Get all request types for dropdown
router.get('/admin/edit/project/:id/request-types', canEditWork, getRequestTypes);

// Get project types for a project (optionally filtered by request_type_id)
router.get('/admin/edit/project/:id/project-types', canEditWork, getProjectTypesByProject);

// Get creative manager for a project (optionally filtered by request_type_id)
router.get('/admin/edit/project/:id/creative-manager', canEditWork, getCreativeManagerByProject);

// Edit - update endpoints
router.put('/admin/edit/project/:id', canEditWork, invalidateAdminCache, updateProject);
router.put('/admin/edit/client/:id', canEditWork, invalidateAdminCache, updateClient);
router.put('/admin/edit/task/:id', canEditWork, invalidateAdminCache, updateTask);
router.put('/admin/edit/issue/:id', canEditWork, invalidateAdminCache, updateIssue);

// Weekly report (Digilabs managers for their own division, Super Admin for any Digilabs division)
router.get('/admin/reports', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'reports.html'));
});
router.get('/admin/reports/data', reportAccess, getReportData);
router.post('/admin/reports/action/:action', reportAccess, postReportAction);
router.post('/admin/reports/highlight/upload', reportAccess, uploadHighlight);
router.post('/admin/reports/generate', reportAccess, generateReport);
router.get('/admin/reports/download', reportAccess, downloadReport);
router.get('/admin/reports/img', reportAccess, highlightImage);

// Serve feedback HTML
router.get('/admin/feedback', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html'));
});

// API endpoint for feedback data
router.get('/admin/feedback/data', adminOnly, paginationMiddleware, getAllFeedback);

// API endpoint for leaves data
router.get('/admin/leaves/data', adminOnly, paginationMiddleware, getAllLeaves);
router.get('/admin/leaves/users', adminOnly, paginationMiddleware, getLeaveUsers);
router.get('/admin/leaves/users/:userId/division', adminOnly, getUserDivision);
router.get('/admin/leaves/kpis', adminOnly, getLeaveKpis);
router.get('/admin/leaves/export/excel', adminOnly, exportLeavesExcel);
router.get('/admin/leaves/export/csv', adminOnly, exportLeavesCsv);
router.get('/admin/leaves/:id', adminOnly, getLeaveById);
router.post('/admin/leaves', adminOnly, createLeave);
router.put('/admin/leaves/:id', adminOnly, updateLeave);
router.delete('/admin/leaves/:id', adminOnly, deleteLeave);
router.post('/admin/leaves/upload', adminOnly, uploadLeaves);
router.get('/admin/leaves/upload/progress/:jobId', sseProgress);

// Master data (departments, divisions, designations, job roles, request / project / task / change
// types and their links): Super Admin everything, managers their own department only (checked
// against the DB in masterDataService.resolveScope). Not cached; writes clear the admin cache
// (the grids' filter options list divisions, task types, ...).
const masterData = require('../controller/masterDataController');
router.get('/admin/master-data', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'master-data.html'));
});
// Change requests (before /admin/master/:entity): managers raise them (email to
// MASTER_DATA_REQUEST_EMAIL), Super Admin handles them; alerts feed the admin popup.
router.get('/admin/master/requests', canEditWork, masterData.listRequests);
router.post('/admin/master/requests', checkRole([2, 3]), masterData.createRequest);
router.get('/admin/master/requests/alerts', adminOnly, masterData.requestAlerts);
router.post('/admin/master/requests/alerts/seen', adminOnly, masterData.requestAlertsSeen);
router.get('/admin/master/requests/:id', canEditWork, masterData.getRequest);
router.put('/admin/master/requests/:id', adminOnly, masterData.updateRequest);
router.get('/admin/master/meta', canEditWork, masterData.getMeta);
router.get('/admin/master/:entity', canEditWork, masterData.getList);
router.get('/admin/master/:entity/:id', canEditWork, masterData.getDetail);
router.post('/admin/master/:entity', canEditWork, invalidateAdminCache, masterData.createRow);
router.put('/admin/master/:entity/:id', canEditWork, invalidateAdminCache, masterData.updateRow);
router.delete('/admin/master/:entity/:id', canEditWork, invalidateAdminCache, masterData.deleteRow);

// What's new (release notes in config/whatsNew.js): any logged-in user. 'api' notes only for
// roles 1, 2, 3. `seen` stores the last version the user closed, so the popup shows once.
const whatsNew = require('../services/whatsNewService');
router.get('/admin/whats-new', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'whats-new.html'));
});
router.get('/admin/whats-new/data', async (req, res) => {
    try {
        const versions = whatsNew.forUser(req.user);
        const seen = await whatsNew.getSeen(req.user.id);
        res.json({ success: true, data: { current: whatsNew.CURRENT, seen, canSeeApi: whatsNew.canSeeApi(req.user), unseen: whatsNew.unseenFor(versions, seen).map(v => v.version), versions } });
    } catch (err) {
        console.error('whats-new data:', err);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again later.' });
    }
});
router.post('/admin/whats-new/seen', async (req, res) => {
    const version = String((req.body && req.body.version) || '');
    if (!/^\d+\.\d+\.\d+$/.test(version) || whatsNew.compareVersions(version, whatsNew.CURRENT) > 0) {
        return res.status(400).json({ success: false, error: 'Invalid version' });
    }
    const saved = await whatsNew.setSeen(req.user.id, version);
    res.json({ success: true, data: { version, saved } });
});

module.exports = router;
