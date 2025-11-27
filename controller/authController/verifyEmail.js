const CrudService = require('../../services/crudService');
const { User } = require('../../models');
const { blacklistToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const userService = new CrudService(User);

// Verify email
const verifyEmail = async (req, res) => {
    try {
        const { email } = req.user;

        // Check if user exists
        const userResult = await userService.getAll({ where: { email }, limit: 1 });
        const existingUser = userResult.success && userResult.data.length > 0 ? userResult.data[0] : null;
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
            await userService.updateById(existingUser.id, { email_verified_status: 1 });
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

        // Blacklist the verification token (24 hours TTL)
        const { token } = req.query;
        if (token) {
            const emailTtl = require('ms')(process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN || '24h') / 1000;
            await blacklistToken(token, emailTtl);
        }

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

module.exports = verifyEmail;