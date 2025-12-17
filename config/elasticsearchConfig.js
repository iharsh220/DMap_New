const { Client } = require('@elastic/elasticsearch');

const client = new Client({
  node: process.env.ELASTICSEARCH_HOST,
  auth: {
    username: process.env.ELASTICSEARCH_USER,
    password: process.env.ELASTICSEARCH_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  },
  maxRetries: 3,
  requestTimeout: 60000
});

const getCurrentMonthIndex = () => {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  return `d-map-${months[currentMonth]}-${currentYear}`;
};

const logIndexMappings = {
  properties: {
    requestId: { type: 'keyword' },
    timestamp: { type: 'date' },
    route: { type: 'keyword' },
    method: { type: 'keyword' },
    userId: { type: 'keyword' },
    userEmail: { type: 'keyword' },
    userRole: { type: 'keyword' },
    requestHeaders: { type: 'object' },
    requestBody: { type: 'object' },
    requestQuery: { type: 'object' },
    requestParams: { type: 'object' },
    responseStatusCode: { type: 'integer' },
    responseBody: { type: 'object' },
    responseHeaders: { type: 'object' },
    errorMessage: { type: 'text' },
    errorStack: { type: 'text' },
    errorName: { type: 'keyword' },
    ip: { type: 'ip' },
    userAgent: { type: 'text' },
    deviceOs: { type: 'keyword' },
    deviceType: { type: 'keyword' },
    browser: { type: 'keyword' },
    browserVersion: { type: 'keyword' },
    geoCountry: { type: 'keyword' },
    geoRegion: { type: 'keyword' },
    geoCity: { type: 'keyword' },
    geoLocation: { type: 'geo_point' },
    token: { type: 'keyword' },
    tokenData: { type: 'object' },
    paramTokenData: { type: 'object' },
    responseTime: { type: 'long' }
  }
};

module.exports = {
  client,
  getCurrentMonthIndex,
  logIndexMappings
};