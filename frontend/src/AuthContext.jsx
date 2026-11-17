import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokens } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokens.access && !tokens.refresh) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    tokens.set(d);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (form) => {
    const d = await api('/auth/register', { method: 'POST', body: form });
    tokens.set(d);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: tokens.refresh } });
    } catch { /* token may already be expired */ }
    tokens.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const homeFor = (role) =>
  role === 'admin' ? '/admin' : role === 'vendor' ? '/vendor' : '/';
