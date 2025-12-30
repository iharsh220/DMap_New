const express = require('express');
const router = express.Router();
const getAllDepartments = require('../../controller/workDetailsController/getAllDepartments');

// GET /departments - Get all departments with divisions and locations
router.get('/', getAllDepartments);


module.exports = router;