const { markGroupPaid, verifyWebhookSignature } = require('../services/payments');

// Razorpay -> our server. It is the safety net for customers who pay but close the tab before
// the browser's verify call. Mounted in app.js with express.raw, because the signature is
// computed over the exact raw bytes of the body.
async function webhook(req, res) {
  const signature = req.get('x-razorpay-signature');
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        await markGroupPaid({ razorpayOrderId: payment.order_id, paymentId: payment.id });
      }
    }
    return res.json({ received: true });
  } catch (err) {
    // Unknown order: acknowledge so Razorpay stops retrying. Anything else: let it retry.
    if (err.status === 404) return res.json({ received: true, ignored: true });
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Webhook failed' });
  }
}

module.exports = { webhook };