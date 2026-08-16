import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { login } from '@/store/slices/authSlice';
import { Button, Input, Card, CardBody } from '@/components/ui';

/**
 * Login screen. Dispatches the login thunk and, on success, redirects to the
 * page the user originally requested (or the dashboard). All auth state and
 * error messaging comes from the Redux auth slice.
 */
export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, error } = useAppSelector((s) => s.auth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result)) {
      navigate(from, { replace: true });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10">
            <ShieldCheck className="h-6 w-6 text-brand" />
          </div>
          <h1 className="text-lg font-semibold text-content">CamSense AI</h1>
          <p className="text-sm text-content-muted">Smart CCTV Intelligence Platform</p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                name="email"
                type="email"
                placeholder="admin@camsense.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
              <Input
                label="Password"
                name="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              {error && (
                <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" loading={status === 'loading'}>
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-4 text-center text-xs text-content-faint">
          Operator access only · Authorized personnel
        </p>
      </div>
    </div>
  );
}
