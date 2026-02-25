const express = require('express');
const router = express.Router();
const { getIssueRegisterByTaskId, getAllIssueRegisters } = require('../../controller/issueRegisterController/issueRegisterController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');

// Get issue register data by task ID
router.get('/task/:task_id', authenticateToken, getIssueRegisterByTaskId);

// Get all issue register entries
router.get('/', authenticateToken, getAllIssueRegisters);

module.exports = router;
