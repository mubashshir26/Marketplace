const express = require('express');
const { body, validationResult } = require('express-validator');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/ping', authenticate, authorize('vendor', 'admin'), (req, res) => res.json({ ok: true }));

// Current vendor's shop (null until they onboard).
router.get('/me', authenticate, authorize('vendor'), async (req, res, next) => {
  try {
    res.json({ vendor: await Vendor.findOne({ user: req.user.id }) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/onboard',
  authenticate,
  authorize('vendor'),
  [
    body('shopName').trim().isLength({ min: 2, max: 80 }).withMessage('Shop name must be 2-80 characters'),
    body('description').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
      }
      if (await Vendor.exists({ user: req.user.id })) {
        return res.status(409).json({ error: 'You have already submitted a shop' });
      }
      const vendor = await Vendor.create({
        user: req.user.id,
        shopName: req.body.shopName,
        description: req.body.description || '',
      });
      res.status(201).json({ vendor });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;