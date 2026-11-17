import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api';

// Create (initial = null) or edit (initial = product) form with image upload.
export default function ProductForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    category: initial?.category || '',
    price: initial?.price ?? '',
    stock: initial?.stock ?? 0,
  });
  const [images, setImages] = useState(initial?.images || []); // already-uploaded URLs
  const [files, setFiles] = useState([]); // new files to upload
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let urls = [];
      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append('images', f));
        urls = (await api('/products/upload', { method: 'POST', body: fd })).urls;
      }
      const body = {
        ...form,
        price: Number(form.price),
        stock: Number(form.stock),
        images: [...images, ...urls],
      };
      const d = initial
        ? await api(`/products/${initial._id}`, { method: 'PUT', body })
        : await api('/products', { method: 'POST', body });
      onSaved(d.product);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form
      className="card form wide"
      onSubmit={submit}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>{initial ? 'Edit product' : 'Add product'}</h2>
      {error && <p className="error">{error}</p>}
      <label>Name
        <input required value={form.name} onChange={set('name')} />
      </label>
      <label>Description
        <textarea rows={3} value={form.description} onChange={set('description')} />
      </label>
      <div className="two-col">
        <label>Category
          <input required value={form.category} onChange={set('category')} placeholder="e.g. smartphones" />
        </label>
        <label>Price (₹)
          <input required type="number" min="0" step="0.01" value={form.price} onChange={set('price')} />
        </label>
        <label>Stock
          <input type="number" min="0" step="1" value={form.stock} onChange={set('stock')} />
        </label>
      </div>

      {images.length > 0 && (
        <div className="thumbs">
          {images.map((url) => (
            <div key={url} className="thumb-edit">
              <img src={url} alt="" />
              <button type="button" aria-label="Remove image" onClick={() => setImages(images.filter((u) => u !== url))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <label>Add images (JPG, PNG or WebP, up to 5, 5 MB each)
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setFiles(Array.from(e.target.files).slice(0, 5))}
        />
      </label>
      {files.length > 0 && <p className="muted small">{files.length} new image(s) will upload when you save.</p>}

      <div className="cta-row">
        <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add product'}
        </motion.button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </motion.form>
  );
}