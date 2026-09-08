const express = require('express');
const router = express.Router();
const { getAllSalesUsers, getAllDoctorsData, uploadSalesUsers, uploadDoctors } = require('../../controller/salesUserActivityController/salesUsersController');
 
const { authenticateToken } = require('../../middleware/jwtMiddleware');

// Get issue register data by task ID or issue ID
router.get('/my_sales_users', authenticateToken, getAllSalesUsers);
router.get('/my_doctors', authenticateToken, getAllDoctorsData);

router.post('/upload_sales_users', authenticateToken, uploadSalesUsers);
router.post('/upload_doctors', authenticateToken, uploadDoctors);


module.exports = router;
