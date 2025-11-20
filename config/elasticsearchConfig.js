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

module.exports = client;