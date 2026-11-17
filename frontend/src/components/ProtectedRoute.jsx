import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';

// <ProtectedRoute roles={['admin']}>...</ProtectedRoute>
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="center muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
