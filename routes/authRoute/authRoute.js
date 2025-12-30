const express = require('express');
const { verifyToken, authenticateToken } = require('../../middleware/jwtMiddleware');
const initiateRegistration = require('../../controller/authController/initiateRegistration');
const verifyEmail = require('../../controller/authController/verifyEmail');
const refreshToken = require('../../controller/authController/refreshToken');
const completeRegistration = require('../../controller/authController/completeRegistration');
const login = require('../../controller/authController/login');
const logout = require('../../controller/authController/logout');
const forgotPassword = require('../../controller/authController/forgotPassword');
const resetPassword = require('../../controller/authController/resetPassword');
const changePassword = require('../../controller/authController/changePassword');
const getProfile = require('../../controller/authController/getProfile');

const router = express.Router();

// Routes
router.post('/initiate-registration', initiateRegistration);
router.get('/verify-email', verifyToken, verifyEmail);

router.post('/login', login);

router.post('/refresh-token', refreshToken);

router.post('/logout', authenticateToken, logout);

router.post('/complete-registration', completeRegistration);

router.post('/forgot-password', forgotPassword);

router.post('/reset-password', resetPassword);

router.post('/change-password', authenticateToken, changePassword);

router.get('/profile', authenticateToken, getProfile);

module.exports = router;