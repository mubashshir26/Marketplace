process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'key_secret';

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
const esIndexed = [];
stub('../src/config/elastic', {
  update: async (args) => { esStock.push([args.id, args.script.params.delta]); },
  index: async (args) => { esIndexed.push(args.document); },
});

// ---- fake Mongoose models (equality, $in, $gte, $inc) ----
function fakeModel(defaults = {}) {
  const rows = [];
  const plain = (c) => c && typeof c === 'object' && Object.getPrototypeOf(c) === Object.prototype;
  const matchVal = (rv, c) => {
    if (Array.isArray(rv)) return rv.some((x) => matchVal(x, c)); // Mongo matches if any array element does
    if (plain(c)) {
      if ('$in' in c) return c.$in.map(String).includes(String(rv));
      if ('$gte' in c) return rv >= c.$gte;
      if ('$lt' in c) return rv < c.$lt;
      if ('$gt' in c) return rv > c.$gt;
      if ('$ne' in c) return String(rv) !== String(c.$ne);
    }
    return String(rv) === String(c);
  };
  const dig = (row, path) =>
    path.split('.').reduce((o, k) => (Array.isArray(o) ? o.map((x) => x?.[k]) : o == null ? undefined : o[k]), row);
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
      populate: () => q, sort: () => q, limit: () => q, skip: () => q, select: () => q,
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
    exists: (f) => query(() => { const r = rows.find((x) => match(x, f)); return r ? { _id: r._id } : null; }),
    countDocuments: async (f = {}) => rows.filter((r) => match(r, f)).length,
    findOneAndDelete: async (f) => {
      const i = rows.findIndex((x) => match(x, f));
      return i < 0 ? null : rows.splice(i, 1)[0];
    },
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

const Review = fakeModel();
// The fake only understands the one pipeline the service uses: match a product, average the ratings.
Review.aggregate = async (pipe) => {
  const pid = String(pipe[0].$match.product);
  const rs = Review.rows.filter((r) => String(r.product) === pid);
  return rs.length ? [{ _id: null, avg: rs.reduce((t, r) => t + r.rating, 0) / rs.length, count: rs.length }] : [];
};
const Coupon = fakeModel({ isActive: true, usedCount: 0, minOrder: 0, usageLimit: null, expiresAt: null, maxDiscount: null });
// The fake database doesn't enforce unique indexes, so mimic Mongo's duplicate-key error (code 11000).
const unique = (Model, keys) => {
  const create = Model.create;
  Model.create = async (d) => {
    if (Model.rows.some((r) => keys.every((k) => String(r[k]) === String(d[k])))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    return create(d);
  };
};
unique(Coupon, ['code']);
unique(Review, ['product', 'customer']);
const User = fakeModel();
stub('../src/models/Review', Review);
stub('../src/models/Coupon', Coupon);
stub('../src/models/User', User);

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

User.seed({ _id: U.c1, name: 'Asha Rao' });
User.seed({ _id: U.c2, name: 'Vikram' });

// ---- fake Razorpay (only order creation is needed here) ----
const gw = { failNext: null, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com/v1')) return realFetch(url, opts);
  const body = JSON.parse(opts.body || '{}');
  gw.calls.push(body);
  if (gw.failNext) { const f = gw.failNext; gw.failNext = null; return { ok: false, status: 400, json: async () => ({ error: { description: f } }) }; }
  return { ok: true, status: 200, json: async () => ({ id: `order_T${gw.calls.length}`, amount: body.amount, currency: 'INR' }) };
};

const ordersOf = (groupId) => Order.rows.filter((o) => o.groupId === groupId);
const clearCart = (t) => call('DELETE', '/api/cart', { tok: t });
const put = (t, p, json) => call('PUT', `/api/products/${p._id}/reviews`, { tok: t, json });
const mkCoupon = (json, t = T.vA) => call('POST', '/api/coupons', { tok: t, json });
const preview = (t, code) => call('POST', '/api/coupons/preview', { tok: t, json: { code } });

// Buys a product with COD and has its vendor deliver it.
async function deliver(buyer, product, vendorTok) {
  await clearCart(buyer);
  await add(buyer, product, 1);
  const r = await checkout(buyer);
  assert.strictEqual(r.status, 201);
  const o = ordersOf(r.body.groupId)[0];
  for (const status of ['packed', 'shipped', 'delivered']) {
    assert.strictEqual((await call('PATCH', `/api/orders/${o._id}/status`, { tok: vendorTok, json: { status } })).status, 200);
  }
  return o;
}

// ================= reviews =================
test('reviews: only customers who received the product can review', async () => {
  assert.strictEqual((await put(null, pA1, { rating: 5 })).status, 401);
  assert.strictEqual((await put(T.vA, pA1, { rating: 5 })).status, 403); // vendors don't review
  assert.strictEqual((await put(T.c1, pA1, { rating: 5 })).status, 403); // never bought it
  assert.strictEqual((await call('GET', `/api/products/${pA1._id}/reviews/mine`, { tok: T.c1 })).body.canReview, false);
  assert.strictEqual((await call('GET', '/api/products/nope/reviews')).status, 400);

  // ordered but not delivered yet is still not enough
  await clearCart(T.c1);
  await add(T.c1, pA1, 1);
  await checkout(T.c1);
  assert.strictEqual((await put(T.c1, pA1, { rating: 5 })).status, 403);
});

test('reviews: rating is validated; average and search index follow every change', async () => {
  const mine = Order.rows.find((o) => String(o.customer) === String(U.c1) && o.status === 'placed');
  for (const status of ['packed', 'shipped', 'delivered']) {
    await call('PATCH', `/api/orders/${mine._id}/status`, { tok: T.vA, json: { status } });
  }
  await deliver(T.c2, pA1, T.vA);

  assert.strictEqual((await call('GET', `/api/products/${pA1._id}/reviews/mine`, { tok: T.c1 })).body.canReview, true);
  assert.strictEqual((await put(T.c1, pA1, { rating: 6 })).status, 400);
  assert.strictEqual((await put(T.c1, pA1, { rating: 0 })).status, 400);
  assert.strictEqual((await put(T.c1, pA1, { rating: 4, comment: 'x'.repeat(1001) })).status, 400);

  const first = await put(T.c1, pA1, { rating: 4, comment: 'Sturdy mug' });
  assert.strictEqual(first.status, 201);
  assert.deepStrictEqual(first.body.product, { ratingAvg: 4, ratingCount: 1 });
  assert.strictEqual(first.body.review.customerName, 'Asha R.');
  assert.strictEqual(pA1.ratingAvg, 4);
  assert.strictEqual(esIndexed.at(-1).ratingAvg, 4); // "Top rated" sorting in search stays right

  const second = await put(T.c2, pA1, { rating: 5 });
  assert.strictEqual(second.status, 201);
  assert.strictEqual(second.body.review.customerName, 'Vikram');
  assert.deepStrictEqual(second.body.product, { ratingAvg: 4.5, ratingCount: 2 });

  // editing replaces the review instead of adding a second one
  const edit = await put(T.c1, pA1, { rating: 2, comment: 'Handle broke' });
  assert.strictEqual(edit.status, 200);
  assert.deepStrictEqual(edit.body.product, { ratingAvg: 3.5, ratingCount: 2 });
  assert.strictEqual(Review.rows.length, 2);
});

test('reviews: public list hides who wrote it; not-bought products stay closed', async () => {
  const list = await call('GET', `/api/products/${pA1._id}/reviews`);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.total, 2);
  assert.ok(list.body.items.every((r) => r.customer === undefined && r.customerName && r.rating));
  assert.strictEqual((await put(T.c1, pB1, { rating: 5 })).status, 403);
  assert.strictEqual((await put(T.c1, { _id: id() }, { rating: 5 })).status, 404);
});

test('reviews: customers delete only their own, admins can moderate, average recalculates', async () => {
  const [r1, r2] = Review.rows;
  const del = (t, r) => call('DELETE', `/api/products/${pA1._id}/reviews/${r._id}`, { tok: t });
  assert.strictEqual((await del(T.c2, r1)).status, 404); // someone else's review
  assert.strictEqual((await del(T.vA, r1)).status, 403);

  const own = await del(T.c1, r1);
  assert.strictEqual(own.status, 200);
  assert.deepStrictEqual(own.body.product, { ratingAvg: 5, ratingCount: 1 });

  const mod = await del(T.admin, r2);
  assert.strictEqual(mod.status, 200);
  assert.deepStrictEqual(mod.body.product, { ratingAvg: 0, ratingCount: 0 });
  assert.strictEqual(pA1.ratingCount, 0);
});

// ================= coupons =================
test('coupons: vendors create them with validation; codes are unique; ownership enforced', async () => {
  assert.strictEqual((await mkCoupon({ code: 'x', type: 'percent', value: 10 }, T.c1)).status, 403);
  assert.strictEqual((await mkCoupon({ code: 'AB', type: 'percent', value: 10 })).status, 400); // too short
  assert.strictEqual((await mkCoupon({ code: 'BIG95', type: 'percent', value: 95 })).status, 400);
  assert.strictEqual((await mkCoupon({ code: 'BAD', type: 'bogus', value: 5 })).status, 400);
  assert.strictEqual((await mkCoupon({ code: 'PAST', type: 'flat', value: 5, expiresAt: '2020-01-01' })).status, 400);

  const ok = await mkCoupon({ code: ' save10 ', type: 'percent', value: 10, minOrder: 100 });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.coupon.code, 'SAVE10');
  assert.strictEqual((await mkCoupon({ code: 'SAVE10', type: 'flat', value: 5 }, T.vB)).status, 409);

  const mine = await call('GET', '/api/coupons/mine', { tok: T.vA });
  assert.strictEqual(mine.body.coupons.length, 1);
  assert.strictEqual((await call('GET', '/api/coupons/mine', { tok: T.vB })).body.coupons.length, 0);
  assert.strictEqual((await call('PATCH', `/api/coupons/${ok.body.coupon._id}`, { tok: T.vB, json: { isActive: false } })).status, 404);
  assert.strictEqual((await call('DELETE', `/api/coupons/${ok.body.coupon._id}`, { tok: T.vB })).status, 404);
});

test('coupons: preview discounts only the issuing vendor\'s items and explains every refusal', async () => {
  await clearCart(T.c1);
  assert.strictEqual((await preview(T.c1, 'SAVE10')).status, 400); // empty cart
  await add(T.c1, pA1, 2); // Alpha 200
  await add(T.c1, pB1, 1); // Beta 40

  const p = await preview(T.c1, 'save10');
  assert.strictEqual(p.status, 200);
  assert.deepStrictEqual(
    [p.body.code, p.body.shopName, p.body.discount, p.body.subtotal, p.body.total],
    ['SAVE10', 'Alpha', 20, 240, 220]
  );

  const say = async (t, code) => (await preview(t, code)).body.error;
  assert.strictEqual(await say(T.c1, 'NOPE'), 'That coupon code is not valid');

  await mkCoupon({ code: 'BIGSPEND', type: 'flat', value: 50, minOrder: 500 });
  assert.match(await say(T.c1, 'BIGSPEND'), /Spend at least ₹500 on Alpha/);

  await clearCart(T.c1);
  await add(T.c1, pB1, 1);
  assert.match(await say(T.c1, 'SAVE10'), /only works on items from Alpha/);
});

test('coupons: cap, never-free rule, expiry, pause', async () => {
  await clearCart(T.c1);
  await add(T.c1, pA1, 2); // Alpha 200
  await mkCoupon({ code: 'HALF', type: 'percent', value: 50, maxDiscount: 30 });
  assert.strictEqual((await preview(T.c1, 'HALF')).body.discount, 30); // 50% would be 100, capped at 30

  await mkCoupon({ code: 'FLAT1000', type: 'flat', value: 1000 });
  assert.strictEqual((await preview(T.c1, 'FLAT1000')).body.discount, 199); // never takes the whole order

  const half = Coupon.rows.find((c) => c.code === 'HALF');
  half.expiresAt = new Date(Date.now() - 1000);
  assert.strictEqual((await preview(T.c1, 'HALF')).body.error, 'This coupon has expired');

  const flat = Coupon.rows.find((c) => c.code === 'FLAT1000');
  assert.strictEqual((await call('PATCH', `/api/coupons/${flat._id}`, { tok: T.vA, json: { isActive: false } })).status, 200);
  assert.strictEqual((await preview(T.c1, 'FLAT1000')).body.error, 'That coupon code is not valid');
});

test('coupons: checkout applies the discount to that vendor only; one use per customer; cancel gives it back', async () => {
  const save = Coupon.rows.find((c) => c.code === 'SAVE10');
  await clearCart(T.c1);
  await add(T.c1, pA1, 2); // Alpha 200 -> 180
  await add(T.c1, pB1, 1); // Beta 40, no discount

  const r = await checkout(T.c1, { shippingAddress: address, couponCode: 'save10' });
  assert.strictEqual(r.status, 201);
  const [a, b] = ordersOf(r.body.groupId).sort((x, y) => y.subtotal - x.subtotal);
  assert.deepStrictEqual([a.subtotal, a.discount, a.total, a.coupon.code], [200, 20, 180, 'SAVE10']);
  assert.deepStrictEqual([b.subtotal, b.discount, b.total], [40, 0, 40]);
  assert.strictEqual(save.usedCount, 1);

  await add(T.c1, pA1, 1);
  const again = await checkout(T.c1, { shippingAddress: address, couponCode: 'SAVE10' });
  assert.strictEqual(again.status, 400);
  assert.strictEqual(again.body.error, 'You have already used this coupon');

  assert.strictEqual((await call('POST', `/api/orders/${a._id}/cancel`, { tok: T.c1 })).status, 200);
  assert.strictEqual(save.usedCount, 0);
  assert.strictEqual((await preview(T.c1, 'SAVE10')).status, 200); // usable again
});

test('coupons: usage limit is shared by all customers', async () => {
  await mkCoupon({ code: 'ONCE', type: 'flat', value: 10, usageLimit: 1 });
  await clearCart(T.c1);
  await add(T.c1, pA1, 1);
  await clearCart(T.c2);
  await add(T.c2, pA1, 1);

  assert.strictEqual((await checkout(T.c1, { shippingAddress: address, couponCode: 'ONCE' })).status, 201);
  const late = await checkout(T.c2, { shippingAddress: address, couponCode: 'ONCE' });
  assert.strictEqual(late.status, 400);
  assert.strictEqual(late.body.error, 'This coupon has been fully used');
});

test('coupons: online checkout charges the discounted amount; a gateway failure returns the coupon use', async () => {
  const code = 'SAVE10';
  const save = Coupon.rows.find((c) => c.code === code);
  await clearCart(T.c2);
  await add(T.c2, pA1, 2); // Alpha 200 -> 180
  const before = save.usedCount;

  const ok = await checkout(T.c2, { shippingAddress: address, paymentMethod: 'online', couponCode: code });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.payment.amount, 18000); // paise of the discounted total
  assert.strictEqual(save.usedCount, before + 1);
  await call('POST', `/api/checkout/${ok.body.groupId}/cancel`, { tok: T.c2 }); // customer closes the window
  assert.strictEqual(save.usedCount, before);

  gw.failNext = 'Authentication failed';
  const bad = await checkout(T.c2, { shippingAddress: address, paymentMethod: 'online', couponCode: code });
  assert.strictEqual(bad.status, 502);
  assert.strictEqual(save.usedCount, before); // not burned by the failed attempt
});
