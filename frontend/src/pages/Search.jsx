import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import AddToCart from '../components/AddToCart';

const SORTS = [
  ['', 'Best match'],
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['rating', 'Top rated'],
];
const RATINGS = [['', 'Any rating'], ['4', '4★ & up'], ['3', '3★ & up'], ['2', '2★ & up']];

// All filters live in the URL, so a search can be shared or bookmarked.
export default function Search() {
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) || '';
  const [qInput, setQInput] = useState(get('q'));
  const [price, setPrice] = useState({ min: get('minPrice'), max: get('maxPrice') });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '', ...changes }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };

  // Debounce typing so we don't query on every keystroke.
  useEffect(() => {
    if (qInput === get('q')) return undefined;
    const t = setTimeout(() => update({ q: qInput.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const queryString = params.toString();
  useEffect(() => {
    let stale = false;
    setLoading(true);
    api(`/search?${queryString}`)
      .then((d) => { if (!stale) { setData(d); setError(''); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [queryString]);

  const applyPrice = (e) => {
    e.preventDefault();
    update({ minPrice: price.min, maxPrice: price.max });
  };

  const clearAll = () => {
    setQInput('');
    setPrice({ min: '', max: '' });
    setParams(new URLSearchParams());
  };

  const page = Number(get('page')) || 1;
  const hasFilters = [...params.keys()].length > 0;

  return (
    <div>
      <div className="search search-bar">
        <input
          autoFocus
          type="search"
          placeholder="Search products, categories or shops…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      <div className="search-layout">
        <aside className="filters card">
          <h3>Category</h3>
          <ul className="cat-list">
            {(data?.categories || []).map((c) => (
              <li key={c.name}>
                <button
                  className={get('category') === c.name ? 'cat active' : 'cat'}
                  onClick={() => update({ category: get('category') === c.name ? '' : c.name })}
                >
                  <span>{c.name}</span>
                  <small>{c.count}</small>
                </button>
              </li>
            ))}
            {data && data.categories.length === 0 && <li className="muted small">No categories</li>}
          </ul>

          <h3>Price (₹)</h3>
          <form className="price-form" onSubmit={applyPrice}>
            <input type="number" min="0" placeholder="Min" value={price.min}
              onChange={(e) => setPrice({ ...price, min: e.target.value })} />
            <input type="number" min="0" placeholder="Max" value={price.max}
              onChange={(e) => setPrice({ ...price, max: e.target.value })} />
            <button className="btn ghost sm">Go</button>
          </form>

          <h3>Rating</h3>
          <select value={get('rating')} onChange={(e) => update({ rating: e.target.value })}>
            {RATINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {hasFilters && <button className="btn ghost sm clear" onClick={clearAll}>Clear all</button>}
        </aside>

        <section>
          <div className="result-head">
            <p className="muted">
              {data ? `${data.total.toLocaleString('en-IN')} result${data.total === 1 ? '' : 's'}` : ' '}
              {get('q') && <> for “{get('q')}”</>}
            </p>
            <select value={get('sort')} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort by">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {error && <p className="error">{error}</p>}
          {data && data.items.length === 0 && !error && (
            <p className="muted">Nothing matched. Try a different word or clear some filters.</p>
          )}

          <div className={loading ? 'grid products dim' : 'grid products'}>
            {(data?.items || []).map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} actions={<AddToCart product={p} />} />
            ))}
          </div>

          {data && data.pages > 1 && (
            <div className="pager">
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                ← Prev
              </button>
              <span className="muted small">Page {page} of {data.pages}</span>
              <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => update({ page: String(page + 1) })}>
                Next →
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}