import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth, homeFor } from '../AuthContext';

const roles = [
  { value: 'customer', label: 'Buy', hint: 'Shop from vendors' },
  { value: 'vendor', label: 'Sell', hint: 'Open your shop' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'customer' });
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await register(form);
      navigate(homeFor(user.role), { replace: true });
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
      <h1>Create your account</h1>
      <p className="muted sub">It takes under a minute.</p>
      {error && (
        <motion.p
          className="error"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          {error}
        </motion.p>
      )}

      <div className="segmented" role="radiogroup" aria-label="Account type">
        {roles.map((r) => (
          <button
            type="button"
            key={r.value}
            role="radio"
            aria-checked={form.role === r.value}
            className={form.role === r.value ? 'seg active' : 'seg'}
            onClick={() => setForm({ ...form, role: r.value })}
          >
            {form.role === r.value && (
              <motion.span layoutId="seg-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
            )}
            <span className="seg-text"><strong>{r.label}</strong><small>{r.hint}</small></span>
          </button>
        ))}
      </div>

      <label>Name
        <input required value={form.name} onChange={set('name')} />
      </label>
      <label>Email
        <input type="email" required value={form.email} onChange={set('email')} />
      </label>
      <label>Password (min 8 characters)
        <input type="password" required minLength={8} value={form.password} onChange={set('password')} />
      </label>
      <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.97 }}>
        {busy ? 'Creating…' : 'Sign up'}
      </motion.button>
      <p className="muted">Already registered? <Link to="/login">Log in</Link></p>
    </motion.form>
  );
}