const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// One review per customer per product. Only customers who received the product can write one.
const reviewSchema = new mongoose.Schema(
  {
    product: { type: ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: ObjectId, ref: 'User', required: true },
    customerName: { type: String, default: 'Customer' }, // shown publicly, e.g. "Asha R."
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

// The unique index also stops a double-click from creating two reviews.
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);