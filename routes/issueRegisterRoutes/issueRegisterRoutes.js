const express = require('express');
const router = express.Router();
const { getIssueRegisterByTaskId, getAllIssueRegisters, createIssueAssignment, getIssueAssignmentsWithTaskDetails } = require('../../controller/issueRegisterController/issueRegisterController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');

// Get issue register data by task ID
router.get('/task/:task_id', authenticateToken, getIssueRegisterByTaskId);

// Get all issue register entries
router.get('/', authenticateToken, getAllIssueRegisters);

// Get issue assignments with full task details, work request details, assigned users and their managers
router.get('/assignments', authenticateToken, filterMiddleware, paginationMiddleware, getIssueAssignmentsWithTaskDetails);

// Create issue assignment with issue types and documents
router.post('/assignment', authenticateToken, createIssueAssignment);

module.exports = router;
