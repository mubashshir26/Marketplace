const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');

const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');
const requireApprovedVendor = require('../middleware/requireApprovedVendor');
const { saveImage } = require('../services/storage');
const { indexProduct, removeProduct, syncSearch } = require('../services/search');

const router = express.Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only JPG, PNG or WebP images are allowed');
    err.status = 400;
    cb(err);
  },
});

const SORTS = {
  newest: { createdAt: -1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  rating: { ratingAvg: -1 },
};

// partial=true makes every field optional (used for updates).
const productRules = (partial) => {
  const v = (chain) => (partial ? chain.optional() : chain);
  return [
    v(body('name').trim().notEmpty().withMessage('Name is required')),
    v(body('category').trim().notEmpty().withMessage('Category is required')),
    v(body('price').isFloat({ min: 0 }).withMessage('Price must be 0 or more').toFloat()),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a whole number').toInt(),
    body('description').optional().isString().isLength({ max: 5000 }),
    body('images').optional().isArray({ max: 8 }),
    body('images.*').optional().isURL({ require_tld: false }).withMessage('Invalid image URL'),
    body('isActive').optional().isBoolean().toBoolean(),
  ];
};

const EDITABLE = ['name', 'description', 'category', 'price', 'stock', 'images', 'isActive'];
const pick = (obj) => Object.fromEntries(EDITABLE.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function validate(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return true;
  res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
  return false;
}

function checkId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(400).json({ error: 'Invalid product id' });
  return false;
}

// Public list. Step 4 replaces search with Elasticsearch; this stays as a simple fallback.
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const filter = { isActive: true };
    if (req.query.category) filter.category = String(req.query.category);

    const [items, total] = await Promise.all([
      Product.find(filter)
        .populate('vendor', 'shopName')
        .sort(SORTS[req.query.sort] || SORTS.newest)
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

// Vendor's own products (must be declared before /:id).
router.get('/mine', authenticate, authorize('vendor'), requireApprovedVendor, async (req, res, next) => {
  try {
    const items = await Product.find({ vendor: req.vendor._id }).sort({ createdAt: -1 });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Upload up to 5 images; returns their public URLs (local /uploads or S3).
router.post(
  '/upload',
  authenticate,
  authorize('vendor'),
  requireApprovedVendor,
  upload.array('images', 5),
  async (req, res, next) => {
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'No images received' });
      const urls = await Promise.all(req.files.map(saveImage));
      res.status(201).json({ urls });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id', async (req, res, next) => {
  try {
    if (!checkId(req, res)) return;
    const product = await Product.findById(req.params.id).populate('vendor', 'shopName');
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  authenticate,
  authorize('vendor'),
  requireApprovedVendor,
  productRules(false),
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const product = await Product.create({ ...pick(req.body), vendor: req.vendor._id });
      await syncSearch(() => indexProduct(product, req.vendor.shopName));
      res.status(201).json({ product });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  authenticate,
  authorize('vendor'),
  requireApprovedVendor,
  productRules(true),
  async (req, res, next) => {
    try {
      if (!checkId(req, res) || !validate(req, res)) return;
      // Scoping by vendor means one vendor can never edit another's product.
      const product = await Product.findOne({ _id: req.params.id, vendor: req.vendor._id });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      product.set(pick(req.body));
      await product.save();
      await syncSearch(() => indexProduct(product, req.vendor.shopName));
      res.json({ product });
    } catch (err) {
      next(err);
    }
  }
);

// Vendors delete their own products; admins can delete any.
router.delete('/:id', authenticate, authorize('vendor', 'admin'), async (req, res, next) => {
  try {
    if (!checkId(req, res)) return;
    const filter = { _id: req.params.id };
    if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) return res.status(403).json({ error: 'Complete vendor onboarding first' });
      filter.vendor = vendor._id;
    }
    const deleted = await Product.findOneAndDelete(filter);
    if (!deleted) return res.status(404).json({ error: 'Product not found' });
    await syncSearch(() => removeProduct(deleted._id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;