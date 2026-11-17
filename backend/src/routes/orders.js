const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const { authenticate, authorize } = require('../middleware/auth');
const requireApprovedVendor = require('../middleware/requireApprovedVendor');
const { changeStatus, TRANSITIONS } = require('../services/orders');
const { buildInvoice } = require('../services/invoice');
const HttpError = require('../services/httpError');

const router = express.Router();
router.use(authenticate);

const idOf = (ref) => String(ref?._id ?? ref);

// Customers see only their own orders, vendors only their shop's, admins everything.
async function canView(user, order) {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return idOf(order.customer) === user.id;
  if (user.role === 'vendor') {
    const vendor = await Vendor.findOne({ user: user.id });
    return !!vendor && idOf(order.vendor) === String(vendor._id);
  }
  return false;
}

async function loadOrder(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid order id');
  const order = await Order.findById(req.params.id);
  // 404 (not 403) so nobody can probe which order ids exist
  if (!order || !(await canView(req.user, order))) throw new HttpError(404, 'Order not found');
  return order;
}

// Customer: my orders, newest first.
router.get('/', authorize('customer'), async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user.id }).populate('vendor', 'shopName').sort({ createdAt: -1 }).limit(200);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// Vendor: orders for my shop (declared before /:id).
// Vendor: orders for my shop (declared before /:id).
router.get('/vendor', authorize('vendor'), requireApprovedVendor, async (req, res, next) => {
  try {
    // Orders still waiting for payment are not the vendor's to see yet.
    const filter = { vendor: req.vendor._id, status: { $ne: 'pending_payment' } };
    const wanted = req.query.status;
    if (wanted && wanted !== 'pending_payment' && Object.keys(TRANSITIONS).includes(wanted)) filter.status = wanted;
    const orders = await Order.find(filter).populate('customer', 'name').sort({ createdAt: -1 }).limit(200);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ order: await loadOrder(req) });
  } catch (err) {
    next(err);
  }
});
// PDF invoice for one order. Same visibility rules as viewing the order.
router.get('/:id/invoice', async (req, res, next) => {
  try {
    const order = await loadOrder(req);
    if (['pending_payment', 'cancelled'].includes(order.status)) {
      throw new HttpError(409, 'There is no invoice for an order that is unpaid or cancelled');
    }
    const vendor = await Vendor.findById(order.vendor);
    const pdf = await buildInvoice({ order, shopName: vendor?.shopName });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${order.orderNumber}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Customer cancels, only before the vendor has packed it.
router.post('/:id/cancel', authorize('customer'), async (req, res, next) => {
  try {
    const order = await loadOrder(req);
    if (!['placed', 'pending_payment'].includes(order.status)) {
      throw new HttpError(409, 'This order has already been packed, so it can no longer be cancelled');
    }
    res.json({ order: await changeStatus(order, 'cancelled') });
  } catch (err) {
    next(err);
  }
});

// Vendor (own orders) or admin moves an order forward: packed -> shipped -> delivered, or cancelled.
router.patch('/:id/status', authorize('vendor', 'admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['packed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
      throw new HttpError(400, 'Status must be packed, shipped, delivered or cancelled');
    }
    const order = await loadOrder(req);
       if (order.status === 'pending_payment') throw new HttpError(409, 'This order is still waiting for payment');
    res.json({ order: await changeStatus(order, status) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;