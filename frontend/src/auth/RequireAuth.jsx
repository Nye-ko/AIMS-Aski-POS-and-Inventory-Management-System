import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ROLE_HOME } from './devUsers';

// `roles` (optional) limits the route to those roles; ADMIN is always allowed.
// A signed-in user outside the list is sent to their own home page.
export default function RequireAuth({ children, roles }) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  if (roles && role !== 'ADMIN' && !roles.includes(role)) {
    return <Navigate to={ROLE_HOME[role] || '/'} replace />;
  }

  return children;
}
