const mongoose = require('mongoose');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Product = require('../models/Product');
const { indexProduct, syncSearch } = require('./search');

// Verified purchase: the customer must have a delivered order containing this product.
const canReview = async (customerId, productId) =>
  Boolean(await Order.exists({ customer: customerId, status: 'delivered', 'items.product': productId }));

// "Asha Rao" -> "Asha R." so reviews don't expose full names.
function displayName(name = '') {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  if (!first) return 'Customer';
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first;
}

// Recomputes the product's average from its reviews, and updates search so "Top rated" sorting
// and the rating filter stay correct.
async function refreshRating(productId) {
  const [agg] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const ratingAvg = agg ? Math.round(agg.avg * 100) / 100 : 0;
  const ratingCount = agg ? agg.count : 0;
  await Product.updateOne({ _id: productId }, { $set: { ratingAvg, ratingCount } });

  const product = await Product.findById(productId).populate('vendor', 'shopName');
  if (product) await syncSearch(() => indexProduct(product, product.vendor?.shopName));
  return { ratingAvg, ratingCount };
}

module.exports = { canReview, displayName, refreshRating };