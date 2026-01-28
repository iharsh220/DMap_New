const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Import route modules
const authRoutes = require('./authRoute/authRoute');
const departmentRoutes = require('./workDetailsRoutes/departmentRoutes');
const requestTypeRoutes = require('./workDetailsRoutes/requestTypeRoutes');
const workRequestRoutes = require('./workRequestRoutes/workRequestRoutes');
const managerAssignedRoutes = require('./managerAssignedRoutes/managerAssignedRoutes');
const userRoutes = require('./userRoutes/userRoutes');
const adminRoutes = require('./adminRoutes');

// Use routes
router.use('/auth', authRoutes);

//Work Details Routes
router.use('/departments', departmentRoutes);
router.use('/request-types', requestTypeRoutes);

router.use('/work-requests', workRequestRoutes);

router.use('/manager/assigned-work-requests', managerAssignedRoutes);

router.use('/users', userRoutes);

router.use('/', adminRoutes);

// const { authenticateToken } = require('../middleware/jwtMiddleware');

router.get(`/uploads/*`, (req, res) => {
    const filePath = req.params[0];
    const fullPath = path.resolve('uploads', filePath);
    if (!fullPath.startsWith(path.resolve('uploads') + path.sep)) {
        return res.status(404).json({ error: 'File not found' });
    }
    if (fs.existsSync(fullPath)) {
        res.sendFile(fullPath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Add other routes here as needed

module.exports = router;