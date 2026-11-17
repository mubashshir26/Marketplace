const express = require('express');
const mongoose = require('mongoose');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');
const { buildAnalytics } = require('../services/analytics');

const router = express.Router();
const STATUSES = ['pending', 'approved', 'rejected'];

router.use(authenticate, authorize('admin'));

router.get('/ping', (req, res) => res.json({ ok: true }));

router.get('/vendors', async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const vendors = await Vendor.find(status ? { status } : {})
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json({ vendors });
  } catch (err) {
    next(err);
  }
});

router.patch('/vendors/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid vendor id' });

    const vendor = await Vendor.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate(
      'user',
      'name email'
    );
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ vendor });
  } catch (err) {
    next(err);
  }
});
// Sales dashboard numbers for the last 7, 30 or 90 days.
router.get('/analytics', async (req, res, next) => {
  try {
    const days = Number(req.query.days || 30);
    if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'days must be 7, 30 or 90' });
    res.json(await buildAnalytics(days));
  } catch (err) {
    next(err);
  }
});

module.exports = router;