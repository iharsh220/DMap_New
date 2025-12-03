const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoute/authRoute');
const departmentRoutes = require('./workDetailsRoutes/departmentRoutes');
const requestTypeRoutes = require('./workDetailsRoutes/requestTypeRoutes');
const workRequestRoutes = require('./workRequestRoutes/workRequestRoutes');
const managerAssignedRoutes = require('./managerAssignedRoutes/managerAssignedRoutes');
const userRoutes = require('./userRoutes/userRoutes');

// Use routes
router.use('/auth', authRoutes);

//Work Details Routes
router.use('/departments', departmentRoutes);
router.use('/request-types', requestTypeRoutes);

router.use('/work-requests', workRequestRoutes);

router.use('/manager/assigned-work-requests', managerAssignedRoutes);

router.use('/users', userRoutes);

// Add other routes here as needed

module.exports = router;