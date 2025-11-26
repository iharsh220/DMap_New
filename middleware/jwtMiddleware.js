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
    return res.status(400).json({ success: false, error: 'Token is required' });
  }

  try {
    const keyBytes = Uint8Array.from(Buffer.from(process.env.JWT_ENCRYPTION_KEY, 'base64'));
    const { payload } = await jwtDecrypt(token, keyBytes);
    req.user = payload;
    next();
  } catch (error) {
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

const generateEmailVerificationToken = async (email) => {
  return await generateToken({ email }, process.env.JWT_ENCRYPTION_KEY, process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN || '24h');
};

const verifyEmailVerificationToken = async (token) => {
  return await decryptToken(token, process.env.JWT_ENCRYPTION_KEY);
};

module.exports = {
  authenticateToken,
  verifyToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateEmailVerificationToken,
  verifyEmailVerificationToken
};