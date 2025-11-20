const jwt = require('jsonwebtoken');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { User, Sales } = require('../../models');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

// Initiate registration
const initiateRegistration = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            await logUserActivity({
                event: 'initiate_registration_failed',
                reason: 'email_required',
                email: null,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Validate email domain
        if (!email.endsWith('@alembic.co.in')) {
            await logUserActivity({
                event: 'initiate_registration_failed',
                reason: 'invalid_domain',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Only @alembic.co.in email addresses are allowed' });
        }

        // Check if user exists in sales table first
        const existingSalesUser = await Sales.findOne({ where: { email_id: email } });
        if (existingSalesUser) {
            await logUserActivity({
                event: 'initiate_registration_failed',
                reason: 'user_exists_in_sales',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({
                success: false,
                error: 'User already exists in sales records. Please contact administrator.',
                action: 'contact_admin'
            });
        }

        // Check if user exists in users table
        let existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            if (existingUser.email_verified_status === 1) {
                await logUserActivity({
                    event: 'initiate_registration_failed',
                    reason: 'user_already_verified',
                    email,
                    ...extractRequestDetails(req)
                });
                return res.status(400).json({
                    success: false,
                    error: 'User already exists and is verified. Please login instead.',
                    action: 'login'
                });
            } else {
                // User exists but not verified, resend verification email
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

                await logUserActivity({
                    event: 'verification_email_resent',
                    email,
                    ...extractRequestDetails(req)
                });
                return res.json({
                    success: true,
                    message: 'Verification email sent again. Please check your email.',
                    action: 'check_email'
                });
            }
        }

        // Create user entry with email_verified_status = 0
        try {
            await User.create({
                email,
                email_verified_status: 0
            });
        } catch (error) {
            console.error('Error creating user:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to initiate registration'
            });
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

        await logUserActivity({
            event: 'initiate_registration_success',
            email,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, message: 'Verification email sent successfully' });
    } catch (error) {
        console.error('Error initiating registration:', error);
        await logUserActivity({
            event: 'initiate_registration_failed',
            reason: 'server_error',
            email: req.body?.email || null,
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Failed to send verification email' });
    }
};

// Verify email
const verifyEmail = async (req, res) => {
    try {
        const { email } = req.user;

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (!existingUser) {
            await logUserActivity({
                event: 'verify_email_failed',
                reason: 'user_not_found',
                email,
                ...extractRequestDetails(req)
            });
            // Emit error via socket
            const apiIo = req.app.get('apiIo');
            apiIo.emit('verificationError', {
                email,
                message: 'User not found. Please initiate registration first.'
            });

            return res.status(400).json({
                success: false,
                error: 'User not found. Please initiate registration first.',
                action: 'initiate_registration'
            });
        }

        // Check if already verified
        if (existingUser.email_verified_status === 1) {
            await logUserActivity({
                event: 'verify_email_failed',
                reason: 'already_verified',
                email,
                ...extractRequestDetails(req)
            });
            // Emit error via socket
            const apiIo = req.app.get('apiIo');
            apiIo.emit('verificationError', {
                email,
                message: 'Email already verified. Please login.'
            });

            return res.status(400).json({
                success: false,
                error: 'Email already verified. Please login.',
                action: 'login'
            });
        }

        // Update user's email_verified_status to 1
        try {
            await User.update(
                { email_verified_status: 1 },
                { where: { email } }
            );
        } catch (updateError) {
            console.error('Error updating user verification status:', updateError);
            await logUserActivity({
                event: 'verify_email_failed',
                reason: 'update_failed',
                email,
                error: updateError.message,
                ...extractRequestDetails(req)
            });
            // Emit error via socket
            const apiIo = req.app.get('apiIo');
            apiIo.emit('verificationError', {
                email,
                message: 'Failed to update verification status'
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to update verification status'
            });
        }

        // Emit success via socket
        const apiIo = req.app.get('apiIo');
        apiIo.emit('emailVerified', {
            success: true,
            email,
            message: 'Email verified successfully. Please complete your registration.'
        });

        await logUserActivity({
            event: 'verify_email_success',
            email,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, message: 'Email verified successfully', email });
    } catch (error) {
        console.error('Error verifying email:', error);
        await logUserActivity({
            event: 'verify_email_failed',
            reason: 'server_error',
            email: req.user?.email || 'unknown',
            error: error.message,
            ...extractRequestDetails(req)
        });
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
            await logUserActivity({
                event: 'login_failed',
                reason: 'user_not_found',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Check password (implement proper password checking)
        // For now, just check if password matches
        if (user.password !== password) { // This should use bcrypt
            await logUserActivity({
                event: 'login_failed',
                reason: 'invalid_password',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({ id: user.id, email: user.email });
        const refreshToken = generateRefreshToken({ id: user.id, email: user.email });

        await logUserActivity({
            event: 'login_success',
            email,
            userId: user.id,
            ...extractRequestDetails(req)
        });
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
        await logUserActivity({
            event: 'login_failed',
            reason: 'server_error',
            email: req.body?.email || null,
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Login failed' });
    }
};

// Refresh token
const refreshToken = async (req, res) => {
    try {
        const { refreshToken: token } = req.body;

        if (!token) {
            await logUserActivity({
                event: 'refresh_token_failed',
                reason: 'token_required',
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Refresh token required' });
        }

        const user = verifyRefreshToken(token);
        const newAccessToken = generateAccessToken({ id: user.id, email: user.email });

        await logUserActivity({
            event: 'refresh_token_success',
            userId: user.id,
            email: user.email,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, accessToken: newAccessToken });
    } catch (error) {
        console.error('Error refreshing token:', error);
        await logUserActivity({
            event: 'refresh_token_failed',
            reason: 'invalid_token',
            error: error.message,
            ...extractRequestDetails(req)
        });
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
            await logUserActivity({
                event: 'register_failed',
                reason: 'user_already_exists',
                email,
                ...extractRequestDetails(req)
            });
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

        await logUserActivity({
            event: 'register_success',
            email,
            userId: user.id,
            ...extractRequestDetails(req)
        });
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
        await logUserActivity({
            event: 'register_failed',
            reason: 'server_error',
            email: req.body?.email || null,
            error: error.message,
            ...extractRequestDetails(req)
        });
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