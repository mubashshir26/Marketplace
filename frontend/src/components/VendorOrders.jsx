import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api';
import { inr, when } from '../money';
import OrderTracker from './OrderTracker';

const FILTERS = ['all', 'placed', 'packed', 'shipped', 'delivered', 'cancelled'];
const NEXT = {
  placed: ['packed', 'Mark packed'],
  packed: ['shipped', 'Mark shipped'],
  shipped: ['delivered', 'Mark delivered'],
};

export default function VendorOrders() {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/orders/vendor').then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  }, []);

  const move = async (order, status) => {
    if (status === 'cancelled' && !window.confirm(`Cancel order ${order.orderNumber}? The items go back to stock.`)) return;
    setError('');
    try {
      const d = await api(`/orders/${order._id}/status`, { method: 'PATCH', body: { status } });
      setOrders((list) => list.map((o) => (o._id === order._id ? { ...o, ...d.order, customer: o.customer } : o)));
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

  const shown = (orders || []).filter((o) => filter === 'all' || o.status === filter);

  return (
    <div>
      <div className="tabs filter-tabs" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'tab active' : 'tab'} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {orders && shown.length === 0 && <p className="muted">No {filter === 'all' ? '' : filter} orders yet.</p>}

      <div className="list">
        {shown.map((o) => {
          const a = o.shippingAddress || {};
          const next = NEXT[o.status];
          return (
            <article key={o._id} className="card order-card">
              <div className="order-top">
                <div>
                  <strong>{o.orderNumber}</strong>
                  <p className="muted small">{when(o.createdAt)}</p>
                </div>
                <OrderTracker status={o.status} />
              </div>

              <div className="order-body">
                <ul className="order-items">
                  {o.items.map((i) => (
                    <li key={i.product}>
                      {i.image ? <img src={i.image} alt="" /> : <span className="img-ph" />}
                      <span>{i.name} <small className="muted">× {i.qty}</small></span>
                      <span>{inr(i.price * i.qty)}</span>
                    </li>
                  ))}
                </ul>
                <div className="ship-to">
                  <p className="small muted">Ship to</p>
                  <p className="small">
                    {a.name} · {a.phone}<br />
                    {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                    {a.city}, {a.state} {a.pincode}
                  </p>
                </div>
              </div>

              <div className="order-foot">
                <span className="small muted">
                  {o.payment?.method === 'cod' ? 'Cash on delivery' : 'Paid online'} · {o.payment?.status}
                </span>
                <strong>{inr(o.total)}</strong>
                <div className="cta-row small-gap">
                 {o.status !== 'cancelled' && (
                    <button className="btn ghost sm" onClick={() => invoice(o)}>Invoice (PDF)</button>
                  )}
                  {next && <button className="btn sm" onClick={() => move(o, next[0])}>{next[1]}</button>}
                  {['placed', 'packed'].includes(o.status) && (
                    <button className="btn ghost sm danger" onClick={() => move(o, 'cancelled')}>Cancel</button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}