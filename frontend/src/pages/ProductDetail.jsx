import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { inr, when } from '../money';
import AddToCart from '../components/AddToCart';

const Stars = ({ value }) => (
  <span className="stars" aria-label={`${value} out of 5`}>
    {'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}
  </span>
);

function StarInput({ value, onChange }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= value ? 'on' : ''}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);

  const [reviews, setReviews] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [mine, setMine] = useState(null); // { canReview, review }
  const [form, setForm] = useState({ rating: 0, comment: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setProduct(null);
    setError('');
    setActive(0);
    api(`/products/${id}`).then((d) => setProduct(d.product)).catch((e) => setError(e.message));
  }, [id]);

  const loadReviews = (p = 1) =>
    api(`/products/${id}/reviews?page=${p}&limit=5`).then((d) => {
      setReviews((prev) => (p === 1 ? d.items : [...prev, ...d.items]));
      setPage(p);
      setPages(d.pages);
      setTotal(d.total);
    });

  useEffect(() => {
    loadReviews(1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setMine(null);
    if (user?.role !== 'customer') return;
    api(`/products/${id}/reviews/mine`)
      .then((d) => {
        setMine(d);
        if (d.review) setForm({ rating: d.review.rating, comment: d.review.comment || '' });
      })
      .catch(() => {});
  }, [id, user]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.rating) return setFormError('Pick a star rating first');
    setFormError('');
    setBusy(true);
    try {
      const d = await api(`/products/${id}/reviews`, { method: 'PUT', body: form });
      setProduct((p) => ({ ...p, ...d.product }));
      setMine({ canReview: true, review: d.review });
      await loadReviews(1);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (review) => {
    if (!window.confirm('Delete this review?')) return;
    try {
      const d = await api(`/products/${id}/reviews/${review._id}`, { method: 'DELETE' });
      setProduct((p) => ({ ...p, ...d.product }));
      if (mine?.review?._id === review._id) {
        setMine({ canReview: true, review: null });
        setForm({ rating: 0, comment: '' });
      }
      await loadReviews(1);
    } catch (err) {
      setFormError(err.message);
    }
  };

  if (error) {
    return (
      <div className="card empty">
        <h1>Product not found</h1>
        <p className="muted">{error}</p>
        <Link to="/search" className="btn">Browse products</Link>
      </div>
    );
  }
  if (!product) return <p className="center muted">Loading…</p>;

  const images = product.images?.length ? product.images : [];
  const isAdmin = user?.role === 'admin';

  return (
    <div>
      <p className="muted small crumb"><Link to="/search">← All products</Link></p>

      <div className="pd">
        <div className="pd-gallery">
          <div className="pd-main">
            {images[active] ? <img src={images[active]} alt={product.name} /> : <span className="muted">No image</span>}
          </div>
          {images.length > 1 && (
            <div className="pd-thumbs">
              {images.map((src, i) => (
                <button key={src} className={i === active ? 'on' : ''} onClick={() => setActive(i)} aria-label={`Image ${i + 1}`}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <motion.div className="pd-info" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="eyebrow">{product.category}{product.vendor?.shopName ? ` · ${product.vendor.shopName}` : ''}</p>
          <h1>{product.name}</h1>
          <p className="pd-rating">
            {product.ratingCount ? (
              <><Stars value={product.ratingAvg} /> <strong>{product.ratingAvg.toFixed(1)}</strong>
                <span className="muted small"> ({product.ratingCount} review{product.ratingCount === 1 ? '' : 's'})</span></>
            ) : (
              <span className="muted small">No reviews yet</span>
            )}
          </p>
          <p className="pd-price">{inr(product.price)}</p>
          <p className="muted small">{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</p>
          <AddToCart product={product} />
          {product.description && <p className="pd-desc">{product.description}</p>}
        </motion.div>
      </div>

      <h2 className="section-title">Reviews {total > 0 && <span className="muted small">({total})</span>}</h2>

      <div className="review-layout">
        <div className="card">
          {reviews.length === 0 && <p className="muted">Nobody has reviewed this yet.</p>}
          {reviews.map((r) => (
            <article key={r._id} className="review">
              <div className="review-head">
                <span><Stars value={r.rating} /> <strong>{r.customerName}</strong></span>
                <span className="muted small">{when(r.createdAt)}</span>
              </div>
              {r.comment && <p className="review-body">{r.comment}</p>}
              {(isAdmin || mine?.review?._id === r._id) && (
                <button className="btn ghost sm danger" onClick={() => remove(r)}>
                  {isAdmin ? 'Remove (admin)' : 'Delete mine'}
                </button>
              )}
            </article>
          ))}
          {page < pages && (
            <div className="center-row"><button className="btn ghost sm" onClick={() => loadReviews(page + 1)}>Show more</button></div>
          )}
        </div>

        <aside className="card review-form-card">
          <h3>{mine?.review ? 'Your review' : 'Write a review'}</h3>
          {!user && <p className="muted small"><Link to="/login">Log in</Link> as a customer who bought this to leave a review.</p>}
          {user && user.role !== 'customer' && <p className="muted small">Only customers can write reviews.</p>}
          {user?.role === 'customer' && mine && !mine.canReview && (
            <p className="muted small">You can review this product once it has been delivered to you.</p>
          )}
          {user?.role === 'customer' && mine?.canReview && (
            <form className="form-plain" onSubmit={submit}>
              <StarInput value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
              <textarea
                rows={4}
                maxLength={1000}
                placeholder="What did you like or dislike? (optional)"
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
              {formError && <p className="error">{formError}</p>}
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : mine.review ? 'Update review' : 'Post review'}</button>
            </form>
          )}
          {formError && !mine?.canReview && <p className="error">{formError}</p>}
        </aside>
      </div>
    </div>
  );
}