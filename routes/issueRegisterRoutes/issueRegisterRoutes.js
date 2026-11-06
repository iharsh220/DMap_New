const express = require('express');
const router = express.Router();
const { getIssueRegisterByTaskId, getAllIssueRegisters, createIssueAssignment, getIssueAssignmentsWithTaskDetails } = require('../../controller/issueRegisterController/issueRegisterController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const { blockIfProjectCancelled: ro } = require('../../services/projectCancellationService'); // a cancelled project is read-only

// Get issue register data by task ID or issue ID
router.get('/task/:task_id/:issue_id?', authenticateToken, getIssueRegisterByTaskId);

// Get all issue register entries
router.get('/', authenticateToken, getAllIssueRegisters);

// Get issue assignments with full task details, work request details, assigned users and their managers
router.get('/assignments', authenticateToken, filterMiddleware, paginationMiddleware, getIssueAssignmentsWithTaskDetails);

// Create issue assignment with issue types and documents
router.post('/assignment', authenticateToken, ro(req => (req.body.task_id ? ['task', req.body.task_id] : ['change', req.body.issue_id])), createIssueAssignment);

module.exports = router;
