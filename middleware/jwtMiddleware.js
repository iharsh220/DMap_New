const { EncryptJWT, jwtDecrypt } = require('jose');
const redisClient = require('../config/redisConfig');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  try {
    // Check if token is blacklisted
    const isBlacklisted = await redisClient.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ success: false, error: 'Token has been revoked' });
    }

    const keyBytes = Uint8Array.from(Buffer.from(process.env.JWT_ENCRYPTION_KEY, 'base64'));
    const { payload } = await jwtDecrypt(token, keyBytes);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const verifyToken = async (req, res, next) => {
    const { token } = req.query;

    if (!token) {
        // Broadcast error since we don't have token to extract session_id
        const apiIo = req.app.get('apiIo');
        if (apiIo) {
            apiIo.emit('verificationError', { success: false, error: 'Token is required' });
        }

        return res.status(400).json({ success: false, error: 'Token is required' });
    }

    try {
        const keyBytes = Uint8Array.from(Buffer.from(process.env.JWT_ENCRYPTION_KEY, 'base64'));
        const { payload } = await jwtDecrypt(token, keyBytes);
        req.user = payload;

        // Extract session_id from token payload only
        req.socketId = payload.session_id;

        next();
    } catch (error) {
        // Broadcast error since we couldn't extract session_id from invalid token
        const apiIo = req.app.get('apiIo');
        if (apiIo) {
            apiIo.emit('verificationError', {
                message: 'Invalid or expired token'
            });
        }

        return res.status(400).json({ success: false, error: 'Invalid or expired token' });
    }
};

const generateToken = async (payload, key, expiresIn) => {
  const keyBytes = Uint8Array.from(Buffer.from(key, 'base64'));
  return await new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setExpirationTime(expiresIn)
    .encrypt(keyBytes);
};

const decryptToken = async (token, key) => {
  try {
    const keyBytes = Uint8Array.from(Buffer.from(key, 'base64'));
    const { payload } = await jwtDecrypt(token, keyBytes);
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

const generateAccessToken = async (user) => {
  return await generateToken(user, process.env.JWT_ENCRYPTION_KEY, process.env.JWT_EXPIRES_IN || '15m');
};

const generateRefreshToken = async (user) => {
  return await generateToken(user, process.env.REFRESH_ENCRYPTION_KEY, process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');
};

const verifyRefreshToken = async (token) => {
  return await decryptToken(token, process.env.REFRESH_ENCRYPTION_KEY);
};

const generateEmailVerificationToken = async (payload) => {
  return await generateToken(payload, process.env.JWT_ENCRYPTION_KEY, process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN || '24h');
};

const generatePasswordResetToken = async (payload) => {
  return await generateToken(payload, process.env.JWT_ENCRYPTION_KEY, '1h');
};

const verifyEmailVerificationToken = async (token) => {
  // Check if token is blacklisted
  const isBlacklisted = await redisClient.get(`blacklist:${token}`);
  if (isBlacklisted) {
    throw new Error('Token has been used and is no longer valid');
  }
  return await decryptToken(token, process.env.JWT_ENCRYPTION_KEY);
};

const blacklistToken = async (token, ttlSeconds) => {
  if (!ttlSeconds) {
    // Default to 15 minutes for access tokens
    const expiration = process.env.JWT_EXPIRES_IN || '15m';
    ttlSeconds = require('ms')(expiration) / 1000;
  }
  await redisClient.setex(`blacklist:${token}`, ttlSeconds, 'true');
};

module.exports = {
  authenticateToken,
  verifyToken,
  decryptToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateEmailVerificationToken,
  verifyEmailVerificationToken,
  generatePasswordResetToken,
  blacklistToken
};
