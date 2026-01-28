const express = require('express');
const router = express.Router();
const path = require('path');
const { getAdminData } = require('../controller/adminController');

// Serve admin panel HTML
router.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// API endpoint for data
router.get('/admin/data', getAdminData);

module.exports = router;