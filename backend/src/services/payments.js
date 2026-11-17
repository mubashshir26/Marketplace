const crypto = require('crypto');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const HttpError = require('./httpError');

const API = 'https://api.razorpay.com/v1';
const money = (n) => Math.round(n * 100) / 100;
const paise = (rupees) => Math.round(rupees * 100);

const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;
const isConfigured = () => Boolean(keyId() && keySecret());

// Minimal Razorpay REST client (Basic auth with key id + secret). Gateway failures become 502.
async function rzp(path, body) {
  if (!isConfigured()) throw new HttpError(503, 'Online payments are not configured on the server');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, 'Could not reach the payment gateway');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, data.error?.description || 'The payment gateway rejected the request');
  return data;
}

// One Razorpay order covers the whole checkout (all vendors' orders in the group).
async function createGatewayOrder({ amount, receipt }) {
  const o = await rzp('/orders', { amount: paise(amount), currency: 'INR', receipt, notes: { groupId: receipt } });
  return { id: o.id, amount: o.amount, currency: o.currency };
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// Checks the signature Razorpay Checkout returns to the browser. Proves the payment is genuine.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!keySecret()) return false;
  return safeEqual(hmac(keySecret(), `${orderId}|${paymentId}`), signature);
}

// Checks the signature on a webhook call (HMAC of the raw request body).
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  return safeEqual(hmac(secret, rawBody), signature);
}

function commissionRate(vendor) {
  const own = vendor?.commissionPercent;
  const pct = Number.isFinite(own) ? own : Number(process.env.COMMISSION_PERCENT ?? 10);
  return Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 10));
}

function splitFor(total, vendor) {
  const rate = commissionRate(vendor);
  const commission = money((total * rate) / 100);
  return { rate, commission, vendorAmount: money(total - commission) };
}

async function computeSplit(order) {
  return splitFor(order.total, await Vendor.findById(order.vendor));
}

// Sends each vendor's share to their Razorpay linked account (Route). Fail-soft: the customer's
// payment is already safe, so a failed or impossible transfer is recorded for the admin instead
// of failing the order. Vendors without a linked account are "skipped" (ledger only).
async function settle(orders, vendorsById, paymentId) {
  const accountOf = (o) => vendorsById.get(String(o.vendor))?.razorpayAccountId || '';
  const payable = orders.filter(accountOf);
  let items = [];
  let error = '';
  if (payable.length) {
    try {
      const r = await rzp(`/payments/${paymentId}/transfers`, {
        transfers: payable.map((o) => ({
          account: accountOf(o),
          amount: paise(o.payment.vendorAmount),
          currency: 'INR',
          notes: { orderNumber: o.orderNumber },
        })),
      });
      items = r.items || [];
    } catch (err) {
      error = err.message;
    }
  }
  for (const o of orders) {
    const acc = accountOf(o);
    let set;
    if (!acc) set = { 'payment.transferStatus': 'skipped' };
    else if (error) set = { 'payment.transferStatus': 'failed', 'payment.transferError': error };
    else {
      const t = items.find((x) => x.recipient === acc);
      set = t
        ? { 'payment.transferStatus': 'processed', 'payment.transferId': t.id }
        : { 'payment.transferStatus': 'failed', 'payment.transferError': 'No transfer returned' };
    }
    await Order.updateOne({ _id: o._id }, { $set: set });
  }
}

// Called when a payment is confirmed (browser verify call and/or webhook). Safe to call twice:
// each order is claimed with a conditional update, so only the first call changes anything.
async function markGroupPaid({ razorpayOrderId, paymentId }) {
  const orders = await Order.find({ 'payment.razorpayOrderId': razorpayOrderId });
  if (!orders.length) throw new HttpError(404, 'No order found for this payment');

  const vendors = await Vendor.find({ _id: { $in: orders.map((o) => o.vendor) } });
  const vendorsById = new Map(vendors.map((v) => [String(v._id), v]));
  const now = new Date();
  const claimed = [];

  for (const o of orders) {
    if (o.status === 'pending_payment') {
      const { commission, vendorAmount } = splitFor(o.total, vendorsById.get(String(o.vendor)));
      const updated = await Order.findOneAndUpdate(
        { _id: o._id, status: 'pending_payment' },
        {
          $set: {
            status: 'placed',
            'payment.status': 'paid',
            'payment.razorpayPaymentId': paymentId,
            'payment.paidAt': now,
            'payment.commission': commission,
            'payment.vendorAmount': vendorAmount,
          },
          $push: { statusHistory: { status: 'placed', at: now } },
        },
        { new: true }
      );
      if (updated) claimed.push(updated);
    } else if (o.status === 'cancelled' && o.payment.status === 'pending') {
      // Paid after the order expired or was cancelled: try to give the money back.
      await Order.updateOne(
        { _id: o._id, 'payment.status': 'pending' },
        { $set: { 'payment.status': 'refund_due', 'payment.razorpayPaymentId': paymentId } }
      );
      const fresh = await Order.findById(o._id);
      if (fresh) await refundIfPaid(fresh, { force: true });
    }
  }

  if (claimed.length) await settle(claimed, vendorsById, paymentId);
  return claimed.length;
}

// Refunds a paid online order that got cancelled. Fail-soft: if Razorpay refuses, the order is
// flagged refund_due so an admin can refund it from the dashboard.
async function refundIfPaid(order, { force = false } = {}) {
  const p = order.payment;
  if (p.method !== 'online' || !p.razorpayPaymentId) return;
  if (!force && p.status !== 'paid') return;
  if (p.status === 'refunded') return;
  try {
    const body = { amount: paise(order.total), notes: { orderNumber: order.orderNumber } };
    if (p.transferId) body.reverse_all = 1; // take the vendor's share back too
    await rzp(`/payments/${p.razorpayPaymentId}/refund`, body);
    order.payment.status = 'refunded';
  } catch (err) {
    console.warn(`Refund failed for ${order.orderNumber}:`, err.message);
    order.payment.status = 'refund_due';
  }
  await order.save();
}

module.exports = {
  isConfigured,
  keyId,
  createGatewayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  commissionRate,
  splitFor,
  computeSplit,
  markGroupPaid,
  refundIfPaid,
};