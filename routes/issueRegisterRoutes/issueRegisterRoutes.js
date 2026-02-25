const express = require('express');
const router = express.Router();
const { getIssueRegisterByTaskId, getAllIssueRegisters, getTasksForClientReview } = require('../../controller/issueRegisterController/issueRegisterController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');

// Get tasks for client review by work request ID (intimate_client=1 and review_stage=pm_review)
router.get('/work-request/:work_request_id/tasks', authenticateToken, getTasksForClientReview);

// Get issue register data by task ID
router.get('/task/:task_id', authenticateToken, getIssueRegisterByTaskId);

// Get all issue register entries
router.get('/', authenticateToken, getAllIssueRegisters);

module.exports = router;
