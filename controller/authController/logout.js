const redisClient = require('../../config/redisConfig');

// Logout
const logout = async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            // Decode token to get expiration
            const { jwtDecrypt } = require('jose');
            const keyBytes = Uint8Array.from(Buffer.from(process.env.JWT_ENCRYPTION_KEY, 'base64'));
            const { payload } = await jwtDecrypt(token, keyBytes);
            
            const exp = payload.exp;
            const now = Math.floor(Date.now() / 1000);
            const ttl = exp - now;

            if (ttl > 0) {
                await redisClient.setex(`blacklist:${token}`, ttl, 'true');
            }
        }


        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({ success: false, error: 'Logout failed' });
    }
};

module.exports = logout;