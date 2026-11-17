const { Client } = require('@elastic/elasticsearch');

// Fail fast when Elasticsearch is down so product writes and search never hang.
// Local Docker needs no login. Elastic Cloud gives a URL and an API key (set both in the environment).
module.exports = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  ...(process.env.ELASTICSEARCH_API_KEY ? { auth: { apiKey: process.env.ELASTICSEARCH_API_KEY } } : {}),
  requestTimeout: 5000,
  maxRetries: 1,
});