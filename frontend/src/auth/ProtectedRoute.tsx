import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from './session';

export function ProtectedRoute() {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        Loading…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
