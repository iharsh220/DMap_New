const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./AuthRoute');

// Use routes
router.use('/auth', authRoutes);

// Add other routes here as needed
// router.use('/users', userRoutes);
// router.use('/departments', departmentRoutes);

module.exports = router;