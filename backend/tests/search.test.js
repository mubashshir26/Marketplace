process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../src/config/redis', { set: async () => 'OK', del: async () => 1 });

// Fake Elasticsearch client: records the request and returns a canned response.
let lastRequest;
let failWith = null;
stub('../src/config/elastic', {
  search: async (req) => {
    lastRequest = req;
    if (failWith) throw failWith;
    return {
      hits: {
        total: { value: 25 },
        hits: [
          {
            _id: 'abc123',
            _source: { name: 'Red Phone', category: 'phones', price: 999, ratingAvg: 4.5, vendorName: 'Tech Hive', images: ['http://x/1.png'] },
          },
        ],
      },
      aggregations: { categories: { buckets: [{ key: 'phones', doc_count: 7 }, { key: 'beauty', doc_count: 3 }] } },
    };
  },
});

const { parseParams, buildSearchBody } = require('../src/services/search');
const app = require('../src/app');

test('parseParams cleans and bounds input', () => {
  const p = parseParams({ q: '  phone  ', minPrice: '100', maxPrice: 'abc', rating: '9', sort: 'hack', page: '-3', limit: '999' });
  assert.deepStrictEqual(
    { q: p.q, minPrice: p.minPrice, maxPrice: p.maxPrice, rating: p.rating, sort: p.sort, page: p.page, limit: p.limit },
    { q: 'phone', minPrice: 100, maxPrice: undefined, rating: 5, sort: undefined, page: 1, limit: 50 }
  );
  assert.strictEqual(parseParams({ q: 'x'.repeat(500) }).q.length, 100);
});

test('buildSearchBody: text query is fuzzy and sorted by relevance', () => {
  const b = buildSearchBody(parseParams({ q: 'phoen' }));
  const mm = b.query.bool.must[0].multi_match;
  assert.strictEqual(mm.query, 'phoen');
  assert.strictEqual(mm.fuzziness, 'AUTO');
  assert.ok(mm.fields.includes('name^3'));
  assert.deepStrictEqual(b.sort[0], { _score: 'desc' });
  assert.ok(b.query.bool.filter.some((f) => f.term?.isActive === true), 'only active products');
});

test('buildSearchBody: no query lists newest first; filters and paging apply', () => {
  const b = buildSearchBody(parseParams({ category: 'beauty', minPrice: '100', maxPrice: '500', rating: '4', sort: 'price_asc', page: '3', limit: '10' }));
  assert.deepStrictEqual(b.query.bool.must, [{ match_all: {} }]);
  assert.deepStrictEqual(b.post_filter, { term: { category: 'beauty' } });
  assert.deepStrictEqual(b.query.bool.filter.find((f) => f.range?.price).range.price, { gte: 100, lte: 500 });
  assert.deepStrictEqual(b.query.bool.filter.find((f) => f.range?.ratingAvg).range.ratingAvg, { gte: 4 });
  assert.deepStrictEqual(b.sort, [{ price: 'asc' }]);
  assert.strictEqual(b.from, 20);
  assert.strictEqual(b.size, 10);
  assert.deepStrictEqual(buildSearchBody(parseParams({})).sort, [{ createdAt: 'desc' }]);
  // category must NOT be in the main query, otherwise the category counts would collapse to one
  assert.ok(!JSON.stringify(b.query).includes('beauty'));
});

test('GET /api/search maps hits, pages and category counts', async () => {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const base = `http://localhost:${server.address().port}`;
    const res = await fetch(`${base}/api/search?q=phone&limit=12&page=2&sort=rating`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.total, 25);
    assert.strictEqual(body.pages, 3);
    assert.strictEqual(body.page, 2);
    assert.strictEqual(body.items[0]._id, 'abc123');
    assert.strictEqual(body.items[0].vendor.shopName, 'Tech Hive');
    assert.deepStrictEqual(body.categories[0], { name: 'phones', count: 7 });
    assert.strictEqual(lastRequest.from, 12);
    assert.deepStrictEqual(lastRequest.sort, [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }]);

    failWith = Object.assign(new Error('down'), { name: 'ConnectionError' });
    const down = await fetch(`${base}/api/search?q=x`);
    assert.strictEqual(down.status, 503);

    failWith = Object.assign(new Error('missing'), { meta: { body: { error: { type: 'index_not_found_exception' } } } });
    const missing = await fetch(`${base}/api/search`);
    assert.strictEqual(missing.status, 503);
    assert.match((await missing.json()).error, /reindex/);
  } finally {
    server.close();
  }
});
