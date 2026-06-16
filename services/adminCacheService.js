const redisClient = require('../config/redisConfig');

const ADMIN_CACHE_PREFIX = 'admin:data:';
const ADMIN_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_SECONDS || 60);

function getStableQuery(query) {
    return Object.keys(query || {})
        .sort()
        .reduce((acc, key) => {
            acc[key] = query[key];
            return acc;
        }, {});
}

function getAdminCacheKey(req) {
    return `${ADMIN_CACHE_PREFIX}${req.path}:${JSON.stringify(getStableQuery(req.query))}`;
}

async function clearAdminCache() {
    try {
        if (redisClient.status !== 'ready') return;

        let cursor = '0';
        do {
            const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', `${ADMIN_CACHE_PREFIX}*`, 'COUNT', 100);
            if (keys.length) {
                await redisClient.del(...keys);
            }
            cursor = nextCursor;
        } while (cursor !== '0');
    } catch (error) {
        console.warn('Failed to clear admin Redis cache:', error.message);
    }
}

function invalidateAdminCache(req, res, next) {
    clearAdminCache().finally(next);
}

function cachedAdminData(handler) {
    return async (req, res, next) => {
        if (redisClient.status !== 'ready') {
            return handler(req, res, next);
        }

        const cacheKey = getAdminCacheKey(req);

        try {
            const cachedPayload = await redisClient.get(cacheKey);
            if (cachedPayload) {
                res.set('X-Redis-Cache', 'HIT');
                return res.json(JSON.parse(cachedPayload));
            }
        } catch (error) {
            console.warn('Failed to read admin Redis cache:', error.message);
            return handler(req, res, next);
        }

        const originalJson = res.json.bind(res);
        res.json = function(payload) {
            if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
                redisClient.set(cacheKey, JSON.stringify(payload), 'EX', ADMIN_CACHE_TTL_SECONDS).catch(error => {
                    console.warn('Failed to write admin Redis cache:', error.message);
                });
            }
            res.set('X-Redis-Cache', 'MISS');
            return originalJson(payload);
        };

        return handler(req, res, next);
    };
}

module.exports = {
    cachedAdminData,
    invalidateAdminCache,
    clearAdminCache
};
