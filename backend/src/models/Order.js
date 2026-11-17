const crypto = require('crypto');
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const itemSchema = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true },
    name: String, // snapshot, so old orders keep their data if a product is edited or deleted
    image: String,
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// One order per vendor: a checkout with items from 3 shops creates 3 orders sharing a groupId.
// Each vendor packs and ships only their own order, and gets paid for it separately (step 6).
const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      default: () => `ORD-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    },
    groupId: { type: String, required: true, index: true },
    customer: { type: ObjectId, ref: 'User', required: true, index: true },
    vendor: { type: ObjectId, ref: 'Vendor', required: true, index: true },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
       coupon: { code: String, discount: Number }, // snapshot of the coupon used, if any
    total: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'placed', 'packed', 'shipped', 'delivered', 'cancelled'],
      default: 'placed',
      index: true,
    },
    statusHistory: [{ _id: false, status: String, at: { type: Date, default: Date.now } }],
      payment: {
      method: { type: String, enum: ['cod', 'online'], default: 'cod' },
      // refund_due: money was taken but the order can't go ahead (expired/cancelled) and the automatic refund failed.
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'refund_due'], default: 'pending' },
      razorpayOrderId: { type: String, index: true },
      razorpayPaymentId: String,
      paidAt: Date,
      // Split: the platform keeps `commission`, the vendor earns `vendorAmount` (total - commission).
      commission: { type: Number, default: 0 },
      vendorAmount: { type: Number, default: 0 },
      // none: not paid yet | skipped: vendor has no linked account (ledger only) | processed | failed
      transferStatus: { type: String, enum: ['none', 'skipped', 'processed', 'failed'], default: 'none' },
      transferId: String,
      transferError: String,
    },
    shippingAddress: {
      name: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);