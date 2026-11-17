const Coupon = require('../models/Coupon');
const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const HttpError = require('./httpError');

const money = (n) => Math.round(n * 100) / 100;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const normalize = (code) => String(code || '').trim().toUpperCase();
const vendorIdOf = (product) => String(product.vendor?._id ?? product.vendor);

function discountFor(coupon, subtotal) {
  let d = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount) d = Math.min(d, coupon.maxDiscount);
  // Never make an order free: the payment gateway can't take a zero amount.
  d = Math.min(d, Math.max(0, subtotal - 1));
  return money(Math.max(0, d));
}

// Checks a code against the cart and returns what it would take off. Throws a readable 400
// for every reason it can't be used. `lines` are cart lines ({ product, qty }).
async function checkCoupon({ code, customerId, lines }) {
  const clean = normalize(code);
  if (!clean) throw new HttpError(400, 'Enter a coupon code');

  const coupon = await Coupon.findOne({ code: clean });
  if (!coupon || !coupon.isActive) throw new HttpError(400, 'That coupon code is not valid');
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) throw new HttpError(400, 'This coupon has expired');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new HttpError(400, 'This coupon has been fully used');
  }

  const vendorId = String(coupon.vendor);
  const vendor = await Vendor.findById(coupon.vendor);
  const shopName = vendor?.shopName || 'its shop';
  const mine = lines.filter((l) => vendorIdOf(l.product) === vendorId);
  if (!mine.length) throw new HttpError(400, `This coupon only works on items from ${shopName}`);

  const subtotal = money(mine.reduce((sum, l) => sum + l.product.price * l.qty, 0));
  if (subtotal < coupon.minOrder) {
    throw new HttpError(400, `Spend at least ${inr(coupon.minOrder)} on ${shopName} items to use this coupon`);
  }
  if (await Order.exists({ customer: customerId, 'coupon.code': clean, status: { $ne: 'cancelled' } })) {
    throw new HttpError(400, 'You have already used this coupon');
  }

  const discount = discountFor(coupon, subtotal);
  if (discount <= 0) throw new HttpError(400, 'This coupon gives no discount on your cart');
  return { code: clean, couponId: coupon._id, vendorId, shopName, usageLimit: coupon.usageLimit, subtotal, discount };
}

// Counts one use. Atomic: if the limit is reached by someone else a moment earlier, this fails.
async function redeem(applied) {
  const filter = { _id: applied.couponId, isActive: true };
  if (applied.usageLimit != null) filter.usedCount = { $lt: applied.usageLimit };
  const res = await Coupon.updateOne(filter, { $inc: { usedCount: 1 } });
  return res.modifiedCount === 1;
}

// Gives the use back when an order is cancelled or checkout fails.
const release = (code) => Coupon.updateOne({ code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });

module.exports = { checkCoupon, redeem, release, discountFor };