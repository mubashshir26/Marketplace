import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api';
import { inr, when } from '../money';

const EMPTY = { code: '', type: 'percent', value: '', minOrder: '', maxDiscount: '', usageLimit: '', expiresAt: '' };

const describe = (c) => {
  const off = c.type === 'percent' ? `${c.value}% off${c.maxDiscount ? ` (max ${inr(c.maxDiscount)})` : ''}` : `${inr(c.value)} off`;
  const parts = [off];
  if (c.minOrder) parts.push(`min ${inr(c.minOrder)}`);
  parts.push(`used ${c.usedCount}${c.usageLimit ? ` / ${c.usageLimit}` : ''}`);
  if (c.expiresAt) parts.push(`expires ${when(c.expiresAt)}`);
  return parts.join(' · ');
};

export default function VendorCoupons() {
  const [coupons, setCoupons] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/coupons/mine').then((d) => setCoupons(d.coupons)).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { code: form.code, type: form.type, value: Number(form.value) };
      if (form.minOrder) body.minOrder = Number(form.minOrder);
      if (form.type === 'percent' && form.maxDiscount) body.maxDiscount = Number(form.maxDiscount);
      if (form.usageLimit) body.usageLimit = Number(form.usageLimit);
      // "valid until" means the end of that day, in the vendor's own time zone
      if (form.expiresAt) body.expiresAt = new Date(`${form.expiresAt}T23:59:59`).toISOString();
      const d = await api('/coupons', { method: 'POST', body });
      setCoupons((list) => [d.coupon, ...list]);
      setForm(EMPTY);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c) => {
    setError('');
    try {
      const d = await api(`/coupons/${c._id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      setCoupons((list) => list.map((x) => (x._id === c._id ? d.coupon : x)));
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete coupon ${c.code}?`)) return;
    try {
      await api(`/coupons/${c._id}`, { method: 'DELETE' });
      setCoupons((list) => list.filter((x) => x._id !== c._id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <form className="card form wide" onSubmit={create}>
        <h2>New coupon</h2>
        <p className="muted small">A coupon discounts only your shop's items in a customer's cart, and you fund the discount.</p>
        <div className="two-col">
          <label>Code
            <input required minLength={3} maxLength={20} placeholder="WELCOME10" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </label>
          <label>Type
            <select value={form.type} onChange={set('type')}>
              <option value="percent">Percent off</option>
              <option value="flat">Flat amount off (₹)</option>
            </select>
          </label>
          <label>{form.type === 'percent' ? 'Percent (1–90)' : 'Amount (₹)'}
            <input required type="number" min="0.01" step="any" value={form.value} onChange={set('value')} />
          </label>
        </div>
        <div className="two-col">
          <label>Minimum order (₹, optional)
            <input type="number" min="0" value={form.minOrder} onChange={set('minOrder')} />
          </label>
          {form.type === 'percent' && (
            <label>Max discount (₹, optional)
              <input type="number" min="1" value={form.maxDiscount} onChange={set('maxDiscount')} />
            </label>
          )}
          <label>Total uses (optional)
            <input type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} />
          </label>
          <label>Valid until (optional)
            <input type="date" value={form.expiresAt} onChange={set('expiresAt')} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>{busy ? 'Creating…' : 'Create coupon'}</motion.button>
      </form>

      {coupons && coupons.length === 0 && <p className="muted">No coupons yet.</p>}
      <div className="list">
        {(coupons || []).map((c) => (
          <div key={c._id} className="card list-row">
            <div>
              <span className="coupon-code">{c.code}</span>{' '}
              <span className={`chip status ${c.isActive ? 'ok' : ''}`}><i className="dot" /> {c.isActive ? 'active' : 'paused'}</span>
              <p className="muted small">{describe(c)}</p>
            </div>
            <div className="cta-row small-gap">
              <button className="btn ghost sm" onClick={() => toggle(c)}>{c.isActive ? 'Pause' : 'Resume'}</button>
              <button className="btn ghost sm danger" onClick={() => remove(c)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}