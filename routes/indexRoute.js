const express = require('express');
const router = express.Router();
const path = require('path');

// Import route modules
const authRoutes = require('./authRoute/authRoute');
const departmentRoutes = require('./workDetailsRoutes/departmentRoutes');
const workMediumRoutes = require('./workDetailsRoutes/workMediumRoutes');
const workRequestRoutes = require('./workDetailsRoutes/workRequestRoutes');

// Base route
const baseRoute = process.env.BASE_ROUTE || '/digilabs/dmap/api';

// Use routes
router.use('/auth', authRoutes);

//Work Details Routes
router.use('/departments', departmentRoutes);
router.use('/work-mediums', workMediumRoutes);

router.use('/work-requests', workRequestRoutes);

// Add other routes here as needed
// router.use('/users', userRoutes);

module.exports = router;