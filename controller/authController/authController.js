const jwt = require('jsonwebtoken');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { User } = require('../../models');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/jwtMiddleware');

// Initiate registration
const initiateRegistration = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Validate email domain
        if (!email.endsWith('@alembic.co.in')) {
            return res.status(400).json({ success: false, error: 'Only @alembic.co.in email addresses are allowed' });
        }

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // Generate JWT token
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN });

        // Create verification URL
        const verificationUrl = `${process.env.FRONTEND_URL}/verifyemailtab?token=${token}`;

        // Render email template
        const html = renderTemplate('emailVerification', { verificationUrl });

        // Send email via BullMQ queue
        await sendMail({
            to: email,
            subject: 'D-Map Email Verification',
            html
        });

        res.json({ success: true, message: 'Verification email sent successfully' });
    } catch (error) {
        console.error('Error initiating registration:', error);
        res.status(500).json({ success: false, error: 'Failed to send verification email' });
    }
};

// Verify email
const verifyEmail = async (req, res) => {
    try {
        const { email } = req.user;

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            // Emit error via socket
            const apiIo = req.app.get('apiIo');
            apiIo.emit('verificationError', {
                email,
                message: 'User already exists'
            });

            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // Emit success via socket
        const apiIo = req.app.get('apiIo');
        apiIo.emit('emailVerified', {
            success: true,
            email,
            message: 'Email verified successfully. Please complete your registration.'
        });

        res.json({ success: true, message: 'Email verified successfully', email });
    } catch (error) {
        console.error('Error verifying email:', error);

        // Emit error via socket
        const apiIo = req.app.get('apiIo');
        apiIo.emit('verificationError', {
            email: req.user?.email || 'unknown',
            message: 'Verification failed'
        });

        res.status(500).json({ success: false, error: 'Verification failed' });
    }
};

// Login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Check password (implement proper password checking)
        // For now, just check if password matches
        if (user.password !== password) { // This should use bcrypt
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({ id: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ id: user.id, email: user.email });

        res.json({
            success: true,
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
};

// Refresh token
const refreshToken = async (req, res) => {
    try {
        const { refreshToken: token } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, error: 'Refresh token required' });
        }

        const user = verifyRefreshToken(token);
        const newAccessToken = generateAccessToken({ id: user.id, email: user.email });

        res.json({ success: true, accessToken: newAccessToken });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
};

// Register (complete registration after email verification)
const register = async (req, res) => {
    try {
        const { email, name, password, departmentId, divisionId, jobRoleId } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // Create user
        const user = await User.create({
            name,
            email,
            password, // Should hash password
            department_id: departmentId,
            division_id: divisionId,
            job_role_id: jobRoleId,
            email_verified_status: 1,
            account_status: 'active'
        });

        // Generate tokens
        const accessToken = generateAccessToken({ id: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ id: user.id, email: user.email });

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
};

module.exports = {
    initiateRegistration,
    verifyEmail,
    login,
    refreshToken,
    register
};