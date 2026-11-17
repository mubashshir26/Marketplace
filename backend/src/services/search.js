const es = require('../config/elastic');
const Product = require('../models/Product');

const INDEX = process.env.ES_INDEX || 'products';

const MAPPINGS = {
  properties: {
    name: { type: 'text' },
    description: { type: 'text' },
    category: { type: 'keyword', fields: { text: { type: 'text' } } },
    vendorId: { type: 'keyword' },
    vendorName: { type: 'text' },
    price: { type: 'float' },
    stock: { type: 'integer' },
    ratingAvg: { type: 'float' },
    ratingCount: { type: 'integer' },
    isActive: { type: 'boolean' },
    image: { type: 'keyword', index: false },
    images: { type: 'keyword', index: false },
    createdAt: { type: 'date' },
  },
};

const SORTS = {
  newest: [{ createdAt: 'desc' }],
  price_asc: [{ price: 'asc' }],
  price_desc: [{ price: 'desc' }],
  rating: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
  relevance: [{ _score: 'desc' }, { ratingAvg: 'desc' }],
};

// Product (Mongo doc) -> Elasticsearch document.
function toDoc(product, vendorName) {
  return {
    name: product.name,
    description: product.description || '',
    category: product.category,
    vendorId: String(product.vendor?._id ?? product.vendor),
    vendorName: vendorName || product.vendor?.shopName || '',
    price: product.price,
    stock: product.stock,
    ratingAvg: product.ratingAvg || 0,
    ratingCount: product.ratingCount || 0,
    isActive: product.isActive !== false,
    image: product.images?.[0] || null,
    images: product.images || [],
    createdAt: product.createdAt || new Date(),
  };
}

async function ensureIndex() {
  if (!(await es.indices.exists({ index: INDEX }))) {
    await es.indices.create({ index: INDEX, mappings: MAPPINGS });
  }
}

const indexProduct = (product, vendorName) =>
  es.index({ index: INDEX, id: String(product._id), document: toDoc(product, vendorName), refresh: true });

const removeProduct = (id) => es.delete({ index: INDEX, id: String(id), refresh: true }, { ignore: [404] });
// Keeps the stock shown in search results in step with checkouts and cancellations.
const adjustStock = (productId, delta) =>
  es.update(
    {
      index: INDEX,
      id: String(productId),
      script: { source: 'ctx._source.stock += params.delta', params: { delta } },
      refresh: true,
    },
    { ignore: [404] }
  );

// Search must never break product writes: log and carry on if Elasticsearch is down.
async function syncSearch(fn) {
  try {
    await fn();
  } catch (err) {
    console.error('Search index sync failed (run "npm run reindex" later):', err.message);
  }
}

// Rebuild the whole index from MongoDB. Returns the number of products indexed.
async function reindexAll() {
  if (await es.indices.exists({ index: INDEX })) await es.indices.delete({ index: INDEX });
  await es.indices.create({ index: INDEX, mappings: MAPPINGS });

  const products = await Product.find().populate('vendor', 'shopName');
  const CHUNK = 500;
  for (let i = 0; i < products.length; i += CHUNK) {
    const operations = products
      .slice(i, i + CHUNK)
      .flatMap((p) => [{ index: { _index: INDEX, _id: String(p._id) } }, toDoc(p, p.vendor?.shopName)]);
    const res = await es.bulk({ operations, refresh: true });
    if (res.errors) throw new Error('Some products failed to index');
  }
  return products.length;
}

const toNumber = (v) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

// Query string -> clean, bounded search params.
function parseParams(query) {
  const q = String(query.q || '').trim().slice(0, 100);
  const rating = toNumber(query.rating);
  return {
    q,
    category: query.category ? String(query.category) : undefined,
    minPrice: toNumber(query.minPrice),
    maxPrice: toNumber(query.maxPrice),
    rating: rating === undefined ? undefined : Math.min(5, rating),
    sort: SORTS[query.sort] ? query.sort : undefined,
    page: Math.max(1, parseInt(query.page, 10) || 1),
    limit: Math.min(50, Math.max(1, parseInt(query.limit, 10) || 12)),
  };
}

function buildSearchBody({ q, category, minPrice, maxPrice, rating, sort, page = 1, limit = 12 }) {
  const filter = [{ term: { isActive: true } }];
  if (minPrice !== undefined || maxPrice !== undefined) {
    const range = {};
    if (minPrice !== undefined) range.gte = minPrice;
    if (maxPrice !== undefined) range.lte = maxPrice;
    filter.push({ range: { price: range } });
  }
  if (rating) filter.push({ range: { ratingAvg: { gte: rating } } });

  const must = q
    ? [
        {
          multi_match: {
            query: q,
            fields: ['name^3', 'category.text^2', 'vendorName', 'description'],
            fuzziness: 'AUTO', // tolerates small typos
            minimum_should_match: '2<75%',
          },
        },
      ]
    : [{ match_all: {} }];

  const sortKey = sort || (q ? 'relevance' : 'newest');
  return {
    query: { bool: { must, filter } },
    // The category filter is applied after aggregations, so the category counts
    // still show every category that matches the other filters.
    ...(category ? { post_filter: { term: { category } } } : {}),
    aggs: { categories: { terms: { field: 'category', size: 30 } } },
    sort: SORTS[sortKey],
    from: (page - 1) * limit,
    size: limit,
    track_total_hits: true,
  };
}

async function search(params) {
  const res = await es.search({ index: INDEX, ...buildSearchBody(params) });
  const total = res.hits.total.value;
  return {
    items: res.hits.hits.map((h) => ({
      _id: h._id,
      ...h._source,
      images: h._source.images || [],
      vendor: { shopName: h._source.vendorName },
    })),
    total,
    page: params.page,
    pages: Math.max(1, Math.ceil(total / params.limit)),
    categories: res.aggregations.categories.buckets.map((b) => ({ name: b.key, count: b.doc_count })),
  };
}

module.exports = {
  ensureIndex, indexProduct, removeProduct, adjustStock, syncSearch, reindexAll,
  parseParams, buildSearchBody, search,
};