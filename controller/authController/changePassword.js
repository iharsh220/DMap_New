const bcrypt = require('bcryptjs');
const CrudService = require('../../services/crudService');
const { User, Sales } = require('../../models');
const { blacklistToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);

// Change Password (for authenticated users)
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.user.id;
        const userType = req.user.userType || 'user'; // Assuming userType is in token

        if (!currentPassword || !newPassword || !confirmPassword) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'missing_fields',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Current password, new password, and confirm password are required' });
        }

        if (newPassword !== confirmPassword) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'password_mismatch',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'New password and confirm password do not match' });
        }

        // Validate new password strength
        if (newPassword.length < 8) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'weak_password',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'New password must be at least 8 characters long' });
        }

        let user = null;
        let service = null;

        if (userType === 'user') {
            service = userService;
        } else if (userType === 'sales') {
            service = salesService;
        } else {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'invalid_user_type',
                userId,
                userType,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Invalid user type' });
        }

        // Get user
        const userResult = await service.getById(userId);
        if (!userResult.success) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'user_not_found',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        user = userResult.data;

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'invalid_current_password',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Current password is incorrect' });
        }

        // Check if new password is different from current
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            await logUserActivity({
                event: 'change_password_failed',
                reason: 'same_password',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'New password must be different from current password' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password
        const updateData = {
            password: hashedPassword,
            password_changed_at: new Date(),
            // Reset login attempts and unlock if locked
            login_attempts: 0,
            account_status: 'active',
            lock_until: null
        };

        await service.updateById(userId, updateData);

        // Blacklist the current access token to force re-login
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            await blacklistToken(token);
        }

        await logUserActivity({
            event: 'change_password_success',
            userId,
            ...extractRequestDetails(req)
        });

        res.status(200).json({
            success: true,
            message: 'Password changed successfully. Please login again with your new password.'
        });
    } catch (error) {
        console.error('Error in change password:', error);
        await logUserActivity({
            event: 'change_password_failed',
            reason: 'server_error',
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Failed to change password' });
    }
};

module.exports = changePassword;