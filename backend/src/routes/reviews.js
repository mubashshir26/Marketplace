const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Product = require('../models/Product');
const Review = require('../models/Review');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');
const { canReview, displayName, refreshRating } = require('../services/reviews');
const HttpError = require('../services/httpError');

// Mounted at /api/products/:productId/reviews
const router = express.Router({ mergeParams: true });

router.use((req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ error: 'Invalid product id' });
  return next();
});

const publicView = (r) => ({
  _id: r._id,
  customerName: r.customerName,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.createdAt,
});

// Anyone can read reviews.
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = { product: req.params.productId };
    const [items, total] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Review.countDocuments(filter),
    ]);
    res.json({ items: items.map(publicView), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

// Can I review this, and have I already?
router.get('/mine', authenticate, authorize('customer'), async (req, res, next) => {
  try {
    const [allowed, review] = await Promise.all([
      canReview(req.user.id, req.params.productId),
      Review.findOne({ product: req.params.productId, customer: req.user.id }),
    ]);
    res.json({ canReview: allowed, review: review ? publicView(review) : null });
  } catch (err) {
    next(err);
  }
});

// Create or update my review (one per product).
router.put(
  '/',
  authenticate,
  authorize('customer'),
  [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1 to 5').toInt(),
    body('comment').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }).withMessage('Comment is too long (max 1000)'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
      }
      const { productId } = req.params;
      if (!(await Product.findById(productId))) throw new HttpError(404, 'Product not found');
      if (!(await canReview(req.user.id, productId))) {
        throw new HttpError(403, 'You can review a product once it has been delivered to you');
      }

      const user = await User.findById(req.user.id).select('name');
      const fields = { rating: req.body.rating, comment: req.body.comment || '', customerName: displayName(user?.name) };

      let review = await Review.findOne({ product: productId, customer: req.user.id });
      let created = false;
      if (review) {
        review.set(fields);
        await review.save();
      } else {
        try {
          review = await Review.create({ product: productId, customer: req.user.id, ...fields });
          created = true;
        } catch (err) {
          if (err.code === 11000) throw new HttpError(409, 'You have already reviewed this product');
          throw err;
        }
      }
      const product = await refreshRating(productId);
      res.status(created ? 201 : 200).json({ review: publicView(review), product });
    } catch (err) {
      next(err);
    }
  }
);

// A customer deletes their own review; an admin can remove any (moderation).
router.delete('/:reviewId', authenticate, authorize('customer', 'admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.reviewId)) throw new HttpError(400, 'Invalid review id');
    const filter = { _id: req.params.reviewId, product: req.params.productId };
    if (req.user.role === 'customer') filter.customer = req.user.id;
    const deleted = await Review.findOneAndDelete(filter);
    if (!deleted) throw new HttpError(404, 'Review not found');
    res.json({ ok: true, product: await refreshRating(req.params.productId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;