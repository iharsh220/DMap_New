const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./AuthRoute');
const departmentRoutes = require('./departmentRoutes');

// Use routes
router.use('/auth', authRoutes);

//Work Details Routes
router.use('/departments', departmentRoutes);

// Add other routes here as needed
// router.use('/users', userRoutes);

module.exports = router;