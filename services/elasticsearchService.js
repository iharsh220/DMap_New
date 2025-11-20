const client = require('../config/elasticsearchConfig');

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
    const sensitiveFields = ['password', 'token', 'email', 'phone']; // Add more as needed
    const sanitized = { ...data };

    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}

const elasticsearchService = new ElasticsearchService();

module.exports = elasticsearchService;