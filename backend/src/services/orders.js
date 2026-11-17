const crypto = require('crypto');
const Product = require('../models/Product');
const Order = require('../models/Order');
const HttpError = require('./httpError');
const { adjustStock, syncSearch } = require('./search');
const { computeSplit, refundIfPaid } = require('./payments');
const { redeem, release } = require('./coupons');

// Allowed moves of the order lifecycle. Anything else is rejected.
const TRANSITIONS = {
  pending_payment: ['placed', 'cancelled'],
  placed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const money = (n) => Math.round(n * 100) / 100;
const vendorIdOf = (product) => String(product.vendor?._id ?? product.vendor);

async function restock(items) {
  await Promise.all(items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.qty } })));
  await syncSearch(() => Promise.all(items.map((i) => adjustStock(i.product, i.qty))));
}

// Turns cart lines into one order per vendor.
// Stock is taken with a conditional update ("only if stock >= qty"), so two buyers can never
// get the last item. MongoDB without a replica set has no transactions, so if anything fails
// midway the stock already taken is put back.
// `paymentMethod` 'online' creates the orders as pending_payment (stock is reserved until paid).
// `coupon` is the result of checkCoupon(): its discount applies to that vendor's order only.
async function placeOrders({ customerId, lines, shippingAddress, paymentMethod = 'cod', coupon = null }) {
  const taken = [];
  let redeemed = false;
  try {
    for (const { product, qty } of lines) {
      const res = await Product.updateOne(
        { _id: product._id, isActive: true, stock: { $gte: qty } },
        { $inc: { stock: -qty } }
      );
      if (res.modifiedCount !== 1) {
        throw new HttpError(409, `"${product.name}" is out of stock or has fewer than ${qty} left`);
      }
      taken.push({ product: product._id, qty });
    }

    if (coupon) {
      redeemed = await redeem(coupon);
      if (!redeemed) throw new HttpError(409, 'This coupon has just been fully used');
    }

    const groupId = crypto.randomUUID();
    const online = paymentMethod === 'online';
    const first = online ? 'pending_payment' : 'placed';
    const byVendor = new Map();
    for (const line of lines) {
      const vid = vendorIdOf(line.product);
      byVendor.set(vid, [...(byVendor.get(vid) || []), line]);
    }

    const docs = [...byVendor.entries()].map(([vendor, vLines]) => {
      const items = vLines.map(({ product, qty }) => ({
        product: product._id,
        name: product.name,
        image: product.images?.[0] || '',
        price: product.price, // price at the moment of purchase
        qty,
      }));
      const subtotal = money(items.reduce((sum, i) => sum + i.price * i.qty, 0));
      const discount = coupon && vendor === coupon.vendorId ? coupon.discount : 0;
      return {
        groupId,
        customer: customerId,
        vendor,
        items,
        subtotal,
        discount,
        coupon: discount ? { code: coupon.code, discount } : undefined,
        total: money(subtotal - discount),
        status: first,
        statusHistory: [{ status: first, at: new Date() }],
        payment: { method: online ? 'online' : 'cod', status: 'pending' },
        shippingAddress,
      };
    });

    const orders = await Order.create(docs);
    await syncSearch(() => Promise.all(taken.map((t) => adjustStock(t.product, -t.qty))));
    return orders;
  } catch (err) {
    await Promise.all(taken.map((t) => Product.updateOne({ _id: t.product }, { $inc: { stock: t.qty } })));
    if (redeemed) await release(coupon.code);
    throw err;
  }
}

// Moves an order to a new status if the lifecycle allows it.
async function changeStatus(order, to) {
  if (!(TRANSITIONS[order.status] || []).includes(to)) {
    throw new HttpError(409, `An order that is ${order.status} cannot be moved to ${to}`);
  }
  order.status = to;
  order.statusHistory.push({ status: to, at: new Date() });
  if (to === 'delivered' && order.payment.method === 'cod') {
    // Cash collected: record the commission split now, since there is no online payment event.
    const { commission, vendorAmount } = await computeSplit(order);
    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    order.payment.commission = commission;
    order.payment.vendorAmount = vendorAmount;
  }
  await order.save();
  if (to === 'cancelled') {
    await restock(order.items);
    await refundIfPaid(order);
    if (order.coupon?.code) await release(order.coupon.code); // the coupon can be used again
  }
  return order;
}

// Cancels a checkout that was never paid (customer closed the payment window).
async function cancelUnpaidGroup({ groupId, customerId }) {
  const orders = await Order.find({ groupId, customer: customerId, status: 'pending_payment' });
  for (const o of orders) await changeStatus(o, 'cancelled');
  return orders.length;
}

// Releases stock held by online checkouts that were abandoned (tab closed, payment never done).
async function expireUnpaid(minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const stale = await Order.find({ status: 'pending_payment', createdAt: { $lt: cutoff } });
  for (const o of stale) await changeStatus(o, 'cancelled');
  return stale.length;
}

module.exports = { TRANSITIONS, placeOrders, changeStatus, cancelUnpaidGroup, expireUnpaid };