// Usage: npm run seed            (skips if products already exist)
//        npm run seed -- --reset (deletes all products, then reseeds)
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');

const USD_TO_INR = 83; // DummyJSON prices are in USD; shown in rupees here
const SHOPS = ['Urban Kart', 'Green Basket', 'Tech Hive', 'Style Street'];
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
const VENDOR_PASSWORD = 'Vendor@123';

async function ensureUser(name, email, password, role) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/marketplace');

  if (process.argv.includes('--reset')) {
    await Product.deleteMany({});
  } else if (await Product.countDocuments()) {
    console.log('Products already exist. Run "npm run seed -- --reset" to reseed.');
    return;
  }

  const res = await fetch('https://dummyjson.com/products?limit=200');
  if (!res.ok) throw new Error(`DummyJSON request failed: ${res.status}`);
  const { products } = await res.json();

  await ensureUser('Admin', ADMIN_EMAIL, ADMIN_PASSWORD, 'admin');

  const vendors = [];
  for (let i = 0; i < SHOPS.length; i += 1) {
    const user = await ensureUser(`Vendor ${i + 1}`, `vendor${i + 1}@example.com`, VENDOR_PASSWORD, 'vendor');
    const vendor =
      (await Vendor.findOne({ user: user._id })) ||
      (await Vendor.create({
        user: user._id,
        shopName: SHOPS[i],
        description: `Demo shop: ${SHOPS[i]}`,
        status: 'approved',
      }));
    vendors.push(vendor);
  }

  const docs = products.map((p, i) => ({
    vendor: vendors[i % vendors.length]._id,
    name: p.title,
    description: p.description,
    category: p.category,
    price: Math.round(p.price * USD_TO_INR),
    stock: p.stock,
    images: p.images?.length ? p.images : [p.thumbnail].filter(Boolean),
    ratingAvg: p.rating || 0,
    ratingCount: p.reviews?.length || 0,
  }));
  await Product.insertMany(docs);

  console.log(`Seeded ${docs.length} products across ${vendors.length} vendors.`);
  console.log(`Admin:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Vendors: vendor1@example.com ... vendor${SHOPS.length}@example.com / ${VENDOR_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());