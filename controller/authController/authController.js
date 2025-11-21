const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { User, Sales, UserDivisions } = require('../../models');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateEmailVerificationToken, verifyEmailVerificationToken } = require('../../middleware/jwtMiddleware');
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
                // Generate encrypted JWT token
                const token = await generateEmailVerificationToken(email);

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

        // Generate encrypted JWT token
        const token = await generateEmailVerificationToken(email);

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

        const user = await verifyRefreshToken(token);
        const newAccessToken = await generateAccessToken({ id: user.id, email: user.email });

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

// Complete registration
const completeRegistration = async (req, res) => {
    try {
        const { email, name, password, phone, department_id, division_id, designation_id, location_id } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user || user.email_verified_status !== 1) {
            await logUserActivity({
                event: 'complete_registration_failed',
                reason: 'user_not_verified',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'User not found or email not verified' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user
        await User.update({
            name,
            password: hashedPassword,
            phone,
            department_id,
            division_id,
            designation_id,
            location_id,
            account_status: 'active'
        }, { where: { email } });

        await logUserActivity({
            event: 'complete_registration_success',
            email,
            userId: user.id,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, message: 'Registration completed successfully' });
    } catch (error) {
        console.error('Error completing registration:', error);
        await logUserActivity({
            event: 'complete_registration_failed',
            reason: 'server_error',
            email: req.body?.email || null,
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Registration completion failed' });
    }
};

module.exports = {
    initiateRegistration,
    verifyEmail,
    refreshToken,
    completeRegistration
};