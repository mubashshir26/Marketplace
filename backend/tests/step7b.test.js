process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.CLIENT_ORIGIN = 'https://shop.example.com/, http://localhost:5173';
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
      populate: () => q, sort: () => q, limit: () => q, skip: () => q, select: () => q, lean: () => q,
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

User.seed({ _id: U.c1, name: 'Asha Rao', role: 'customer' });
User.seed({ _id: U.c2, name: 'Vikram', role: 'customer' });

const raw = async (url, t) => {
  const res = await fetch(base + url, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  return { status: res.status, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), buf: Buffer.from(await res.arrayBuffer()) };
};
const orderRow = (o) => Order.seed({
  groupId: 'g', orderNumber: `ORD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, shippingAddress: address, status: 'delivered',
  payment: { method: 'cod', status: 'paid', commission: 0, vendorAmount: 0, transferStatus: 'none' }, createdAt: new Date(), ...o,
});
const line = (p, qty) => ({ product: p._id, name: p.name, price: p.price, qty });

test('invoice: PDF for the buyer, the shop and admins only; none for unpaid or cancelled orders', async () => {
  const o = orderRow({
    customer: U.c1, vendor: shopA._id, items: [line(pA1, 2)], subtotal: 200, discount: 20, coupon: { code: 'SAVE10', discount: 20 }, total: 180, status: 'placed',
  });
  const url = `/api/orders/${o._id}/invoice`;

  assert.strictEqual((await raw(url)).status, 401);
  assert.strictEqual((await raw(url, T.c2)).status, 404); // someone else's order
  assert.strictEqual((await raw(url, T.vB)).status, 404); // another shop

  for (const who of [T.c1, T.vA, T.admin]) {
    const r = await raw(url, who);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.type, 'application/pdf');
    assert.match(r.disp, new RegExp(`invoice-${o.orderNumber}\\.pdf`));
    assert.strictEqual(r.buf.subarray(0, 5).toString(), '%PDF-');
  }

  const waiting = orderRow({ customer: U.c1, vendor: shopA._id, items: [line(pA1, 1)], subtotal: 100, total: 100, status: 'pending_payment' });
  const gone = orderRow({ customer: U.c1, vendor: shopA._id, items: [line(pA1, 1)], subtotal: 100, total: 100, status: 'cancelled' });
  assert.strictEqual((await raw(`/api/orders/${waiting._id}/invoice`, T.c1)).status, 409);
  assert.strictEqual((await raw(`/api/orders/${gone._id}/invoice`, T.c1)).status, 409);
});

test('invoice: many items spill onto a second page without breaking', async () => {
  const { buildInvoice } = require('../src/services/invoice');
  const items = Array.from({ length: 45 }, (_, i) => ({ product: pA1._id, name: `Product ${i + 1} नमस्ते`, price: 10 + i, qty: 1 }));
  const buf = await buildInvoice({
    shopName: 'Alpha',
    order: { orderNumber: 'ORD-BIG', createdAt: new Date(), items, subtotal: 1, total: 1, discount: 0, payment: { method: 'cod', status: 'pending' }, shippingAddress: address },
  });
  assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2);
});

test('analytics: admin only, validated window', async () => {
  assert.strictEqual((await call('GET', '/api/admin/analytics')).status, 401);
  assert.strictEqual((await call('GET', '/api/admin/analytics', { tok: T.c1 })).status, 403);
  assert.strictEqual((await call('GET', '/api/admin/analytics', { tok: T.vA })).status, 403);
  assert.strictEqual((await call('GET', '/api/admin/analytics?days=5', { tok: T.admin })).status, 400);
  const empty = await call('GET', '/api/admin/analytics?days=7', { tok: T.admin });
  assert.strictEqual(empty.status, 200);
  assert.strictEqual(empty.body.daily.length, 7);
});

test('analytics: sales, commission, payouts due, top lists and the day-by-day series', async () => {
  Order.rows.length = 0;
  const day = 24 * 60 * 60 * 1000;
  const paid = (commission, vendorAmount, transferStatus = 'none') => ({ method: 'online', status: 'paid', commission, vendorAmount, transferStatus });

  // sales that count
  orderRow({ customer: U.c1, vendor: shopA._id, items: [line(pA1, 2)], subtotal: 200, total: 200, payment: paid(20, 180) });            // transfer still owed
  orderRow({ customer: U.c1, vendor: shopA._id, items: [line(pA2, 1)], subtotal: 250.5, total: 200.5, discount: 50, payment: paid(20.05, 180.45, 'processed') }); // already sent
  orderRow({ customer: U.c2, vendor: shopB._id, items: [line(pB1, 3)], subtotal: 120, total: 120, status: 'shipped', createdAt: new Date(Date.now() - 3 * day), payment: paid(12, 108) });
  // not sales
  orderRow({ customer: U.c2, vendor: shopB._id, items: [line(pB1, 1)], subtotal: 40, total: 40, status: 'cancelled', payment: { method: 'online', status: 'refund_due' } });
  orderRow({ customer: U.c2, vendor: shopB._id, items: [line(pB1, 1)], subtotal: 40, total: 40, status: 'pending_payment', payment: { method: 'online', status: 'pending' } });
  // outside the 7 day window
  orderRow({ customer: U.c1, vendor: shopA._id, items: [line(pA1, 9)], subtotal: 900, total: 900, createdAt: new Date(Date.now() - 20 * day), payment: paid(90, 810) });

  const { status, body } = await call('GET', '/api/admin/analytics?days=7', { tok: T.admin });
  assert.strictEqual(status, 200);

  assert.strictEqual(body.totals.gmv, 520.5);
  assert.strictEqual(body.totals.orders, 3);
  assert.strictEqual(body.totals.avgOrderValue, 173.5);
  assert.strictEqual(body.totals.commission, 52.05);
  assert.strictEqual(body.totals.discounts, 50);
  assert.strictEqual(body.totals.units, 6);
  assert.strictEqual(body.totals.vendors, 2);
  assert.strictEqual(body.totals.customers, 2);

  assert.strictEqual(body.payouts.due, 288); // 180 + 108, the 180.45 was already transferred
  assert.strictEqual(body.payouts.refundsDue, 1);
  assert.deepStrictEqual(body.statusCounts, { delivered: 2, shipped: 1, cancelled: 1, pending_payment: 1 });

  assert.deepStrictEqual(body.topVendors.map((v) => [v.shopName, v.orders, v.revenue]), [['Alpha', 2, 400.5], ['Beta', 1, 120]]);
  assert.strictEqual(body.topVendors[0].payoutDue, 180);
  assert.deepStrictEqual(body.topProducts.map((p) => [p.name, p.units, p.revenue]), [['Lamp', 1, 250.5], ['Mug', 2, 200], ['Pen', 3, 120]]);

  assert.strictEqual(body.daily.length, 7);
  const today = body.daily.at(-1);
  assert.deepStrictEqual([today.orders, today.revenue, today.commission], [2, 400.5, 40.05]);
  assert.strictEqual(body.daily.at(-4).orders, 1); // the shipped Beta order, 3 days ago
  assert.strictEqual(body.daily.reduce((t, d) => t + d.orders, 0), 3); // the 20 day old order is not in a 7 day chart
});

test('CORS: every listed frontend is allowed (trailing slash ignored), others are not', async () => {
  const origin = async (o) => (await fetch(`${base}/api/health`, { headers: { origin: o } })).headers.get('access-control-allow-origin');
  assert.strictEqual(await origin('https://shop.example.com'), 'https://shop.example.com');
  assert.strictEqual(await origin('http://localhost:5173'), 'http://localhost:5173');
  assert.notStrictEqual(await origin('https://evil.example.com'), 'https://evil.example.com');
});
