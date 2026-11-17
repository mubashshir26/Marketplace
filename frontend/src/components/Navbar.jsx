import { Link, NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { useCart } from '../cartcontext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const navigate = useNavigate();

  return (
    <motion.header
      className="nav"
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to="/" className="brand">
        <span className="brand-dot" />
        Marketplace
      </Link>
      <nav>
        <NavLink className="navlink" to="/search">Browse</NavLink>
        {user?.role === 'customer' && (
          <>
            <NavLink className="navlink" to="/orders">Orders</NavLink>
            <NavLink className="navlink" to="/cart">
              Cart{cart.count > 0 && <span className="badge">{cart.count}</span>}
            </NavLink>
          </>
        )}
        {user?.role === 'vendor' && <NavLink className="navlink" to="/vendor">Vendor</NavLink>}
        {user?.role === 'admin' && <NavLink className="navlink" to="/admin">Admin</NavLink>}
        {user ? (
          <>
            <span className="chip">{user.name} · {user.role}</span>
            <button
              className="btn ghost"
              onClick={async () => { await logout(); navigate('/login'); }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink className="navlink" to="/login">Log in</NavLink>
            <Link to="/register" className="btn">Sign up</Link>
          </>
        )}
      </nav>
    </motion.header>
  );
}