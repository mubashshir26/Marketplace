process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');

// ---- In-memory stand-ins for Redis and the Mongoose models (no database needed) ----
function fakeModel(defaults = {}) {
  const rows = [];
  const match = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === String(v));
  const query = (fn) => {
    const q = {
      populate: () => q, sort: () => q, skip: () => q, limit: () => q,
      then: (res, rej) => Promise.resolve().then(fn).then(res, rej),
    };
    return q;
  };
  const wrap = (d) => Object.assign(d, { set(o) { Object.assign(this, o); }, async save() { return this; } });
  return {
    rows,
    create: async (d) => { const r = wrap({ _id: new Types.ObjectId(), ...defaults, ...d }); rows.push(r); return r; },
    findOne: (f) => query(() => rows.find((r) => match(r, f)) || null),
    findById: (id) => query(() => rows.find((r) => String(r._id) === String(id)) || null),
    find: (f = {}) => query(() => rows.filter((r) => match(r, f))),
    exists: async (f) => (rows.some((r) => match(r, f)) ? { _id: 1 } : null),
    countDocuments: async (f = {}) => rows.filter((r) => match(r, f)).length,
    findByIdAndUpdate: (id, u) => query(() => {
      const r = rows.find((x) => String(x._id) === String(id));
      if (r) Object.assign(r, u);
      return r || null;
    }),
    findOneAndDelete: (f) => query(() => {
      const i = rows.findIndex((r) => match(r, f));
      return i < 0 ? null : rows.splice(i, 1)[0];
    }),
  };
}
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../src/config/redis', { set: async () => 'OK', del: async () => 1 });
const esCalls = [];
let esDown = false;
const esOp = (name) => async (args) => {
  if (esDown) throw new Error('connect ECONNREFUSED');
  esCalls.push([name, args.id]);
};
stub('../src/config/elastic', { index: esOp('index'), delete: esOp('delete') });
const Vendor = fakeModel({ status: 'pending' }); // mirrors schema defaults
const Product = fakeModel({ isActive: true, stock: 0, ratingAvg: 0, ratingCount: 0, images: [] });
stub('../src/models/Vendor', Vendor);
stub('../src/models/Product', Product);

const app = require('../src/app');
const { UPLOAD_DIR } = require('../src/services/storage');

let server;
let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const ids = { customer: new Types.ObjectId(), vA: new Types.ObjectId(), vB: new Types.ObjectId(), admin: new Types.ObjectId() };
const token = (role, id) => jwt.sign({ role }, process.env.JWT_ACCESS_SECRET, { subject: String(id), expiresIn: '5m' });
const T = {
  customer: token('customer', ids.customer),
  vA: token('vendor', ids.vA),
  vB: token('vendor', ids.vB),
  admin: token('admin', ids.admin),
};

async function call(method, url, { tok, json, form } = {}) {
  const headers = {};
  if (tok) headers.authorization = `Bearer ${tok}`;
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : form });
  return { status: res.status, body: await res.json().catch(() => ({})), res };
}

const goodProduct = { name: 'Mug', category: 'home', price: 199.5, stock: 10, description: 'A mug' };
const created = [];

test('vendor onboarding rules', async () => {
  assert.strictEqual((await call('POST', '/api/vendors/onboard', { tok: T.customer, json: { shopName: 'X Shop' } })).status, 403);
  assert.strictEqual((await call('POST', '/api/vendors/onboard', { tok: T.vA, json: { shopName: 'X' } })).status, 400);

  const ok = await call('POST', '/api/vendors/onboard', { tok: T.vA, json: { shopName: 'Alpha Shop' } });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.vendor.status, 'pending');

  assert.strictEqual((await call('POST', '/api/vendors/onboard', { tok: T.vA, json: { shopName: 'Again' } })).status, 409);
  assert.strictEqual((await call('GET', '/api/vendors/me', { tok: T.vA })).body.vendor.shopName, 'Alpha Shop');
  assert.strictEqual((await call('GET', '/api/vendors/me', { tok: T.vB })).body.vendor, null);
});

test('pending vendor cannot manage products', async () => {
  const r = await call('POST', '/api/products', { tok: T.vA, json: goodProduct });
  assert.strictEqual(r.status, 403);
  assert.match(r.body.error, /pending/);
  assert.strictEqual((await call('POST', '/api/products', { tok: T.vB, json: goodProduct })).status, 403); // not onboarded
});

test('admin approval flow', async () => {
  assert.strictEqual((await call('GET', '/api/admin/vendors', { tok: T.vA })).status, 403);
  const list = await call('GET', '/api/admin/vendors?status=pending', { tok: T.admin });
  assert.strictEqual(list.body.vendors.length, 1);
  const id = list.body.vendors[0]._id;

  assert.strictEqual((await call('PATCH', '/api/admin/vendors/nope/status', { tok: T.admin, json: { status: 'approved' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/admin/vendors/${id}/status`, { tok: T.admin, json: { status: 'weird' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/admin/vendors/${id}/status`, { tok: T.admin, json: { status: 'approved' } })).body.vendor.status, 'approved');

  // second vendor: onboard + approve so we can test cross-vendor isolation
  await call('POST', '/api/vendors/onboard', { tok: T.vB, json: { shopName: 'Beta Shop' } });
  const bId = (await call('GET', '/api/admin/vendors?status=pending', { tok: T.admin })).body.vendors[0]._id;
  await call('PATCH', `/api/admin/vendors/${bId}/status`, { tok: T.admin, json: { status: 'approved' } });
});

test('product CRUD with validation and ownership', async () => {
  assert.strictEqual((await call('POST', '/api/products', { tok: T.vA, json: { ...goodProduct, price: -5 } })).status, 400);
  assert.strictEqual((await call('POST', '/api/products', { tok: T.vA, json: { ...goodProduct, name: '' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/products', { tok: T.vA, json: { ...goodProduct, images: ['not a url'] } })).status, 400);
  assert.strictEqual((await call('POST', '/api/products', { tok: T.customer, json: goodProduct })).status, 403);

  const c = await call('POST', '/api/products', {
    tok: T.vA,
    json: { ...goodProduct, images: ['http://localhost:5000/uploads/a.png', 'https://cdn.dummyjson.com/x/1.webp'] },
  });
  assert.strictEqual(c.status, 201);
  assert.strictEqual(c.body.product.price, 199.5);
  const pid = c.body.product._id;

  assert.strictEqual((await call('GET', '/api/products')).body.total, 1); // public
  assert.strictEqual((await call('GET', `/api/products/${pid}`)).status, 200);
  assert.strictEqual((await call('GET', '/api/products/xyz')).status, 400);
  assert.strictEqual((await call('GET', `/api/products/${new Types.ObjectId()}`)).status, 404);
  assert.strictEqual((await call('GET', '/api/products/mine', { tok: T.vA })).body.items.length, 1);
  assert.strictEqual((await call('GET', '/api/products/mine', { tok: T.vB })).body.items.length, 0);

  const up = await call('PUT', `/api/products/${pid}`, { tok: T.vA, json: { price: 250, name: 'Big Mug' } });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.body.product.name, 'Big Mug');
  assert.strictEqual(up.body.product.vendor !== undefined, true);

  // vendor B must not touch vendor A's product
  assert.strictEqual((await call('PUT', `/api/products/${pid}`, { tok: T.vB, json: { price: 1 } })).status, 404);
  assert.strictEqual((await call('DELETE', `/api/products/${pid}`, { tok: T.vB })).status, 404);
  assert.strictEqual((await call('DELETE', `/api/products/${pid}`, { tok: T.customer })).status, 403);

  // admin can delete anything
  assert.strictEqual((await call('DELETE', `/api/products/${pid}`, { tok: T.admin })).status, 200);
  assert.strictEqual((await call('GET', '/api/products')).body.total, 0);

  // vendor deletes own
  const again = await call('POST', '/api/products', { tok: T.vA, json: goodProduct });
  assert.strictEqual((await call('DELETE', `/api/products/${again.body.product._id}`, { tok: T.vA })).status, 200);

  // every write was mirrored into the search index (create, update, 2 deletes, create)
  assert.strictEqual(esCalls.filter((c) => c[0] === 'index').length, 3);
  assert.strictEqual(esCalls.filter((c) => c[0] === 'delete').length, 2);
  assert.strictEqual(esCalls.find((c) => c[0] === 'index')[1], pid);
});

test('product writes still succeed when Elasticsearch is down', async () => {
  esDown = true;
  const c = await call('POST', '/api/products', { tok: T.vA, json: goodProduct });
  assert.strictEqual(c.status, 201);
  assert.strictEqual((await call('DELETE', `/api/products/${c.body.product._id}`, { tok: T.vA })).status, 200);
  esDown = false;
});

test('image upload: stores file, serves it, rejects bad types', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'a.png');
  const ok = await call('POST', '/api/products/upload', { tok: T.vA, form });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.urls.length, 1);

  const urlPath = new URL(ok.body.urls[0]).pathname;
  created.push(path.join(UPLOAD_DIR, path.basename(urlPath)));
  assert.ok(fs.existsSync(created[0]), 'file written to uploads/');

  const served = await fetch(base + urlPath);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  assert.strictEqual(served.headers.get('cross-origin-resource-policy'), 'cross-origin');

  const bad = new FormData();
  bad.append('images', new Blob(['hi'], { type: 'text/plain' }), 'a.txt');
  assert.strictEqual((await call('POST', '/api/products/upload', { tok: T.vA, form: bad })).status, 400);

  assert.strictEqual((await call('POST', '/api/products/upload', { tok: T.customer, form })).status, 403);
  assert.strictEqual((await call('POST', '/api/products/upload', { tok: T.vA, form: new FormData() })).status, 400);
});

test.after(() => {
  for (const f of created) fs.rmSync(f, { force: true });
});
