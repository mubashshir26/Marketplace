// Usage: npm run reindex
// Rebuilds the Elasticsearch "products" index from MongoDB. Run it after "npm run seed".
require('dotenv').config();
const mongoose = require('mongoose');
const { reindexAll } = require('../services/search');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/marketplace');
  const count = await reindexAll();
  console.log(`Indexed ${count} products into Elasticsearch.`);
}

main()
  .catch((err) => {
    console.error('Reindex failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());