import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from './session';
import { roleHomePath } from './roles';
import type { User } from '../api/auth';

// Nested inside ProtectedRoute, so by the time this renders status is
// already 'authenticated' and user is non-null — the null check here is
// just defensive, not the primary auth gate.
//
// `isAllowed` is a permission check, not a role whitelist, so a role that
// legitimately has access through more than one capability (e.g. DRIVER
// on passenger routes) doesn't need listing in multiple places.
export function RequireRole({ isAllowed }: { isAllowed: (role: User['role']) => boolean }) {
  const { user } = useSession();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAllowed(user.role)) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }

  return <Outlet />;
}
