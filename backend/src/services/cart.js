const mongoose = require('mongoose');
const redis = require('../config/redis');
const Product = require('../models/Product');
const HttpError = require('./httpError');

const TTL_SECONDS = 7 * 24 * 60 * 60; // an untouched cart expires after a week
const MAX_QTY = 20;

const key = (userId) => `cart:${userId}`;
const money = (n) => Math.round(n * 100) / 100;

// The cart is a Redis hash: productId -> qty. Prices are never stored in it,
// they are always read fresh from MongoDB, so a cart can never hold an outdated price.
async function loadLines(userId) {
  const raw = await redis.hgetall(key(userId));
  const ids = Object.keys(raw).filter((id) => mongoose.isValidObjectId(id));
  const products = ids.length ? await Product.find({ _id: { $in: ids } }).populate('vendor', 'shopName') : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const stale = [];
  for (const id of Object.keys(raw)) {
    const product = byId.get(id);
    if (!product || !product.isActive) stale.push(id); // deleted or hidden since it was added
    else lines.push({ product, qty: Number(raw[id]) });
  }
  if (stale.length) await redis.hdel(key(userId), ...stale);
  return lines;
}

async function getCart(userId) {
  const lines = await loadLines(userId);
  const items = lines.map(({ product, qty }) => ({
    product: {
      _id: product._id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] || null,
      stock: product.stock,
      vendor: { shopName: product.vendor?.shopName || '' },
    },
    qty,
    lineTotal: money(product.price * qty),
    available: product.stock >= qty,
  }));
  return {
    items,
    subtotal: money(items.reduce((sum, i) => sum + i.lineTotal, 0)),
    count: items.reduce((sum, i) => sum + i.qty, 0),
  };
}

async function setQty(userId, productId, qty) {
  if (qty <= 0) {
    await redis.hdel(key(userId), productId);
    return;
  }
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new HttpError(404, 'Product not found');
  if (qty > MAX_QTY) throw new HttpError(409, `You can buy at most ${MAX_QTY} of one item`);
  if (qty > product.stock) throw new HttpError(409, product.stock > 0 ? `Only ${product.stock} in stock` : 'Out of stock');

  await redis.hset(key(userId), productId, qty);
  await redis.expire(key(userId), TTL_SECONDS);
}

async function addItem(userId, productId, qty) {
  const current = Number(await redis.hget(key(userId), productId)) || 0;
  await setQty(userId, productId, current + qty);
}

const removeItem = (userId, productId) => redis.hdel(key(userId), productId);
const clearCart = (userId) => redis.del(key(userId));

module.exports = { MAX_QTY, loadLines, getCart, setQty, addItem, removeItem, clearCart };
