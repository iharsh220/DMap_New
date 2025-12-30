const express = require('express');
const router = express.Router();
const getAllRequestTypes = require('../../controller/workDetailsController/requestTypeController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');

// GET /request-types - Get all request types (authenticated users only)
router.get('/', authenticateToken, getAllRequestTypes);


module.exports = router;