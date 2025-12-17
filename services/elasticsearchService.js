const { client, getCurrentMonthIndex, logIndexMappings } = require('../config/elasticsearchConfig');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');

class ElasticsearchService {
  constructor() {
    this.indexName = getCurrentMonthIndex(); // dmap-current_month_name
  }

  async logUserActivity(logData) {
    try {
      // Remove sensitive data
      const sanitizedData = this.sanitizeLogData(logData);

      await client.index({
        index: this.indexName,
        body: {
          ...sanitizedData,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('Error logging to Elasticsearch:', error);
    }
  }

  async logData(logData) {
    try {
      // Ensure the index exists with the correct mappings
      await this.ensureIndexExists();

      // Remove sensitive data
      const sanitizedData = this.sanitizeLogData(logData);

      await client.index({
        index: this.indexName,
        body: sanitizedData
      });
    } catch (error) {
      console.error('Error logging to Elasticsearch:', error);
    }
  }

  async ensureIndexExists() {
    try {
      const indexExists = await client.indices.exists({ index: this.indexName });
      
      if (!indexExists) {
        // Create the index with the mappings
        await client.indices.create({
          index: this.indexName,
          body: {
            mappings: logIndexMappings
          }
        });
      }
    } catch (error) {
      console.error('Error ensuring index exists:', error);
    }
  }

  sanitizeLogData(data) {
    const sensitiveFields = ['password', 'token', 'accessToken', 'refreshToken']; // Add more as needed
    const sanitized = JSON.parse(JSON.stringify(data)); // Deep copy

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

    return sanitizeNested(sanitized);
  }

  extractRequestDetails(req) {
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const userAgentString = req.get('User-Agent') || 'unknown';

    // Parse user agent
    const parser = new UAParser(userAgentString);
    const browser = parser.getBrowser();
    const device = parser.getDevice();
    const os = parser.getOS();
    const cpu = parser.getCPU();

    // Get location from IP
    const geo = geoip.lookup(ip);
    const location = geo ? {
      country: geo.country,
      region: geo.region,
      city: geo.city,
      timezone: geo.timezone,
      latitude: geo.ll ? geo.ll[0] : null,
      longitude: geo.ll ? geo.ll[1] : null
    } : null;

    return {
      ip,
      userAgent: userAgentString,
      browser: {
        name: browser.name || 'unknown',
        version: browser.version || 'unknown'
      },
      device: {
        type: device.type || 'desktop',
        vendor: device.vendor || 'unknown',
        model: device.model || 'unknown'
      },
      os: {
        name: os.name || 'unknown',
        version: os.version || 'unknown'
      },
      cpu: {
        architecture: cpu.architecture || 'unknown'
      },
      location
    };
  }
}

const elasticsearchService = new ElasticsearchService();

module.exports = {
  ...elasticsearchService,
  logUserActivity: elasticsearchService.logUserActivity.bind(elasticsearchService),
  logData: elasticsearchService.logData.bind(elasticsearchService),
  extractRequestDetails: elasticsearchService.extractRequestDetails.bind(elasticsearchService),
  sanitizeLogData: elasticsearchService.sanitizeLogData.bind(elasticsearchService)
};