const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoute/authRoute');
const departmentRoutes = require('./workDetailsRoutes/departmentRoutes');
const workMediumRoutes = require('./workDetailsRoutes/workMediumRoutes');

// Use routes
router.use('/auth', authRoutes);

//Work Details Routes
router.use('/departments', departmentRoutes);
router.use('/work-mediums', workMediumRoutes);

// Add other routes here as needed
// router.use('/users', userRoutes);

module.exports = router;