const mongoose = require('mongoose');

// A coupon belongs to one vendor and discounts only that vendor's items, so the vendor funds
// their own discount. The code is unique across the whole marketplace (customers just type it).
const couponSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0.01 }, // percent (1-90) or rupees
    minOrder: { type: Number, default: 0, min: 0 }, // minimum subtotal of this vendor's items
    maxDiscount: { type: Number, default: null }, // cap for percent coupons
    usageLimit: { type: Number, default: null }, // total redemptions allowed (null = unlimited)
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);