import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { useAppDispatch } from '@/hooks/redux';
import { restoreSession } from '@/store/slices/authSlice';

/**
 * Root component. On mount it attempts to restore an existing session from a
 * stored token, then renders the router. Session restoration gates the
 * protected routes (see ProtectedRoute) to avoid a login-page flash.
 */
export function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
