const express = require('express');
const { verifyToken } = require('../../middleware/jwtMiddleware');
const initiateRegistration = require('../../controller/authController/initiateRegistration');
const verifyEmail = require('../../controller/authController/verifyEmail');
const refreshToken = require('../../controller/authController/refreshToken');
const completeRegistration = require('../../controller/authController/completeRegistration');
const login = require('../../controller/authController/login');

const router = express.Router();

// Routes
router.post('/initiate-registration', initiateRegistration);
router.get('/verify-email', verifyToken, verifyEmail);

router.post('/login', login);

router.post('/refresh-token', refreshToken);

router.post('/complete-registration', completeRegistration);

module.exports = router;