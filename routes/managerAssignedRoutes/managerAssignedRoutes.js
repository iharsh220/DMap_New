const express = require('express');
const router = express.Router();
const { getAssignedWorkRequests, getAssignedWorkRequestById } = require('../../controller/managerAssignedController/managerAssignedController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');

// Manager-specific routes for viewing assigned work requests
router.get('/', authenticateToken, getAssignedWorkRequests); // Get all requests assigned to the manager
router.get('/:id', authenticateToken, getAssignedWorkRequestById); // Get specific assigned work request by ID

module.exports = router;