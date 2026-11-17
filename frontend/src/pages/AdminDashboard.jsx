import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../api';
import AdminAnalytics from '../components/AdminAnalytics';

const FILTERS = ['pending', 'approved', 'rejected', 'all'];

function VendorApprovals() {
  const [filter, setFilter] = useState('pending');
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return api(`/admin/vendors${filter === 'all' ? '' : `?status=${filter}`}`)
      .then((d) => { setVendors(d.vendors); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id, status) => {
    try {
      await api(`/admin/vendors/${id}/status`, { method: 'PATCH', body: { status } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Vendor approvals</h2>
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'tab active' : 'tab'} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!loading && vendors.length === 0 && <p className="muted">No {filter === 'all' ? '' : filter} vendors.</p>}

      <div className="list">
        <AnimatePresence initial={false}>
          {vendors.map((v) => (
            <motion.div
              key={v._id}
              layout
              className="card list-row"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, padding: 0 }}
            >
              <div>
                <strong>{v.shopName}</strong>
                <p className="muted small">{v.user?.name} · {v.user?.email}</p>
                {v.description && <p className="small">{v.description}</p>}
              </div>
              <div className="cta-row small-gap">
                <span className={`chip status ${v.status === 'approved' ? 'ok' : v.status === 'rejected' ? 'bad' : ''}`}>
                  <i className="dot" /> {v.status}
                </span>
                {v.status !== 'approved' && (
                  <button className="btn sm" onClick={() => setStatus(v._id, 'approved')}>Approve</button>
                )}
                {v.status !== 'rejected' && (
                  <button className="btn ghost sm danger" onClick={() => setStatus(v._id, 'rejected')}>Reject</button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [tab, setTab] = useState('analytics'); // analytics | vendors
  return (
    <div>
      <div className="page-head">
        <h1>Admin</h1>
        <div className="tabs" role="tablist">
          {['analytics', 'vendors'].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'analytics' ? <AdminAnalytics /> : <VendorApprovals />}
    </div>
  );
}