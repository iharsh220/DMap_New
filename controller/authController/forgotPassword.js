const CrudService = require('../../services/crudService');
const { User, Sales } = require('../../models');
const { sendMail } = require('../../services/mailService');
const { generatePasswordResetToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');
const fs = require('fs');
const path = require('path');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);

// Forgot Password
const forgotPassword = async (req, res) => {
    try {
        const { identifier, loginType } = req.body;

        if (!identifier || !loginType) {
            await logUserActivity({
                event: 'forgot_password_failed',
                reason: 'missing_fields',
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Identifier and loginType are required' });
        }

        let user = null;
        let userType = '';

        if (loginType === 'email') {
            // Check User table first
            const userResult = await userService.getAll({
                where: { email: identifier },
                limit: 1
            });
            if (userResult.success && userResult.data.length > 0) {
                user = userResult.data[0];
                userType = 'user';
            } else {
                // Check Sales table
                const salesResult = await salesService.getAll({
                    where: { email_id: identifier },
                    limit: 1
                });
                if (salesResult.success && salesResult.data.length > 0) {
                    user = salesResult.data[0];
                    userType = 'sales';
                }
            }
        } else if (loginType === 'sapcode') {
            const salesResult = await salesService.getAll({
                where: { sap_code: identifier },
                limit: 1
            });
            if (salesResult.success && salesResult.data.length > 0) {
                user = salesResult.data[0];
                userType = 'sales';
            }
        } else if (loginType === 'empcode') {
            const salesResult = await salesService.getAll({
                where: { emp_code: identifier },
                limit: 1
            });
            if (salesResult.success && salesResult.data.length > 0) {
                user = salesResult.data[0];
                userType = 'sales';
            }
        } else {
            await logUserActivity({
                event: 'forgot_password_failed',
                reason: 'invalid_login_type',
                loginType,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Invalid login type' });
        }

        if (!user) {
            // Don't reveal if email exists or not for security
            await logUserActivity({
                event: 'forgot_password_attempt',
                reason: 'user_not_found',
                identifier,
                loginType,
                ...extractRequestDetails(req)
            });
            return res.status(200).json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // Generate reset token (JWT)
        const resetToken = await generatePasswordResetToken({ userId: user.id, userType });

        // Send email
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

        // Read email template
        const templatePath = path.join(__dirname, '../../email-templates/passwordReset.html');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        htmlTemplate = htmlTemplate.replace(/{{resetUrl}}/g, resetUrl);
    
        await sendMail({
            to: user.email || user.email_id,
            subject: 'Password Reset Request - D-Map',
            html: htmlTemplate
        });

        await logUserActivity({
            event: 'forgot_password_success',
            userId: user.id,
            email: user.email || user.email_id,
            userType,
            ...extractRequestDetails(req)
        });

        res.status(200).json({
            success: true,
            message: 'Password reset link has been sent to your email.'
        });
    } catch (error) {
        console.error('Error in forgot password:', error);
        await logUserActivity({
            event: 'forgot_password_failed',
            reason: 'server_error',
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Failed to process password reset request' });
    }
};

module.exports = forgotPassword;