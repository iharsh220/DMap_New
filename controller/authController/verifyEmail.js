const CrudService = require('../../services/crudService');
const { User } = require('../../models');
const { blacklistToken } = require('../../middleware/jwtMiddleware');

const userService = new CrudService(User);

// Verify email
const verifyEmail = async (req, res) => {
    try {
        const { email } = req.user;
        const { token } = req.query;

        // Check if user exists
        const userResult = await userService.getAll({ where: { email }, limit: 1 });
        const existingUser = userResult.success && userResult.data.length > 0 ? userResult.data[0] : null;
        if (!existingUser) {
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get session ID from token

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
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
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get session ID from token

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
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

        // Check if the token matches the latest verification token
        if (existingUser.latest_verification_token && existingUser.latest_verification_token !== token) {
           
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get session ID from token

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit('verificationError', {
                        email,
                        message: 'Invalid verification token. Please use the latest verification email.'
                    });
                } else {
                    console.log(`⚠️ Requesting socket ${socketId} not found - cannot emit`);
                }
            } else {
                console.log('⚠️ No socket ID in request or apiIo not available - cannot emit');
            }

            return res.status(400).json({
                success: false,
                error: 'Invalid verification token. Please use the latest verification email.',
                action: 'resend_verification'
            });
        }

        // Update user's email_verified_status to 1
        try {
            await userService.updateById(existingUser.id, { email_verified_status: 1 });
        } catch (updateError) {
           
            // Emit error via socket - ONLY to the requesting socket
            const apiIo = req.app.get('apiIo');
            const socketId = req.socketId; // Get session ID from token

            if (apiIo && socketId) {
                const targetSocket = apiIo.sockets.get(socketId);
                if (targetSocket) {
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
        
        // Clear the latest verification token after successful verification
        await userService.updateById(existingUser.id, { latest_verification_token: null });

        // Emit success via socket - ONLY to the requesting socket
        const apiIo = req.app.get('apiIo');
        const socketId = req.socketId; // Get session ID from token

        if (apiIo && socketId) {
            const targetSocket = apiIo.sockets.get(socketId);
            if (targetSocket) {
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
        if (token) {
            const emailTtl = require('ms')(process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN || '24h') / 1000;
            await blacklistToken(token, emailTtl);
        }

        
        res.json({ success: true, message: 'Email verified successfully', email });
    } catch (error) {
        console.error('Error verifying email:', error);
       
        // Emit error via socket - ONLY to the requesting socket
        const apiIo = req.app.get('apiIo');
        const socketId = req.socketId; // Get session ID from token

        if (apiIo && socketId) {
            const targetSocket = apiIo.sockets.get(socketId);
            if (targetSocket) {
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
