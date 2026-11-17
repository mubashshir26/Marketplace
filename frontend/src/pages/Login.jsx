import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth, homeFor } from '../AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(form.email, form.password);
      navigate(location.state?.from?.pathname || homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form
      key={shake}
      className="card form"
      onSubmit={submit}
      animate={shake ? { x: [0, -8, 8, -5, 5, 0] } : {}}
      transition={{ duration: 0.4 }}
    >
      <h1>Welcome back</h1>
      <p className="muted sub">Log in to continue.</p>
      {error && (
        <motion.p
          className="error"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          {error}
        </motion.p>
      )}
      <label>Email
        <input type="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>Password
        <input type="password" required value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </label>
      <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>
        {busy ? 'Logging in…' : 'Log in'}
      </motion.button>
      <p className="muted">New here? <Link to="/register">Create an account</Link></p>
    </motion.form>
  );
}