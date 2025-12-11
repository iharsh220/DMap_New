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
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get socket ID from request
            console.log('Emitting verificationError for user not found, apiIo defined:', !!apiIo);
            console.log('Target socket ID:', socketId);

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
                    console.log(`🎯 Emitting to requesting socket only (${socketId})`);
                    targetSocket.emit('verificationError', {
                        email,
                        message: 'User not found. Please initiate registration first.'
                    });
                } else {
                    console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
                }
            } else {
                console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
            }

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
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get socket ID from request
            console.log('Emitting verificationError for already verified, apiIo defined:', !!apiIo);
            console.log('Target socket ID:', socketId);

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
                    console.log(`🎯 Emitting to requesting socket only (${socketId})`);
                    targetSocket.emit('verificationError', {
                        email,
                        message: 'Email already verified. Please login.'
                    });
                } else {
                    console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
                }
            } else {
                console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
            }

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
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get socket ID from request
            console.log('Emitting verificationError for update failed, apiIo defined:', !!apiIo);
            console.log('Target socket ID:', socketId);

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
                    console.log(`🎯 Emitting to requesting socket only (${socketId})`);
                    targetSocket.emit('verificationError', {
                        email,
                        message: 'Failed to update verification status'
                    });
                } else {
                    console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
                }
            } else {
                console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
            }

            return res.status(500).json({
                success: false,
                error: 'Failed to update verification status'
            });
        }
        console.log("aaya idhr kuch to");
        // Emit success via socket - ONLY to the requesting socket
        const apiIo = req.app.get('apiIo');
        const socketId = req.socketId; // Get socket ID from request
        console.log('Emitting emailVerified, apiIo defined:', !!apiIo);
        console.log('Target socket ID:', socketId);

        if (apiIo && socketId) {
            const targetSocket = apiIo.sockets.get(socketId);
            if (targetSocket) {
                console.log(`🎯 Emitting to requesting socket only (${socketId})`);
                targetSocket.emit('emailVerified', {
                    success: true,
                    email,
                    message: 'Email verified successfully. Please complete your registration.'
                });
            } else {
                console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
            }
        } else {
            console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
        }

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
        // Emit error via socket - ONLY to the requesting socket
        const apiIo = req.app.get('apiIo');
        const socketId = req.socketId; // Get socket ID from request
        console.log('Emitting verificationError for server error, apiIo defined:', !!apiIo);
        console.log('Target socket ID:', socketId);

        if (apiIo && socketId) {
            const targetSocket = apiIo.sockets.get(socketId);
            if (targetSocket) {
                console.log(`🎯 Emitting to requesting socket only (${socketId})`);
                targetSocket.emit('verificationError', {
                    email: req.user?.email || 'unknown',
                    message: 'Verification failed'
                });
            } else {
                console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
            }
        } else {
            console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
        }

        res.status(500).json({ success: false, error: 'Verification failed' });
    }
};

module.exports = verifyEmail;
