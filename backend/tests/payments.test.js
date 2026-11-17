process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
process.env.COMMISSION_PERCENT = '10';
const crypto = require('crypto');

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// ---- fake Redis (hashes, strings, SET NX) ----
const hashes = new Map();
const strings = new Map();
stub('../src/config/redis', {
  hgetall: async (k) => ({ ...(hashes.get(k) || {}) }),
  hget: async (k, f) => (hashes.get(k) || {})[f] ?? null,
  hset: async (k, f, v) => { const h = hashes.get(k) || {}; h[f] = String(v); hashes.set(k, h); return 1; },
  hdel: async (k, ...fs) => {
    const h = hashes.get(k) || {};
    fs.forEach((f) => delete h[f]);
    if (!Object.keys(h).length) hashes.delete(k);
    return fs.length;
  },
  del: async (...ks) => { ks.forEach((k) => { hashes.delete(k); strings.delete(k); }); return ks.length; },
  expire: async () => 1,
  set: async (k, v, ...args) => {
    if (args.includes('NX') && strings.has(k)) return null;
    strings.set(k, v);
    return 'OK';
  },
});

// ---- fake Elasticsearch: records stock adjustments ----
const esStock = [];
stub('../src/config/elastic', {
  update: async (args) => { esStock.push([args.id, args.script.params.delta]); },
});

// ---- fake Mongoose models (equality, $in, $gte, $inc) ----
function fakeModel(defaults = {}) {
  const rows = [];
  const plain = (c) => c && typeof c === 'object' && Object.getPrototypeOf(c) === Object.prototype;
  const matchVal = (rv, c) => {
    if (plain(c)) {
      if ('$in' in c) return c.$in.map(String).includes(String(rv));
      if ('$gte' in c) return rv >= c.$gte;
      if ('$lt' in c) return rv < c.$lt;
      if ('$ne' in c) return String(rv) !== String(c.$ne);
    }
    return String(rv) === String(c);
  };
  const dig = (row, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
  const put = (row, path, v) => {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] ??= {}), row);
    target[last] = v;
  };
  const match = (row, f) => Object.entries(f).every(([k, v]) => matchVal(dig(row, k), v));
  const apply = (r, u) => {
    Object.entries(u.$inc || {}).forEach(([k, v]) => { r[k] += v; });
    Object.entries(u.$set || {}).forEach(([k, v]) => put(r, k, v));
    Object.entries(u.$push || {}).forEach(([k, v]) => { r[k] = [...(r[k] || []), v]; });
  };
  const query = (fn) => {
    const q = {
      populate: () => q, sort: () => q, limit: () => q,
      then: (res, rej) => Promise.resolve().then(fn).then(res, rej),
    };
    return q;
  };
  const wrap = (d) => Object.assign(d, { set(o) { Object.assign(this, o); }, async save() { return this; } });
  const make = (d) => wrap({ _id: new Types.ObjectId(), ...defaults, ...d });
  return {
    rows,
    seed: (d) => { const r = make(d); rows.push(r); return r; },
    create: async (d) => {
      const made = (Array.isArray(d) ? d : [d]).map(make);
      rows.push(...made);
      return Array.isArray(d) ? made : made[0];
    },
    find: (f = {}) => query(() => rows.filter((r) => match(r, f))),
    findOne: (f) => query(() => rows.find((r) => match(r, f)) || null),
    findById: (id) => query(() => rows.find((r) => String(r._id) === String(id)) || null),
    updateOne: async (f, u) => {
      const r = rows.find((x) => match(x, f));
      if (!r) return { modifiedCount: 0 };
      apply(r, u);
      return { modifiedCount: 1 };
    },
    updateMany: async (f, u) => {
      const hit = rows.filter((x) => match(x, f));
      hit.forEach((r) => apply(r, u));
      return { modifiedCount: hit.length };
    },
    findOneAndUpdate: async (f, u) => {
      const r = rows.find((x) => match(x, f));
      if (!r) return null;
      apply(r, u);
      return r;
    },
  };
}
const Product = fakeModel({ isActive: true, images: [] });
const Vendor = fakeModel({ status: 'approved' });
const Order = fakeModel({ discount: 0 });
stub('../src/models/Product', Product);
stub('../src/models/Vendor', Vendor);
stub('../src/models/Order', Order);

const app = require('../src/app');

// ---- fixtures ----
const id = () => new Types.ObjectId();
const U = { c1: id(), c2: id(), vA: id(), vB: id(), admin: id() };
const tok = (role, sub) => jwt.sign({ role }, process.env.JWT_ACCESS_SECRET, { subject: String(sub), expiresIn: '5m' });
const T = {
  c1: tok('customer', U.c1), c2: tok('customer', U.c2),
  vA: tok('vendor', U.vA), vB: tok('vendor', U.vB), admin: tok('admin', U.admin),
};
const shopA = Vendor.seed({ user: U.vA, shopName: 'Alpha' });
const shopB = Vendor.seed({ user: U.vB, shopName: 'Beta' });
const mk = (vendor, name, price, stock, extra = {}) =>
  Product.seed({ vendor: { _id: vendor._id, shopName: vendor.shopName }, name, price, stock, ...extra });
const pA1 = mk(shopA, 'Mug', 100, 5);
const pA2 = mk(shopA, 'Lamp', 250.5, 3);
const pB1 = mk(shopB, 'Pen', 40, 10);
const pHidden = mk(shopA, 'Hidden', 10, 10, { isActive: false });

const address = { name: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'MH', pincode: '411001' };

let server;
let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, { tok: t, json } = {}) {
  const headers = {};
  if (t) headers.authorization = `Bearer ${t}`;
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const add = (t, p, qty) => call('POST', '/api/cart/items', { tok: t, json: { productId: String(p._id), qty } });
const checkout = (t, body = { shippingAddress: address }) => call('POST', '/api/checkout', { tok: t, json: body });

// ---- fake Razorpay API (intercepts calls to api.razorpay.com only) ----
const gw = { calls: [], failNext: null, orderSeq: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com/v1')) return realFetch(url, opts);
  const path = String(url).replace('https://api.razorpay.com/v1', '');
  const body = JSON.parse(opts.body || '{}');
  gw.calls.push({ path, body, auth: opts.headers.Authorization });
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (gw.failNext) { const f = gw.failNext; gw.failNext = null; return reply(400, { error: { description: f } }); }
  if (path === '/orders') return reply(200, { id: `order_T${++gw.orderSeq}`, amount: body.amount, currency: body.currency });
  if (path.endsWith('/transfers')) return reply(200, { items: body.transfers.map((t, i) => ({ id: `trf_${i}`, recipient: t.account })) });
  if (path.endsWith('/refund')) return reply(200, { id: 'rfnd_1' });
  return reply(404, {});
};

const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'key_secret').update(`${orderId}|${paymentId}`).digest('hex');
const verify = (t, orderId, paymentId, signature = sign(orderId, paymentId)) =>
  call('POST', '/api/checkout/verify', { tok: t, json: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } });
const hook = async (payload, secret = 'hook_secret') => {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const captured = (orderId, paymentId) => ({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });
const online = (t) => checkout(t, { shippingAddress: address, paymentMethod: 'online' });
const ordersOf = (groupId) => Order.rows.filter((o) => o.groupId === groupId);

test('online checkout: reserves stock, keeps cart, hides unpaid orders from vendors', async () => {
  await add(T.c1, pA1, 2); // Alpha 200
  await add(T.c1, pB1, 1); // Beta 40
  const stockBefore = pA1.stock;
  const r = await online(T.c1);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.keyId, 'rzp_test_key');
  assert.strictEqual(r.body.payment.amount, 24000); // paise: (200 + 40) * 100
  assert.match(gw.calls.at(-1).auth, /^Basic /);

  const rows = ordersOf(r.body.groupId);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((o) => o.status === 'pending_payment' && o.payment.method === 'online' && o.payment.razorpayOrderId === r.body.payment.orderId));
  assert.strictEqual(pA1.stock, stockBefore - 2);

  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c1 })).body.items.length, 2); // cart untouched
  const vendorView = await call('GET', '/api/orders/vendor', { tok: T.vA });
  assert.strictEqual(vendorView.body.orders.filter((o) => o.groupId === r.body.groupId).length, 0);
  const rowA = rows.find((o) => String(o.vendor) === String(shopA._id));
  assert.strictEqual((await call('PATCH', `/api/orders/${rowA._id}/status`, { tok: T.vA, json: { status: 'packed' } })).status, 409);
});

test('verify: bad signature rejected; good one places orders, splits commission, clears cart, is idempotent', async () => {
  const rows = Order.rows.filter((o) => o.status === 'pending_payment');
  const orderId = rows[0].payment.razorpayOrderId;
  const groupId = rows[0].groupId;

  assert.strictEqual((await verify(T.c1, orderId, 'pay_1', 'f'.repeat(64))).status, 400);
  assert.strictEqual((await verify(T.c2, orderId, 'pay_1')).status, 404); // someone else's order
  assert.ok(ordersOf(groupId).every((o) => o.status === 'pending_payment'));

  const callsBefore = gw.calls.length;
  const ok = await verify(T.c1, orderId, 'pay_1');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.groupId, groupId);

  const [a, b] = ordersOf(groupId).sort((x, y) => y.total - x.total);
  assert.strictEqual(a.status, 'placed');
  assert.strictEqual(a.payment.status, 'paid');
  assert.strictEqual(a.payment.razorpayPaymentId, 'pay_1');
  assert.strictEqual(a.payment.commission, 20); // 10% of 200
  assert.strictEqual(a.payment.vendorAmount, 180);
  assert.strictEqual(b.payment.commission, 4);
  assert.strictEqual(a.payment.transferStatus, 'skipped'); // no linked account yet: ledger only
  assert.strictEqual(a.statusHistory.at(-1).status, 'placed');
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c1 })).body.items.length, 0);
  assert.strictEqual(gw.calls.length, callsBefore); // no transfers attempted

  // webhook for the same payment changes nothing
  const history = a.statusHistory.length;
  assert.strictEqual((await hook(captured(orderId, 'pay_1'))).status, 200);
  assert.strictEqual(a.statusHistory.length, history);
});

test('linked vendor account gets a Route transfer of their share; per-vendor commission overrides default', async () => {
  shopA.razorpayAccountId = 'acc_ALPHA';
  shopA.commissionPercent = 20;
  await add(T.c2, pA1, 1); // 100
  const r = await online(T.c2);
  const orderId = r.body.payment.orderId;
  assert.strictEqual((await verify(T.c2, orderId, 'pay_2')).status, 200);

  const t = gw.calls.filter((c) => c.path === '/payments/pay_2/transfers');
  assert.strictEqual(t.length, 1);
  assert.deepStrictEqual(t[0].body.transfers.map((x) => [x.account, x.amount]), [['acc_ALPHA', 8000]]); // 100 - 20% = 80
  const o = ordersOf(r.body.groupId)[0];
  assert.strictEqual(o.payment.commission, 20);
  assert.strictEqual(o.payment.transferStatus, 'processed');
  assert.strictEqual(o.payment.transferId, 'trf_0');
});

test('failed transfer does not fail the payment', async () => {
  await add(T.c1, pA1, 1);
  const r = await online(T.c1);
  gw.failNext = null;
  const orig = gw.calls.length;
  // make only the transfer call fail
  const realImpl = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/transfers')) return { ok: false, status: 400, json: async () => ({ error: { description: 'Route not activated' } }) };
    return realImpl(url, opts);
  };
  try {
    assert.strictEqual((await verify(T.c1, r.body.payment.orderId, 'pay_3')).status, 200);
  } finally {
    globalThis.fetch = realImpl;
  }
  const o = ordersOf(r.body.groupId)[0];
  assert.strictEqual(o.status, 'placed');
  assert.strictEqual(o.payment.status, 'paid');
  assert.strictEqual(o.payment.transferStatus, 'failed');
  assert.strictEqual(o.payment.transferError, 'Route not activated');
  assert.ok(gw.calls.length >= orig);
});

test('webhook: signature required; captured payment confirms an order the browser never verified', async () => {
  await add(T.c2, pB1, 2);
  const r = await online(T.c2);
  const orderId = r.body.payment.orderId;

  assert.strictEqual((await hook(captured(orderId, 'pay_4'), 'wrong')).status, 400);
  assert.ok(ordersOf(r.body.groupId).every((o) => o.status === 'pending_payment'));

  assert.strictEqual((await hook(captured(orderId, 'pay_4'))).status, 200);
  assert.ok(ordersOf(r.body.groupId).every((o) => o.status === 'placed' && o.payment.status === 'paid'));

  const unknown = await hook(captured('order_nope', 'pay_x'));
  assert.strictEqual(unknown.status, 200);
  assert.strictEqual(unknown.body.ignored, true);
});

test('closing the payment window releases stock; expiry sweep does the same for abandoned checkouts', async () => {
  const { expireUnpaid } = require('../src/services/orders');
  const before = pB1.stock;
  await add(T.c1, pB1, 3);
  const r = await online(T.c1);
  assert.strictEqual(pB1.stock, before - 3);
  assert.strictEqual((await call('POST', `/api/checkout/${r.body.groupId}/cancel`, { tok: T.c1 })).body.cancelled, 1);
  assert.strictEqual(pB1.stock, before);
  assert.strictEqual(ordersOf(r.body.groupId)[0].status, 'cancelled');

  await call('DELETE', '/api/cart', { tok: T.c1 });
  await add(T.c1, pB1, 1);
  const r2 = await online(T.c1);
  const o = ordersOf(r2.body.groupId)[0];
  assert.strictEqual(await expireUnpaid(30), 0); // too recent
  o.createdAt = new Date(Date.now() - 31 * 60 * 1000);
  assert.strictEqual(await expireUnpaid(30), 1);
  assert.strictEqual(o.status, 'cancelled');
  assert.strictEqual(pB1.stock, before);

  // late payment for an expired order is refunded, not accepted
  gw.calls.length = 0;
  assert.strictEqual((await hook(captured(r2.body.payment.orderId, 'pay_late'))).status, 200);
  assert.strictEqual(o.status, 'cancelled');
  assert.strictEqual(o.payment.status, 'refunded');
  assert.ok(gw.calls.some((c) => c.path === '/payments/pay_late/refund'));
});

test('cancelling a paid online order refunds it (and reverses the vendor transfer)', async () => {
  await call('DELETE', '/api/cart', { tok: T.c2 }); // the webhook test above left its items in the cart
  await add(T.c2, pA2, 1); // Alpha, linked account set above
  const r = await online(T.c2);
  await verify(T.c2, r.body.payment.orderId, 'pay_5');
  const o = ordersOf(r.body.groupId)[0];
  assert.strictEqual(o.payment.transferStatus, 'processed');

  gw.calls.length = 0;
  const res = await call('POST', `/api/orders/${o._id}/cancel`, { tok: T.c2 });
  assert.strictEqual(res.status, 200);
  const refund = gw.calls.find((c) => c.path === '/payments/pay_5/refund');
  assert.strictEqual(refund.body.amount, 25050);
  assert.strictEqual(refund.body.reverse_all, 1);
  assert.strictEqual(o.payment.status, 'refunded');
});

test('refund failure is flagged refund_due instead of being lost', async () => {
  await add(T.c1, pB1, 1);
  const r = await online(T.c1);
  await verify(T.c1, r.body.payment.orderId, 'pay_6');
  const o = ordersOf(r.body.groupId)[0];
  gw.failNext = 'Insufficient balance';
  assert.strictEqual((await call('POST', `/api/orders/${o._id}/cancel`, { tok: T.c1 })).status, 200);
  assert.strictEqual(o.status, 'cancelled');
  assert.strictEqual(o.payment.status, 'refund_due');
});

test('gateway failure at checkout cancels the orders and returns the stock', async () => {
  const before = pB1.stock;
  await add(T.c2, pB1, 1);
  gw.failNext = 'Authentication failed';
  const r = await online(T.c2);
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.error, 'Authentication failed');
  assert.strictEqual(pB1.stock, before);
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c2 })).body.items.length, 1);
});

test('online payment refuses politely when keys are missing', async () => {
  const id = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  const before = pB1.stock;
  const r = await online(T.c2);
  process.env.RAZORPAY_KEY_ID = id;
  assert.strictEqual(r.status, 503);
  assert.strictEqual(pB1.stock, before); // nothing was reserved
});

test('cash on delivery records the commission when delivered; bad payment method rejected', async () => {
  await call('DELETE', '/api/cart', { tok: T.c2 });
  await add(T.c2, pB1, 1); // 40, Beta uses the default 10%
  assert.strictEqual((await checkout(T.c2, { shippingAddress: address, paymentMethod: 'bitcoin' })).status, 400);
  const r = await checkout(T.c2);
  const o = ordersOf(r.body.groupId)[0];
  assert.strictEqual(o.status, 'placed');
  for (const status of ['packed', 'shipped', 'delivered']) {
    assert.strictEqual((await call('PATCH', `/api/orders/${o._id}/status`, { tok: T.vB, json: { status } })).status, 200);
  }
  assert.strictEqual(o.payment.status, 'paid');
  assert.strictEqual(o.payment.commission, 4);
  assert.strictEqual(o.payment.vendorAmount, 36);
});
