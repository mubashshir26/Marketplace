import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api';
import { inr } from '../money';

const RANGES = [7, 30, 90];
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const STATUS_ORDER = ['pending_payment', 'placed', 'packed', 'shipped', 'delivered', 'cancelled'];

// Rounds a maximum up to a "nice" number (1, 2, 5 x 10^n) so the grid lines are readable.
function niceMax(v) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function RevenueChart({ daily }) {
  const W = 640;
  const H = 220;
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(...daily.map((d) => d.revenue)));
  const slot = plotW / daily.length;
  const bar = Math.max(2, slot * 0.68);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelAt = new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1]);
  const total = daily.reduce((t, d) => t + d.revenue, 0);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily sales for the last ${daily.length} days, ${inr(total)} in total`}>
      {ticks.map((t) => {
        const y = pad.t + plotH * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="chart-grid" />
            <text x={pad.l - 8} y={y + 4} textAnchor="end" className="chart-tick">{t === 0 ? '0' : `₹${compact.format(max * t)}`}</text>
          </g>
        );
      })}
      {daily.map((d, i) => {
        const h = (d.revenue / max) * plotH;
        const x = pad.l + i * slot + (slot - bar) / 2;
        return (
          <g key={d.date}>
            <rect x={x} y={pad.t + plotH - h} width={bar} height={Math.max(h, d.revenue > 0 ? 1 : 0)} rx="2" className="chart-bar">
              <title>{`${shortDate(d.date)}: ${inr(d.revenue)} from ${d.orders} order${d.orders === 1 ? '' : 's'}`}</title>
            </rect>
            {labelAt.has(i) && (
              <text x={x + bar / 2} y={H - 8} textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'} className="chart-tick">
                {shortDate(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Kpi({ label, value, note, tone, index }) {
  return (
    <motion.div className={`card kpi ${tone || ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <p className="muted small">{label}</p>
      <strong>{value}</strong>
      {note && <p className="muted small">{note}</p>}
    </motion.div>
  );
}

// A ranked list where each row has a bar sized against the top value.
function Ranked({ rows, empty }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  const top = Math.max(...rows.map((r) => r.value)) || 1;
  return (
    <ol className="ranked">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="ranked-head">
            <span className="ranked-name">{r.name}</span>
            <strong>{inr(r.value)}</strong>
          </div>
          <div className="ranked-track"><span style={{ width: `${Math.max(3, (r.value / top) * 100)}%` }} /></div>
          <p className="muted small">{r.note}</p>
        </li>
      ))}
    </ol>
  );
}

export default function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    setError('');
    api(`/admin/analytics?days=${days}`)
      .then((d) => { if (!stale) setData(d); })
      .catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [days]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="center muted">Loading…</p>;

  const { totals: t, payouts, daily, topVendors, topProducts, statusCounts } = data;
  const statuses = STATUS_ORDER.filter((s) => statusCounts[s]);
  const statusTotal = statuses.reduce((sum, s) => sum + statusCounts[s], 0);

  return (
    <div>
      <div className="tabs filter-tabs" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r} role="tab" aria-selected={days === r} className={days === r ? 'tab active' : 'tab'} onClick={() => setDays(r)}>
            {r} days
          </button>
        ))}
      </div>

      <div className="kpi-grid">
        <Kpi index={0} label="Sales" value={inr(t.gmv)} note={`${t.orders} order${t.orders === 1 ? '' : 's'} · ${t.units} item${t.units === 1 ? '' : 's'}`} />
        <Kpi index={1} label="Platform commission" value={inr(t.commission)} note={t.gmv ? `${((t.commission / t.gmv) * 100).toFixed(1)}% of sales` : 'No sales yet'} />
        <Kpi index={2} label="Average order" value={inr(t.avgOrderValue)} note={t.discounts ? `${inr(t.discounts)} given as coupons` : 'No coupons used'} />
        <Kpi index={3} label="Owed to vendors" value={inr(payouts.due)} note="Paid by customers, not yet transferred" />
        {payouts.refundsDue > 0 && (
          <Kpi index={4} tone="warn" label="Refunds to check" value={payouts.refundsDue} note="A refund failed. Refund them from the Razorpay dashboard." />
        )}
      </div>

      <section className="card chart-card">
        <h3>Sales per day</h3>
        {t.orders === 0 ? <p className="muted">No sales in the last {days} days yet.</p> : <div className="chart-scroll"><RevenueChart daily={daily} /></div>}
      </section>

      <div className="analytics-cols">
        <section className="card">
          <h3>Top shops</h3>
          <Ranked
            empty="No sales yet."
            rows={topVendors.map((v) => ({
              key: v.vendorId,
              name: v.shopName,
              value: v.revenue,
              note: `${v.orders} order${v.orders === 1 ? '' : 's'} · commission ${inr(v.commission)}${v.payoutDue ? ` · owed ${inr(v.payoutDue)}` : ''}`,
            }))}
          />
        </section>
        <section className="card">
          <h3>Top products</h3>
          <Ranked
            empty="No sales yet."
            rows={topProducts.map((p) => ({ key: p.productId, name: p.name, value: p.revenue, note: `${p.units} sold` }))}
          />
        </section>
      </div>

      <section className="card">
        <h3>Orders by status</h3>
        {statusTotal === 0 ? (
          <p className="muted">No orders in this period.</p>
        ) : (
          <>
            <div className="status-bar" role="img" aria-label={statuses.map((s) => `${statusCounts[s]} ${s.replace('_', ' ')}`).join(', ')}>
              {statuses.map((s) => <span key={s} className={`seg seg-${s}`} style={{ flexGrow: statusCounts[s] }} />)}
            </div>
            <ul className="status-legend">
              {statuses.map((s) => (
                <li key={s}><i className={`swatch seg-${s}`} /> {s.replace('_', ' ')} <strong>{statusCounts[s]}</strong></li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="muted small">
        Platform totals: {t.vendors} approved shop{t.vendors === 1 ? '' : 's'} · {t.products} active products · {t.customers} customers.
        Commission is counted once an order is paid (online) or delivered (cash on delivery).
      </p>
    </div>
  );
}