const express = require('express');
const router = express.Router();
const { getAssignedWorkRequests, getAssignedWorkRequestById } = require('../../controller/managerAssignedController/managerAssignedController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');
const { checkRole } = require('../../middleware/roleMiddleware');
const filterMiddleware = require('../../middleware/filterMiddleware');
const paginationMiddleware = require('../../middleware/paginationMiddleware');
const searchMiddleware = require('../../middleware/searchMiddleware');

// Manager-specific routes for viewing assigned work requests
router.get('/', authenticateToken, checkRole([1, 2]), filterMiddleware, paginationMiddleware, searchMiddleware, getAssignedWorkRequests); // Get all requests assigned to the manager
router.get('/:id', authenticateToken, checkRole([1, 2]), getAssignedWorkRequestById); // Get specific assigned work request by ID

module.exports = router;