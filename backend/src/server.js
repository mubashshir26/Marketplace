require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const redis = require('./config/redis');
const { ensureIndex } = require('./services/search');
const { expireUnpaid } = require('./services/orders');

const PORT = process.env.PORT || 5000;

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/marketplace');
  await redis.connect();
  try {
    await ensureIndex();
  } catch (err) {
    // The API still works without search; /api/search will answer 503 until Elasticsearch is up.
    console.warn('Elasticsearch not reachable, search disabled:', err.message);
  }
  // Every 5 minutes, release stock held by online checkouts nobody paid for within 30 minutes.
  setInterval(() => {
    expireUnpaid(30).catch((err) => console.warn('Expiry sweep failed:', err.message));
  }, 5 * 60 * 1000).unref();
  app.listen(PORT, () => console.log(`API listening on :${PORT}`));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});