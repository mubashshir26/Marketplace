import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCart } from '../cartcontext';
import { inr } from '../money';

export default function Cart() {
  const { cart, refresh, setQty, remove } = useCart();
  const [error, setError] = useState('');

  // Reload on open so stock and prices are current.
  useEffect(() => { refresh(); }, [refresh]);

  const act = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  const blocked = cart.items.some((i) => !i.available);

  if (cart.items.length === 0) {
    return (
      <div className="card empty">
        <h1>Your cart is empty</h1>
        <p className="muted">Find something you like and add it here.</p>
        <Link to="/search" className="btn">Browse products</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Your cart</h1>
      {error && <p className="error">{error}</p>}
      <div className="cart-layout">
        <div className="list">
          {cart.items.map((i, idx) => (
            <motion.div
              key={i.product._id}
              className="card cart-row"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              {i.product.image ? <img src={i.product.image} alt="" /> : <span className="img-ph" />}
              <div className="cart-info">
                <strong>{i.product.name}</strong>
                <p className="muted small">{i.product.vendor.shopName} · {inr(i.product.price)} each</p>
                {!i.available && (
                  <p className="error small">
                    {i.product.stock > 0 ? `Only ${i.product.stock} left. Reduce the quantity.` : 'Out of stock. Remove it to continue.'}
                  </p>
                )}
              </div>
              <div className="stepper">
                <button aria-label="Decrease quantity" onClick={() => act(() => setQty(i.product._id, i.qty - 1))}>−</button>
                <span>{i.qty}</span>
                <button aria-label="Increase quantity" onClick={() => act(() => setQty(i.product._id, i.qty + 1))}>+</button>
              </div>
              <strong className="line-total">{inr(i.lineTotal)}</strong>
              <button className="icon-btn" aria-label="Remove item" onClick={() => act(() => remove(i.product._id))}>×</button>
            </motion.div>
          ))}
        </div>

        <aside className="card summary">
          <h3>Order summary</h3>
          <div className="sum-row"><span>Items ({cart.count})</span><span>{inr(cart.subtotal)}</span></div>
          <div className="sum-row"><span>Shipping</span><span>Free</span></div>
          <div className="sum-row total"><span>Total</span><span>{inr(cart.subtotal)}</span></div>
          {blocked ? (
            <button className="btn" disabled>Fix items to continue</button>
          ) : (
            <Link to="/checkout" className="btn">Checkout</Link>
          )}
          <p className="muted small">Items from different shops are shipped separately.</p>
        </aside>
      </div>
    </div>
  );
}