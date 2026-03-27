const Redis = require('ioredis');

const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
        if (times > 3) {
            console.error('Redis connection failed after 3 retries');
            return null;
        }
        return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
});

redisClient.on('connect', () => {
    console.log('Redis client connected successfully');
});

redisClient.on('error', (err) => {
    console.error('Redis client error:', err);
});

redisClient.on('ready', () => {
    console.log('Redis client is ready');
});

module.exports = redisClient;
