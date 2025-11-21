const express = require('express');
const router = express.Router();
const { getAllLocations } = require('../controller/locationController');

// GET /locations - Get all locations
router.get('/', getAllLocations);

module.exports = router;