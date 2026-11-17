import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { stagger, rise } from '../components/PageTransition';
import ProductCard from '../components/ProductCard';
import AddToCart from '../components/AddToCart';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api(`/products?page=${page}&limit=12`)
      .then((d) => {
        setItems((prev) => (page === 1 ? d.items : [...prev, ...d.items]));
        setPages(d.pages);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.section variants={rise} className="hero">
        <p className="eyebrow">Multi-vendor marketplace</p>
        <h1>
          Find things you love,<br />
          <span className="gradient-text">from people who make them.</span>
        </h1>
        <p className="muted lead">
          {user ? `Welcome back, ${user.name}.` : 'Sign up as a customer to shop, or as a vendor to start selling.'}
        </p>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <input
            placeholder="Search products, categories or shops…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn">Search</button>
        </form>
        {!user && (
          <div className="cta-row">
            <Link to="/register" className="btn">Get started</Link>
            <Link to="/login" className="btn ghost">I have an account</Link>
          </div>
        )}
      </motion.section>

      <h2 className="section-title">Latest products</h2>
      {error && <p className="error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted">No products yet. Run <code>npm run seed</code> in the backend, or add some as a vendor.</p>
      )}
      <div className="grid products">
        {items.map((p, i) => (
          <ProductCard key={p._id} product={p} index={i % 12} actions={<AddToCart product={p} />} />
        ))}
      </div>
      {page < pages && (
        <div className="center-row">
          <button className="btn ghost" disabled={loading} onClick={() => setPage(page + 1)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </motion.div>
  );
}