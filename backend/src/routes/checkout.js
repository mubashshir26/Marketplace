const express = require('express');
const { body, validationResult } = require('express-validator');
const redis = require('../config/redis');
const { authenticate, authorize } = require('../middleware/auth');
const { loadLines, clearCart } = require('../services/cart');
const Order = require('../models/Order');
const { placeOrders, cancelUnpaidGroup } = require('../services/orders');
const payments = require('../services/payments');
const { checkCoupon } = require('../services/coupons');
const HttpError = require('../services/httpError');

const router = express.Router();

const rules = [
  body('shippingAddress.name').trim().isLength({ min: 2, max: 80 }).withMessage('Name is required'),
  body('shippingAddress.phone').trim().matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
  body('shippingAddress.line1').trim().isLength({ min: 3, max: 120 }).withMessage('Address line 1 is required'),
  body('shippingAddress.line2').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('shippingAddress.city').trim().isLength({ min: 2, max: 60 }).withMessage('City is required'),
  body('shippingAddress.state').trim().isLength({ min: 2, max: 60 }).withMessage('State is required'),
  body('shippingAddress.pincode').trim().matches(/^\d{6}$/).withMessage('Enter a valid 6-digit pincode'),
  body('couponCode').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  body('paymentMethod').optional().isIn(['cod', 'online']).withMessage('Payment method must be cod or online'),
];

router.post('/', authenticate, authorize('customer'), rules, async (req, res, next) => {
  const lockKey = `lock:checkout:${req.user.id}`;
  let locked = false;
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
    }

    // A short Redis lock stops a double click from placing the same cart twice.
    locked = (await redis.set(lockKey, '1', 'EX', 30, 'NX')) === 'OK';
    if (!locked) throw new HttpError(409, 'Your checkout is already in progress');

    const online = req.body.paymentMethod === 'online';
    if (online && !payments.isConfigured()) throw new HttpError(503, 'Online payments are not configured on the server');

    const lines = await loadLines(req.user.id);
    if (!lines.length) throw new HttpError(400, 'Your cart is empty');
    
    // Always re-checked here: the preview the customer saw is not trusted.
    const coupon = req.body.couponCode
      ? await checkCoupon({ code: req.body.couponCode, customerId: req.user.id, lines })
      : null;

    const { name, phone, line1, line2, city, state, pincode } = req.body.shippingAddress;
    const orders = await placeOrders({
      customerId: req.user.id,
      lines,
      shippingAddress: { name, phone, line1, line2, city, state, pincode },
      paymentMethod: online ? 'online' : 'cod',
      coupon,
    });
    const groupId = orders[0].groupId;

    if (online) {
      // Stock is reserved (pending_payment). The cart is cleared only once the payment is verified,
      // so closing the payment window leaves the cart intact.
      try {
        const amount = orders.reduce((sum, o) => sum + o.total, 0);
        const gw = await payments.createGatewayOrder({ amount, receipt: groupId });
        await Order.updateMany({ groupId }, { $set: { 'payment.razorpayOrderId': gw.id } });
        return res.status(201).json({
          groupId,
          orders,
          payment: { keyId: payments.keyId(), orderId: gw.id, amount: gw.amount, currency: gw.currency },
        });
      } catch (err) {
        await cancelUnpaidGroup({ groupId, customerId: req.user.id });
        throw err;
      }
    }

    await clearCart(req.user.id);
    res.status(201).json({ groupId, orders });
  } catch (err) {
    next(err);
  } finally {
    if (locked) await redis.del(lockKey).catch(() => {});
  }
});

// The browser calls this after Razorpay Checkout succeeds. We trust nothing it says until the
// HMAC signature (made with our secret key) matches.
router.post(
  '/verify',
  authenticate,
  authorize('customer'),
  [
    body('razorpay_order_id').isString().notEmpty(),
    body('razorpay_payment_id').isString().notEmpty(),
    body('razorpay_signature').isString().notEmpty(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new HttpError(400, 'Missing payment details');
      const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;

      if (!payments.verifyPaymentSignature({ orderId, paymentId, signature })) {
        throw new HttpError(400, 'Payment verification failed');
      }
      const mine = await Order.find({ 'payment.razorpayOrderId': orderId, customer: req.user.id });
      if (!mine.length) throw new HttpError(404, 'Order not found');

      await payments.markGroupPaid({ razorpayOrderId: orderId, paymentId });
      await clearCart(req.user.id);
      res.json({ groupId: mine[0].groupId });
    } catch (err) {
      next(err);
    }
  }
);

// Customer closed the payment window: release the reserved stock.
router.post('/:groupId/cancel', authenticate, authorize('customer'), async (req, res, next) => {
  try {
    const cancelled = await cancelUnpaidGroup({ groupId: req.params.groupId, customerId: req.user.id });
    res.json({ cancelled });
  } catch (err) {
    next(err);
  }
});

module.exports = router;