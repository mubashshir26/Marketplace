import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import ProductForm from '../components/ProductForm';
import VendorOrders from '../components/VendorOrders';
import VendorCoupons from '../components/VendorCoupons';

export default function VendorDashboard() {
  const [vendor, setVendor] = useState(undefined); // undefined = loading, null = not onboarded
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState('products'); // products | orders | coupons
  const [editing, setEditing] = useState(null); // null = closed, {} = new, product = edit
  const [error, setError] = useState('');

  useEffect(() => {
    api('/vendors/me')
      .then((d) => setVendor(d.vendor))
      .catch((e) => { setError(e.message); setVendor(null); });
  }, []);

  useEffect(() => {
    if (vendor?.status === 'approved') {
      api('/products/mine').then((d) => setProducts(d.items)).catch((e) => setError(e.message));
    }
  }, [vendor]);

  const onSaved = (p) => {
    setProducts((list) => (list.some((x) => x._id === p._id) ? list.map((x) => (x._id === p._id ? p : x)) : [p, ...list]));
    setEditing(null);
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    try {
      await api(`/products/${p._id}`, { method: 'DELETE' });
      setProducts((list) => list.filter((x) => x._id !== p._id));
    } catch (e) {
      setError(e.message);
    }
  };

  if (vendor === undefined) return <p className="center muted">Loading…</p>;
  if (vendor === null) return <Onboard onDone={setVendor} initialError={error} />;

  const approved = vendor.status === 'approved';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{vendor.shopName}</h1>
          <span className={`chip status ${approved ? 'ok' : vendor.status === 'rejected' ? 'bad' : ''}`}>
            <i className="dot" /> {vendor.status}
          </span>
        </div>
        {approved && tab === 'products' && !editing && (
          <button className="btn" onClick={() => setEditing({})}>+ Add product</button>
        )}      
        {approved && tab === 'coupons' && <VendorCoupons />}
      </div>

      {approved && (
        <div className="tabs main-tabs" role="tablist">
         {['products', 'orders', 'coupons'].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {vendor.status === 'pending' && (
        <motion.div className="card banner" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Your shop is waiting for admin approval. You can add products as soon as it is approved.
        </motion.div>
      )}
      {vendor.status === 'rejected' && (
        <div className="card banner bad">Your shop was rejected by an admin. Contact support to appeal.</div>
      )}

      {approved && tab === 'orders' && <VendorOrders />}

      {approved && tab === 'products' && editing && (
        <ProductForm
          initial={editing._id ? editing : null}
          onSaved={onSaved}
          onCancel={() => setEditing(null)}
        />
      )}

      {approved && tab === 'products' && !editing && (
        <>
          {products.length === 0 && <p className="muted">No products yet. Add your first one.</p>}
          <div className="grid products">
            {products.map((p, i) => (
              <ProductCard
                key={p._id}
                product={p}
                index={i}
                actions={
                  <div className="cta-row small-gap">
                    <button className="btn ghost sm" onClick={() => setEditing(p)}>Edit</button>
                    <button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button>
                  </div>
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Onboard({ onDone, initialError }) {
  const [form, setForm] = useState({ shopName: '', description: '' });
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onDone((await api('/vendors/onboard', { method: 'POST', body: form })).vendor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h1>Set up your shop</h1>
      <p className="muted sub">An admin reviews every new shop before it can sell.</p>
      {error && <p className="error">{error}</p>}
      <label>Shop name
        <input required minLength={2} maxLength={80} value={form.shopName}
          onChange={(e) => setForm({ ...form, shopName: e.target.value })} />
      </label>
      <label>About your shop
        <textarea rows={3} maxLength={500} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>
        {busy ? 'Submitting…' : 'Submit for approval'}
      </motion.button>
    </form>
  );
}