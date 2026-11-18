const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const vendorRoutes = require('./routes/vendors');
const adminRoutes = require('./routes/admin');
const productRoutes = require('./routes/products');
const searchRoutes = require('./routes/search');
const cartRoutes = require('./routes/cart');
const checkoutRoutes = require('./routes/checkout');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const couponRoutes = require('./routes/coupons');
const { webhook } = require('./routes/payments');
const HttpError = require('./services/httpError');
const { UPLOAD_DIR } = require('./services/storage');

const app = express();

// cross-origin: the frontend (another port/domain) must be allowed to display uploaded images.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// CLIENT_ORIGIN can list several frontends separated by commas (live site + localhost).
// A trailing slash is ignored, because browsers never send one in the Origin header.
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(cors({ origin: origins }));
// Webhook needs the raw body for signature checking, so it is registered before express.json.
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), webhook);
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/admin', adminRoutes);
// Reviews are declared before products so /api/products/:id/reviews is not read as /api/products/:id.
app.use('/api/products/:productId/reviews', reviewRoutes);
app.use('/api/products', productRoutes);
// Reviews are declared before products so /api/products/:id/reviews is not read as /api/products/:id.
app.use('/api/coupons', couponRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);

// eslint-disable-next-line no-unused-vars
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // HttpError (any status, including 502/503 from the payment gateway), bad JSON and upload
  // problems carry a message that is safe to show.
  const isHttpError = err instanceof HttpError || err.name === 'HttpError';
  if (err.name === 'MulterError' || isHttpError || (err.status >= 400 && err.status < 500)) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
