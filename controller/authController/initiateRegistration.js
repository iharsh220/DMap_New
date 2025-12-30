const jwt = require('jsonwebtoken');
const CrudService = require('../../services/crudService');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');
const { User, Sales, DesignationJobRole } = require('../../models');
const { generateEmailVerificationToken } = require('../../middleware/jwtMiddleware');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);
const designationJobRoleService = new CrudService(DesignationJobRole);

// Initiate registration
const initiateRegistration = async (req, res) => {
    try {
        const { email, session_id } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Validate email domain
        if (!email.endsWith('@alembic.co.in')) {
          
            return res.status(400).json({ success: false, error: 'Only @alembic.co.in email addresses are allowed' });
        }

        // Check if user exists in sales table first
        const salesResult = await salesService.getAll({ where: { email_id: email }, limit: 1 });
        const existingSalesUser = salesResult.success && salesResult.data.length > 0 ? salesResult.data[0] : null;
        if (existingSalesUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists in sales records. Please contact administrator.',
                status: existingSalesUser.account_status,
                action: 'contact_admin'
            });
        }

        // Check if user exists in users table
        const userResult = await userService.getAll({ where: { email }, limit: 1 });
        let existingUser = userResult.success && userResult.data.length > 0 ? userResult.data[0] : null;
        if (existingUser) {
            if (existingUser.email_verified_status === 1) {
               
                return res.status(400).json({
                    success: false,
                    error: 'User already exists and is verified. Please login instead.',
                    status: existingUser.account_status,
                    action: 'login'
                });
            } else {
                // User exists but not verified, resend verification email
                // Generate encrypted JWT token with session_id
                const tokenPayload = { email };
                if (session_id) {
                    tokenPayload.session_id = session_id;
                }
                const token = await generateEmailVerificationToken(tokenPayload);

                // Store the latest verification token
                await userService.updateById(existingUser.id, { latest_verification_token: token });

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

                
                return res.json({
                    success: true,
                    message: 'Verification email sent again. Please check your email.',
                    action: 'check_email'
                });
            }
        }

        // Create user entry with email_verified_status = 0
        const createResult = await userService.create({
            email,
            email_verified_status: 0
        });
        if (!createResult.success) {
            console.error('Error creating user:', createResult.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to initiate registration'
            });
        }

        // Generate encrypted JWT token with session_id
        const tokenPayload = { email };
        if (session_id) {
            tokenPayload.session_id = session_id;
        }
        const token = await generateEmailVerificationToken(tokenPayload);

        // Store the latest verification token in the newly created user
        await userService.updateById(createResult.data.id, { latest_verification_token: token });

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

module.exports = initiateRegistration;
