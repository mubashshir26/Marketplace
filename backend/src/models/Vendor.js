const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    shopName: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    razorpayAccountId: { type: String, default: '' },
    commissionPercent: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vendor', vendorSchema);
