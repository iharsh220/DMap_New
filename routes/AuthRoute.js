const express = require('express');
const { verifyToken } = require('../middleware/jwtMiddleware');
const {
  initiateRegistration,
  verifyEmail,
  login,
  refreshToken,
  register
} = require('../controller/authController/authController');

const router = express.Router();

// Routes
router.post('/initiate-registration', initiateRegistration);
router.get('/verify-email', verifyToken, verifyEmail);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/register', register);

module.exports = router;
