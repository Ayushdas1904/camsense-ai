import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/hooks/redux';
import { LoadingState } from '@/components/ui';

/**
 * Route guard. While the initial session-restore is in flight, shows a loader
 * so an already-authenticated user isn't briefly bounced to /login. Once
 * resolved, unauthenticated users are redirected to login.
 */
export function ProtectedRoute() {
  const { user, initializing } = useAppSelector((s) => s.auth);
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-base">
        <LoadingState message="Restoring session…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
