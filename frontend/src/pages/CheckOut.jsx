import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useCart } from '../cartcontext';
import { inr } from '../money';

// Razorpay's checkout.js is loaded on demand, only when someone pays online.
const loadRazorpay = () =>
  new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const el = document.createElement('script');
    el.src = 'https://checkout.razorpay.com/v1/checkout.js';
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load the payment window. Check your internet connection.'));
    document.body.appendChild(el);
    return undefined;
  });

export default function Checkout() {
  const { user } = useAuth();
  const { cart, refresh } = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: user?.name || '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('online');
  const [code, setCode] = useState('');
  const [coupon, setCoupon] = useState(null); // what the server says this code is worth
  const [couponError, setCouponError] = useState('');
  const [checking, setChecking] = useState(false);

  const applyCoupon = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setCouponError('');
    setChecking(true);
    try {
      setCoupon(await api('/coupons/preview', { method: 'POST', body: { code } }));
    } catch (err) {
      setCoupon(null);
      setCouponError(err.message);
    } finally {
      setChecking(false);
    }
  };
  const removeCoupon = () => { setCoupon(null); setCode(''); setCouponError(''); };
  const payable = coupon ? coupon.total : cart.subtotal;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const finish = async (groupId) => {
    await refresh();
    navigate('/orders', { replace: true, state: { placed: groupId } });
  };

  // Opens the Razorpay window for an order the server has already reserved stock for.
  const pay = (d) => {
    let done = false;
    const rzp = new window.Razorpay({
      key: d.payment.keyId,
      order_id: d.payment.orderId,
      amount: d.payment.amount,
      currency: d.payment.currency,
      name: 'Marketplace',
      description: d.orders.length > 1 ? `${d.orders.length} shipments` : 'Your order',
      prefill: { name: form.name, email: user?.email, contact: form.phone },
      theme: { color: '#6366f1' },
      handler: async (resp) => {
        done = true;
        try {
          // The server checks Razorpay's signature before it believes the payment.
          const v = await api('/checkout/verify', { method: 'POST', body: resp });
          await finish(v.groupId);
        } catch (err) {
          setError(`${err.message}. If money was deducted, the order will be confirmed shortly: check Your orders.`);
          setBusy(false);
        }
      },
      modal: {
        ondismiss: async () => {
          if (done) return;
          await api(`/checkout/${d.groupId}/cancel`, { method: 'POST' }).catch(() => {});
          setError('Payment cancelled. Your cart is still here.');
          refresh();
          setBusy(false);
        },
      },
    });
    rzp.on('payment.failed', (r) => setError(r.error?.description || 'Payment failed. Please try again.'));
    rzp.open();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (method === 'online') await loadRazorpay(); // before reserving stock, so a load failure costs nothing
      const d = await api('/checkout', { method: 'POST', body: { shippingAddress: form, paymentMethod: method, couponCode: coupon?.code } });
      if (method === 'online') {
        pay(d);
        return; // stays busy until the payment window reports back
      }
      await finish(d.groupId);
    } catch (err) {
      setError(err.message);
      refresh(); // stock may have changed
      setBusy(false);
    }
  };

  if (cart.items.length === 0 && !busy) {
    return (
      <div className="card empty">
        <h1>Nothing to check out</h1>
        <p className="muted">Your cart is empty.</p>
        <Link to="/search" className="btn">Browse products</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Checkout</h1>
      <div className="cart-layout">
        <motion.form className="card form wide no-margin" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h2>Delivery address</h2>
          {error && <p className="error">{error}</p>}
          <div className="two-col">
            <label>Full name
              <input required value={form.name} onChange={set('name')} />
            </label>
            <label>Mobile number
              <input required inputMode="numeric" maxLength={10} placeholder="10 digits" value={form.phone} onChange={set('phone')} />
            </label>
          </div>
          <label>Address line 1
            <input required value={form.line1} onChange={set('line1')} placeholder="House no., street" />
          </label>
          <label>Address line 2 (optional)
            <input value={form.line2} onChange={set('line2')} placeholder="Area, landmark" />
          </label>
          <div className="two-col">
            <label>City
              <input required value={form.city} onChange={set('city')} />
            </label>
            <label>State
              <input required value={form.state} onChange={set('state')} />
            </label>
            <label>Pincode
              <input required inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} />
            </label>
          </div>

          <h2>Payment</h2>
          <div className="pay-option">
            <input type="radio" name="pay" id="online" checked={method === 'online'} onChange={() => setMethod('online')} />
            <label htmlFor="online">Pay online <small className="muted">(UPI, card, netbanking via Razorpay, test mode)</small></label>
          </div>
          <div className="pay-option">
            <input type="radio" name="pay" id="cod" checked={method === 'cod'} onChange={() => setMethod('cod')} />
            <label htmlFor="cod">Cash on delivery</label>
          </div>

          <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>
            {busy ? (method === 'online' ? 'Opening payment…' : 'Placing order…') : `${method === 'online' ? 'Pay' : 'Place order'} · ${inr(payable)}`}
          </motion.button>
        </motion.form>

        <aside className="card summary">
          <h3>Your items</h3>
          {cart.items.map((i) => (
            <div key={i.product._id} className="sum-row">
              <span>{i.product.name} <small className="muted">× {i.qty}</small></span>
              <span>{inr(i.lineTotal)}</span>
            </div>
          ))}
          {coupon && <div className="sum-row save"><span>Coupon {coupon.code}</span><span>−{inr(coupon.discount)}</span></div>}
          <div className="sum-row total"><span>Total</span><span>{inr(payable)}</span></div>

          {coupon ? (
            <p className="coupon-ok">
              <span>✓ {coupon.code} applied to {coupon.shopName} items</span>
              <button type="button" className="icon-btn" onClick={removeCoupon} aria-label="Remove coupon">×</button>
            </p>
          ) : (
            <form className="coupon-box" onSubmit={applyCoupon}>
              <input placeholder="Coupon code" value={code} maxLength={30} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button className="btn ghost sm" disabled={checking || !code.trim()}>{checking ? '…' : 'Apply'}</button>
            </form>
          )}
          {couponError && <p className="error small">{couponError}</p>}
        </aside>
      </div>
    </div>
  );
}