const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Coupon = require('../models/Coupon');
const { authenticate, authorize } = require('../middleware/auth');
const requireApprovedVendor = require('../middleware/requireApprovedVendor');
const { loadLines } = require('../services/cart');
const { checkCoupon } = require('../services/coupons');
const HttpError = require('../services/httpError');

const router = express.Router();
router.use(authenticate);

const money = (n) => Math.round(n * 100) / 100;

function validate(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return true;
  res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
  return false;
}

// Customer: "what would this code take off my cart?" (checkout re-checks it for real).
router.post('/preview', authorize('customer'), [body('code').isString().trim().notEmpty().isLength({ max: 30 })], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const lines = await loadLines(req.user.id);
    if (!lines.length) throw new HttpError(400, 'Your cart is empty');
    const applied = await checkCoupon({ code: req.body.code, customerId: req.user.id, lines });
    const cartSubtotal = money(lines.reduce((sum, l) => sum + l.product.price * l.qty, 0));
    res.json({
      code: applied.code,
      shopName: applied.shopName,
      discount: applied.discount,
      subtotal: cartSubtotal,
      total: money(cartSubtotal - applied.discount),
    });
  } catch (err) {
    next(err);
  }
});

// Vendor: my coupons.
router.get('/mine', authorize('vendor'), requireApprovedVendor, async (req, res, next) => {
  try {
    res.json({ coupons: await Coupon.find({ vendor: req.vendor._id }).sort({ createdAt: -1 }) });
  } catch (err) {
    next(err);
  }
});

const createRules = [
  body('code')
    .customSanitizer((v) => String(v || '').trim().toUpperCase())
    .matches(/^[A-Z0-9]{3,20}$/)
    .withMessage('Code must be 3-20 letters or digits'),
  body('type').isIn(['percent', 'flat']).withMessage('Type must be percent or flat'),
  body('value').isFloat({ gt: 0 }).withMessage('Value must be more than 0').toFloat(),
  body('value')
    .custom((v, { req }) => req.body.type !== 'percent' || v <= 90)
    .withMessage('A percent discount can be at most 90'),
  body('minOrder').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Minimum order must be 0 or more').toFloat(),
  body('maxDiscount').optional({ values: 'falsy' }).isFloat({ gt: 0 }).withMessage('Max discount must be more than 0').toFloat(),
  body('usageLimit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Usage limit must be a whole number').toInt(),
  body('expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Invalid expiry date')
    .toDate()
    .custom((d) => d.getTime() > Date.now())
    .withMessage('Expiry must be in the future'),
];

router.post('/', authorize('vendor'), requireApprovedVendor, createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { code, type, value, minOrder, maxDiscount, usageLimit, expiresAt } = req.body;
    const coupon = await Coupon.create({
      vendor: req.vendor._id,
      code,
      type,
      value,
      minOrder: minOrder || 0,
      maxDiscount: type === 'percent' ? maxDiscount || null : null,
      usageLimit: usageLimit || null,
      expiresAt: expiresAt || null,
    });
    res.status(201).json({ coupon });
  } catch (err) {
    if (err.code === 11000) return next(new HttpError(409, 'That code is already taken'));
    return next(err);
  }
});

// Pause or resume a coupon.
router.patch('/:id', authorize('vendor'), requireApprovedVendor, [body('isActive').isBoolean().toBoolean()], async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid coupon id');
    if (!validate(req, res)) return;
    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, vendor: req.vendor._id },
      { $set: { isActive: req.body.isActive } },
      { new: true }
    );
    if (!coupon) throw new HttpError(404, 'Coupon not found');
    res.json({ coupon });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize('vendor'), requireApprovedVendor, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid coupon id');
    const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, vendor: req.vendor._id });
    if (!deleted) throw new HttpError(404, 'Coupon not found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;