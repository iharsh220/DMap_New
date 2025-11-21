const { generateAccessToken, verifyRefreshToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

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

module.exports = refreshToken;