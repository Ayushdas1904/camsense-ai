import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { ToastProvider } from '@/components/ui';
import { useAppDispatch } from '@/hooks/redux';
import { restoreSession } from '@/store/slices/authSlice';

/**
 * Root component. On mount it attempts to restore an existing session from a
 * stored token, then renders the router. Session restoration gates the
 * protected routes (see ProtectedRoute) to avoid a login-page flash.
 *
 * ToastProvider wraps the router so every page can raise success/failure
 * notifications through useToast().
 */
export function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  return (
    <ToastProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ToastProvider>
  );
}
