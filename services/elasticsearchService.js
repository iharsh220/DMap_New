const client = require('../config/elasticsearchConfig');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');

class ElasticsearchService {
  constructor() {
    this.indexName = `dmap-${new Date().toISOString().split('T')[0]}`; // dmap-current_date
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

  sanitizeLogData(data) {
    const sensitiveFields = ['password', 'token']; // Add more as needed
    const sanitized = { ...data };

    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
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
  extractRequestDetails: elasticsearchService.extractRequestDetails.bind(elasticsearchService),
  sanitizeLogData: elasticsearchService.sanitizeLogData.bind(elasticsearchService)
};