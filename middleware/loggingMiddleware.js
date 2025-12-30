const { v4: uuidv4 } = require('uuid');
const useragent = require('useragent');
const geoip = require('geoip-lite');

const loggingMiddleware = async (req, res, next) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    
    // Capture request details
    const sensitiveFields = ['accessToken', 'refreshToken', 'password', 'token'];

    // Extract and log token data from the authorization header
    let token = null;
    let tokenData = null;
    if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
            // Decrypt the token using the JWT middleware
            try {
                const { decryptToken } = require('./jwtMiddleware');
                const decryptedData = await decryptToken(token, process.env.JWT_ENCRYPTION_KEY);
                // Remove the 'exp' field from the decrypted data
                if (decryptedData && decryptedData.exp !== undefined) {
                    delete decryptedData.exp;
                }
                tokenData = decryptedData;
            } catch (e) {
                console.error('Error decrypting token:', e);
                tokenData = null;
            }
        }
    }

    // Sanitize request headers
    const sanitizedHeaders = { ...req.headers };
    const headerSensitiveFields = ['authorization', ...sensitiveFields];
    headerSensitiveFields.forEach(field => {
        if (sanitizedHeaders[field]) {
            sanitizedHeaders[field] = '[REDACTED]';
        }
    });

    // Sanitize request query
    const sanitizedQuery = { ...req.query };
    sensitiveFields.forEach(field => {
        if (sanitizedQuery[field]) {
            sanitizedQuery[field] = '[REDACTED]';
        }
    });

    // Sanitize request body
    const sanitizedBody = typeof req.body === 'object' ? { ...req.body } : req.body;
    if (typeof sanitizedBody === 'object') {
        sensitiveFields.forEach(field => {
            if (sanitizedBody[field]) {
                sanitizedBody[field] = '[REDACTED]';
            }
        });
    }

    const logData = {
        requestId,
        timestamp: new Date().toISOString(),
        route: req.path,
        method: req.method,
        requestHeaders: sanitizedHeaders,
        requestBody: sanitizedBody,
        requestQuery: sanitizedQuery,
        requestParams: req.params,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        token: token,
        userDetails: tokenData
    };

    // Parse user agent to get device and browser details
    const agent = useragent.parse(logData.userAgent);
    logData.deviceOs = agent.os.toString();
    logData.deviceType = agent.device.toString();
    logData.browser = agent.toAgent();
    logData.browserVersion = agent.toVersion();

    // Get geo-location based on IP
    const geo = geoip.lookup(logData.ip);
    if (geo) {
        logData.geoCountry = geo.country;
        logData.geoRegion = geo.region;
        logData.geoCity = geo.city;
        // Format coordinates for Elasticsearch geo_point type
        logData.geoLocation = geo.ll ? `${geo.ll[1]},${geo.ll[0]}` : null;
    } else {
        // Fallback for local IPs or when geoip-lite does not return data
        logData.geoCountry = null;
        logData.geoRegion = null;
        logData.geoCity = null;
        logData.geoLocation = null;
    }

    // Capture response details
    const originalSend = res.send;
    res.send = function (body) {
        logData.responseStatusCode = res.statusCode;
        
        // Exclude sensitive fields from the response body
        const sensitiveFields = ['accessToken', 'refreshToken', 'password', 'token'];
        
        if (typeof body === 'object') {
            const sanitizedBody = JSON.parse(JSON.stringify(body)); // Deep copy
            
            const sanitizeNested = (obj) => {
                if (typeof obj !== 'object' || obj === null) {
                    return obj;
                }

                if (Array.isArray(obj)) {
                    return obj.map(item => {
                        if (typeof item === 'string') {
                            try {
                                const parsed = JSON.parse(item);
                                return sanitizeNested(parsed);
                            } catch (e) {
                                return item;
                            }
                        }
                        return sanitizeNested(item);
                    });
                }

                const sanitizedObj = { ...obj };
                sensitiveFields.forEach(field => {
                    if (sanitizedObj[field]) {
                        sanitizedObj[field] = '[REDACTED]';
                    }
                });

                Object.keys(sanitizedObj).forEach(key => {
                    sanitizedObj[key] = sanitizeNested(sanitizedObj[key]);
                });

                return sanitizedObj;
            };

            const sanitizedResponse = sanitizeNested(sanitizedBody);
            logData.responseBody = sanitizedResponse;
        } else {
            try {
                const parsedBody = JSON.parse(body);
                const sanitizedBody = JSON.parse(JSON.stringify(parsedBody));
                
                const sanitizeNested = (obj) => {
                    if (typeof obj !== 'object' || obj === null) {
                        return obj;
                    }

                    if (Array.isArray(obj)) {
                        return obj.map(item => sanitizeNested(item));
                    }

                    const sanitizedObj = { ...obj };
                    sensitiveFields.forEach(field => {
                        if (sanitizedObj[field]) {
                            sanitizedObj[field] = '[REDACTED]';
                        }
                    });

                    Object.keys(sanitizedObj).forEach(key => {
                        sanitizedObj[key] = sanitizeNested(sanitizedObj[key]);
                    });

                    return sanitizedObj;
                };

                const sanitizedResponse = sanitizeNested(sanitizedBody);
                logData.responseBody = sanitizedResponse;
            } catch (e) {
                logData.responseBody = body.toString();
            }
        }
        
        logData.responseHeaders = res.getHeaders();

        // Calculate response time
        logData.responseTime = Date.now() - startTime;

        // Log the data to Elasticsearch
        const elasticsearchService = require('../services/elasticsearchService');
        elasticsearchService.logData(logData);

        originalSend.call(this, body);
    };

    // Handle errors
    res.on('error', (err) => {
        logData.errorMessage = err.message;
        logData.errorStack = err.stack;
        logData.errorName = err.name;

        // Log the error to Elasticsearch
        const elasticsearchService = require('../services/elasticsearchService');
        elasticsearchService.logData(logData);
    });

    next();
};

module.exports = loggingMiddleware;
