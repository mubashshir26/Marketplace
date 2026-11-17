import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function ProductCard({ product, index = 0, actions }) {
  const img = product.images?.[0];
  const to = `/product/${product._id}`;
  return (
    <motion.article
      className="card product"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04 }}
      whileHover={{ y: -6 }}
    >
      <Link to={to} className="thumb" aria-label={product.name}>
        {img ? <img src={img} alt={product.name} loading="lazy" /> : <span className="muted small">No image</span>}
      </Link>
      <h3><Link to={to}>{product.name}</Link></h3>
      <p className="muted small">
        {product.category}
        {product.vendor?.shopName ? ` · ${product.vendor.shopName}` : ''}
      </p>
      <div className="row">
        <strong>₹{Number(product.price).toLocaleString('en-IN')}</strong>
        <span className="chip">★ {product.ratingAvg ? product.ratingAvg.toFixed(1) : 'New'}</span>
      </div>
      {actions}
    </motion.article>
  );
}