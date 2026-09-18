const express = require('express');
const router = express.Router();
const { getAllSalesUsers, getAllDoctorsData, uploadSalesUsers, uploadDoctors } = require('../../controller/salesUserActivityController/salesUsersController');
const { getAllActivities, createActivity, updateActivity, deleteActivity } = require('../../controller/salesUserActivityController/salesUsersActivityController');
 
const { authenticateToken } = require('../../middleware/jwtMiddleware');

// Get issue register data by task ID or issue ID
router.get('/my_sales_users', authenticateToken, getAllSalesUsers);
router.get('/my_doctors', authenticateToken, getAllDoctorsData);

router.post('/upload_sales_users', authenticateToken, uploadSalesUsers);
router.post('/upload_doctors', authenticateToken, uploadDoctors);

router.get('/activities', authenticateToken, getAllActivities);
router.post('/activities', authenticateToken, createActivity);
router.put('/activity/:activity_id', authenticateToken, updateActivity);
router.delete('/activity/:activity_id', authenticateToken, deleteActivity);

module.exports = router;
