const Vendor = require('../models/Vendor');

// Use after authenticate + authorize('vendor'). Attaches the vendor document to req.vendor.
module.exports = async function requireApprovedVendor(req, res, next) {
  try {
    const vendor = await Vendor.findOne({ user: req.user.id });
    if (!vendor) return res.status(403).json({ error: 'Complete vendor onboarding first' });
    if (vendor.status !== 'approved') {
      return res.status(403).json({ error: `Your shop is ${vendor.status}. An admin must approve it first.` });
    }
    req.vendor = vendor;
    next();
  } catch (err) {
    next(err);
  }
};