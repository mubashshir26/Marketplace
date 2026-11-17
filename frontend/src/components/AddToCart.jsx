import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useCart } from '../cartcontext';

export default function AddToCart({ product }) {
  const { user } = useAuth();
  const { add } = useCart();
  const navigate = useNavigate();
  const [state, setState] = useState('idle'); // idle | busy | added
  const [error, setError] = useState('');

  // Vendors and admins don't shop.
  if (user && user.role !== 'customer') return null;
  if (product.stock <= 0) return <button className="btn ghost sm" disabled>Out of stock</button>;

  const click = async () => {
    if (!user) return navigate('/login');
    setError('');
    setState('busy');
    try {
      await add(product._id);
      setState('added');
      setTimeout(() => setState('idle'), 1400);
    } catch (e) {
      setError(e.message);
      setState('idle');
    }
  };

  return (
    <div className="addcart">
      <button className={state === 'added' ? 'btn sm added' : 'btn sm'} disabled={state === 'busy'} onClick={click}>
        {state === 'added' ? '✓ Added' : state === 'busy' ? 'Adding…' : 'Add to cart'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}