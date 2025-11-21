const jwt = require('jsonwebtoken');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { User, Sales } = require('../../models');
const { generateEmailVerificationToken } = require('../../middleware/jwtMiddleware');
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

module.exports = initiateRegistration;