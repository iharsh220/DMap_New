const bcrypt = require('bcryptjs');
const CrudService = require('../../services/crudService');
const { User, Sales } = require('../../models');
const { verifyEmailVerificationToken, blacklistToken } = require('../../middleware/jwtMiddleware');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);

// Reset Password
const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            
            return res.status(400).json({ success: false, error: 'Token and new password are required' });
        }

        // Validate password strength
        if (newPassword.length < 8) {
           
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
        }

        // Verify token
        let tokenPayload;
        try {
            tokenPayload = await verifyEmailVerificationToken(token);
        } catch (error) {
          
            return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
        }

        const { userId, userType } = tokenPayload;

        let user = null;
        let service = null;

        if (userType === 'user') {
            service = userService;
        } else if (userType === 'sales') {
            service = salesService;
        } else {
           
            return res.status(400).json({ success: false, error: 'Invalid user type' });
        }

        // Get user
        const userResult = await service.getById(userId);
        if (!userResult.success) {
            
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        user = userResult.data;

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password
        const updateData = {
            password: hashedPassword,
            password_changed_at: new Date(),
            // Unlock account if locked
            account_status: 'active',
            login_attempts: 0,
            lock_until: null
        };

        await service.updateById(user.id, updateData);

        // Blacklist the reset token (1 hour TTL)
        const resetTtl = 60 * 60; // 1 hour in seconds
        await blacklistToken(token, resetTtl);

        res.status(200).json({
            success: true,
            message: 'Password has been reset successfully'
        });
    } catch (error) {
        console.error('Error in reset password:', error);
        res.status(500).json({ success: false, error: 'Failed to reset password' });
    }
};

module.exports = resetPassword;