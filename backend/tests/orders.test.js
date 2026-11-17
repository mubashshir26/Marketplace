process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

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

test('cart: customers only, validates and respects stock', async () => {
  assert.strictEqual((await call('GET', '/api/cart')).status, 401);
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.vA })).status, 403);

  assert.strictEqual((await call('POST', '/api/cart/items', { tok: T.c1, json: { productId: 'nope' } })).status, 400);
  assert.strictEqual((await add(T.c1, pHidden, 1)).status, 404); // inactive product
  assert.strictEqual((await add(T.c1, { _id: id() }, 1)).status, 404); // unknown product

  const r = await add(T.c1, pA1, 2);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, 2);
  assert.strictEqual(r.body.items[0].lineTotal, 200);

  // adding again accumulates; going past stock (5) is refused
  assert.strictEqual((await add(T.c1, pA1, 3)).body.count, 5);
  const over = await add(T.c1, pA1, 1);
  assert.strictEqual(over.status, 409);
  assert.match(over.body.error, /Only 5 in stock/);

  // set qty, then qty 0 removes
  assert.strictEqual((await call('PATCH', `/api/cart/items/${pA1._id}`, { tok: T.c1, json: { qty: 1 } })).body.count, 1);
  assert.strictEqual((await call('PATCH', `/api/cart/items/${pA1._id}`, { tok: T.c1, json: { qty: 0 } })).body.items.length, 0);

  // carts are per user, and prices are read fresh (no stale price stored)
  await add(T.c1, pA2, 1);
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c2 })).body.items.length, 0);
  pA2.price = 300;
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c1 })).body.subtotal, 300);
  pA2.price = 250.5;

  // a product that disappears is dropped from the cart quietly
  const gone = mk(shopB, 'Gone', 5, 5);
  await add(T.c1, gone, 1);
  gone.isActive = false;
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c1 })).body.items.length, 1);

  assert.strictEqual((await call('DELETE', '/api/cart', { tok: T.c1 })).body.items.length, 0);
});

test('checkout: validation and empty cart', async () => {
  assert.strictEqual((await checkout(T.vA)).status, 403);
  assert.strictEqual((await checkout(T.c1)).status, 400); // empty cart
  await add(T.c1, pA1, 1);
  assert.strictEqual((await checkout(T.c1, { shippingAddress: { ...address, phone: '12345' } })).status, 400);
  assert.strictEqual((await checkout(T.c1, { shippingAddress: { ...address, pincode: '12' } })).status, 400);
  assert.strictEqual((await checkout(T.c1, {})).status, 400);
  assert.strictEqual((await checkout(T.c1, { shippingAddress: address, paymentMethod: 'card' })).status, 400);
  await call('DELETE', '/api/cart', { tok: T.c1 });
});

test('checkout: one order per vendor, stock taken, cart cleared', async () => {
  const stockA1 = pA1.stock;
  await add(T.c1, pA1, 2);
  await add(T.c1, pA2, 1);
  await add(T.c1, pB1, 3);
  esStock.length = 0;

  const r = await checkout(T.c1);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.orders.length, 2);
  assert.strictEqual(new Set(r.body.orders.map((o) => o.groupId)).size, 1);
  assert.strictEqual(r.body.orders[0].groupId, r.body.groupId);

  const oA = r.body.orders.find((o) => String(o.vendor) === String(shopA._id));
  const oB = r.body.orders.find((o) => String(o.vendor) === String(shopB._id));
  assert.strictEqual(oA.total, 450.5); // 2 x 100 + 250.5
  assert.strictEqual(oB.total, 120);
  assert.strictEqual(oA.status, 'placed');
  assert.deepStrictEqual(oA.payment, { method: 'cod', status: 'pending' });
  assert.strictEqual(oA.items[0].name, 'Mug');
  assert.strictEqual(oA.shippingAddress.city, 'Pune');

  assert.strictEqual(pA1.stock, stockA1 - 2);
  assert.strictEqual(pA2.stock, 2);
  assert.strictEqual(pB1.stock, 7);
  assert.strictEqual(esStock.length, 3); // search index told about each stock change
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c1 })).body.items.length, 0);
  assert.strictEqual((await checkout(T.c1)).status, 400); // cart is empty now
});

test('checkout: out of stock mid-way rolls everything back', async () => {
  const stockA2 = pA2.stock;
  const stockB1 = pB1.stock;
  const ordersBefore = Order.rows.length;
  await add(T.c2, pA2, 1);
  await add(T.c2, pB1, 2);
  pB1.stock = 1; // someone else buys it before this checkout runs

  const r = await checkout(T.c2);
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /Pen/);
  assert.strictEqual(pA2.stock, stockA2, 'first item was put back');
  assert.strictEqual(pB1.stock, 1);
  assert.strictEqual(Order.rows.length, ordersBefore, 'no order created');
  assert.strictEqual((await call('GET', '/api/cart', { tok: T.c2 })).body.items.length, 2, 'cart kept so the user can fix it');

  pB1.stock = stockB1;
  await call('DELETE', '/api/cart', { tok: T.c2 });
});

test('checkout: lock blocks double submit; parallel clicks create one order set', async () => {
  await add(T.c2, pB1, 1);
  strings.set(`lock:checkout:${U.c2}`, '1'); // simulate a checkout already running
  assert.strictEqual((await checkout(T.c2)).status, 409);
  strings.delete(`lock:checkout:${U.c2}`);

  const before = Order.rows.length;
  const results = await Promise.all([checkout(T.c2), checkout(T.c2)]);
  assert.deepStrictEqual(results.map((r) => r.status).sort(), [201, results.find((r) => r.status !== 201).status]);
  assert.strictEqual(results.filter((r) => r.status === 201).length, 1);
  assert.strictEqual(Order.rows.length - before, 1);
  assert.ok(!strings.has(`lock:checkout:${U.c2}`), 'lock released');
});

let orderA;
let orderB;
test('orders: who can see what', async () => {
  orderA = Order.rows.find((o) => String(o.vendor) === String(shopA._id));
  orderB = Order.rows.find((o) => String(o.vendor) === String(shopB._id) && String(o.customer) === String(U.c1));

  assert.strictEqual((await call('GET', '/api/orders', { tok: T.c1 })).body.orders.length, 2);
  assert.strictEqual((await call('GET', '/api/orders', { tok: T.c2 })).body.orders.length, 1);
  assert.strictEqual((await call('GET', '/api/orders', { tok: T.vA })).status, 403);

  assert.strictEqual((await call('GET', `/api/orders/${orderA._id}`, { tok: T.c1 })).status, 200);
  assert.strictEqual((await call('GET', `/api/orders/${orderA._id}`, { tok: T.c2 })).status, 404); // someone else's
  assert.strictEqual((await call('GET', `/api/orders/${orderA._id}`, { tok: T.vA })).status, 200);
  assert.strictEqual((await call('GET', `/api/orders/${orderA._id}`, { tok: T.vB })).status, 404); // other shop
  assert.strictEqual((await call('GET', `/api/orders/${orderA._id}`, { tok: T.admin })).status, 200);
  assert.strictEqual((await call('GET', '/api/orders/xyz', { tok: T.c1 })).status, 400);

  const vendorList = await call('GET', '/api/orders/vendor', { tok: T.vA });
  assert.strictEqual(vendorList.body.orders.length, 1);
  assert.strictEqual((await call('GET', '/api/orders/vendor', { tok: T.c1 })).status, 403);
});

test('lifecycle: placed -> packed -> shipped -> delivered, with permission checks', async () => {
  const patch = (t, o, status) => call('PATCH', `/api/orders/${o._id}/status`, { tok: t, json: { status } });

  assert.strictEqual((await patch(T.c1, orderA, 'packed')).status, 403); // customers cannot
  assert.strictEqual((await patch(T.vB, orderA, 'packed')).status, 404); // another shop cannot
  assert.strictEqual((await patch(T.vA, orderA, 'bogus')).status, 400);
  const skip = await patch(T.vA, orderA, 'shipped');
  assert.strictEqual(skip.status, 409); // cannot skip "packed"
  assert.match(skip.body.error, /placed/);

  assert.strictEqual((await patch(T.vA, orderA, 'packed')).body.order.status, 'packed');
  assert.strictEqual((await patch(T.vA, orderA, 'shipped')).body.order.status, 'shipped');
  const done = await patch(T.vA, orderA, 'delivered');
  assert.strictEqual(done.body.order.status, 'delivered');
  assert.strictEqual(done.body.order.payment.status, 'paid', 'COD is marked paid on delivery');
  assert.deepStrictEqual(orderA.statusHistory.map((h) => h.status), ['placed', 'packed', 'shipped', 'delivered']);
  assert.strictEqual((await patch(T.vA, orderA, 'cancelled')).status, 409); // delivered is final
});

test('cancel: customer before packing restocks; after packing it is refused', async () => {
  const stockBefore = pB1.stock;
  esStock.length = 0;
  const cancelled = await call('POST', `/api/orders/${orderB._id}/cancel`, { tok: T.c1 });
  assert.strictEqual(cancelled.status, 200);
  assert.strictEqual(cancelled.body.order.status, 'cancelled');
  assert.strictEqual(pB1.stock, stockBefore + 3, 'items returned to stock');
  assert.deepStrictEqual(esStock, [[String(pB1._id), 3]]);
  assert.strictEqual((await call('POST', `/api/orders/${orderB._id}/cancel`, { tok: T.c1 })).status, 409); // already cancelled

  // another customer's order cannot be cancelled by c1
  const other = Order.rows.find((o) => String(o.customer) === String(U.c2));
  assert.strictEqual((await call('POST', `/api/orders/${other._id}/cancel`, { tok: T.c1 })).status, 404);

  // a packed order is past the point of customer cancellation
  await call('PATCH', `/api/orders/${other._id}/status`, { tok: T.vB, json: { status: 'packed' } });
  const late = await call('POST', `/api/orders/${other._id}/cancel`, { tok: T.c2 });
  assert.strictEqual(late.status, 409);
  assert.match(late.body.error, /packed/);

  // but the vendor can still cancel it (e.g. item damaged), which restocks
  const stockMid = pB1.stock;
  assert.strictEqual((await call('PATCH', `/api/orders/${other._id}/status`, { tok: T.vB, json: { status: 'cancelled' } })).status, 200);
  assert.strictEqual(pB1.stock, stockMid + other.items[0].qty);
});
