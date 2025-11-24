const express = require('express');
const router = express.Router();
const getAllWorkMediums = require('../../controller/workDetailsController/workMediumController');
const { authenticateToken } = require('../../middleware/jwtMiddleware');

// GET /work-mediums - Get all work mediums (authenticated users only)
router.get('/', authenticateToken, getAllWorkMediums);


module.exports = router;