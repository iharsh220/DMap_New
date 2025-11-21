const express = require('express');
const { verifyToken } = require('../middleware/jwtMiddleware');
const {
  initiateRegistration,
  verifyEmail,
  refreshToken,
  completeRegistration
} = require('../controller/authController/authController');

const router = express.Router();

// Routes
router.post('/initiate-registration', initiateRegistration);
router.get('/verify-email', verifyToken, verifyEmail);

router.post('/refresh-token', refreshToken);

router.post('/complete-registration', completeRegistration);

module.exports = router;
