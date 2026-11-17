import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, downloadFile } from '../api';
import { inr, when } from '../money';
import OrderTracker from '../components/OrderTracker';

export default function Orders() {
  const location = useLocation();
  const placed = location.state?.placed;
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/orders').then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  }, []);

  const cancel = async (order) => {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    setError('');
    try {
      const d = await api(`/orders/${order._id}/cancel`, { method: 'POST' });
      setOrders((list) => list.map((o) => (o._id === order._id ? { ...o, ...d.order, vendor: o.vendor } : o)));
    } catch (e) {
      setError(e.message);
    }
  };
  const invoice = async (order) => {
    setError('');
    try {
      await downloadFile(`/orders/${order._id}/invoice`, `invoice-${order.orderNumber}.pdf`);
    } catch (e) {
      setError(e.message);
    }
  };

  // One checkout can create several orders (one per shop): show them together.
  const groups = [];
  (orders || []).forEach((o) => {
    let g = groups.find((x) => x.id === o.groupId);
    if (!g) groups.push((g = { id: o.groupId, createdAt: o.createdAt, orders: [] }));
    g.orders.push(o);
  });

  return (
    <div>
      <h1 className="page-title">Your orders</h1>
      {placed && (
        <motion.div className="card banner ok" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          ✓ Order placed. The shops will pack and ship it, and you can follow it here.
        </motion.div>
      )}
      {error && <p className="error">{error}</p>}
      {orders && orders.length === 0 && (
        <div className="card empty">
          <p className="muted">You haven't ordered anything yet.</p>
          <Link to="/search" className="btn">Browse products</Link>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.id} className={g.id === placed ? 'order-group highlight' : 'order-group'}>
          <p className="muted small group-head">
            Placed {when(g.createdAt)} · {g.orders.length > 1 ? `${g.orders.length} shipments` : '1 shipment'}
          </p>
          {g.orders.map((o) => (
            <article key={o._id} className="card order-card">
              <div className="order-top">
                <div>
                  <strong>{o.vendor?.shopName || 'Shop'}</strong>
                  <p className="muted small">{o.orderNumber}</p>
                </div>
                <OrderTracker status={o.status} />
              </div>
              <ul className="order-items">
                {o.items.map((i) => (
                  <li key={i.product}>
                    {i.image ? <img src={i.image} alt="" /> : <span className="img-ph" />}
                    <span>
                      {i.name} <small className="muted">× {i.qty}</small>
                      {o.status === 'delivered' && <> · <Link to={`/product/${i.product}`}>Rate this</Link></>}
                    </span>
                    <span>{inr(i.price * i.qty)}</span>
                  </li>
                ))}
              </ul>
               {o.coupon?.code && (
                <p className="small muted">Coupon <strong>{o.coupon.code}</strong> saved you {inr(o.discount)}</p>
              )}
              <div className="order-foot">
                <span className="small muted">
                  {o.payment?.method === 'cod' ? 'Cash on delivery' : 'Online payment'} · {o.payment?.status?.replace('_', ' ')}
                </span>
                <strong>{inr(o.total)}</strong>
                {!['pending_payment', 'cancelled'].includes(o.status) && (
                  <button className="btn ghost sm" onClick={() => invoice(o)}>Invoice (PDF)</button>
                )}
                {o.status === 'placed' && (
                  <button className="btn ghost sm danger" onClick={() => cancel(o)}>Cancel order</button>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}