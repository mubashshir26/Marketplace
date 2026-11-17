process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');

// Stub Redis so the app loads without a running server.
require.cache[require.resolve('../src/config/redis')] = {
  id: 'redis-stub',
  filename: 'redis-stub',
  loaded: true,
  exports: { set: async () => 'OK', del: async () => 1 },
};
const app = require('../src/app');

function token(role) {
  return jwt.sign({ role }, process.env.JWT_ACCESS_SECRET, { subject: 'u1', expiresIn: '5m' });
}

function request(path, bearer) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
      http
        .get({ port, path, headers }, (res) => {
          res.resume();
          res.on('end', () => {
            server.close();
            resolve(res.statusCode);
          });
        })
        .on('error', reject);
    });
  });
}

test('rejects requests without a token', async () => {
  assert.strictEqual(await request('/api/admin/ping'), 401);
});

test('customer cannot reach admin route', async () => {
  assert.strictEqual(await request('/api/admin/ping', token('customer')), 403);
});

test('admin can reach admin route', async () => {
  assert.strictEqual(await request('/api/admin/ping', token('admin')), 200);
});

test('vendor can reach vendor route, customer cannot', async () => {
  assert.strictEqual(await request('/api/vendors/ping', token('vendor')), 200);
  assert.strictEqual(await request('/api/vendors/ping', token('customer')), 403);
});

test('rejects a tampered token', async () => {
  const bad = jwt.sign({ role: 'admin' }, 'wrong-secret', { subject: 'u1' });
  assert.strictEqual(await request('/api/admin/ping', bad), 401);
});
