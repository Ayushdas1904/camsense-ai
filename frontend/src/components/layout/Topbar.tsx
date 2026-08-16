import { LogOut, ShieldCheck } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { logout } from '@/store/slices/authSlice';
import { Button } from '@/components/ui';

/**
 * Top bar for the authenticated app: contextual title area, the operator's
 * identity, and sign-out. Kept minimal and data-focused per the UI/UX spec.
 */
export function Topbar() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-2 text-sm text-content-muted">
        <ShieldCheck className="h-4 w-4 text-brand" />
        <span>Security Operations Center</span>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <div className="text-right">
            <p className="text-sm font-medium text-content">{user.name}</p>
            <p className="text-xs capitalize text-content-faint">{user.role}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LogOut className="h-4 w-4" />}
          onClick={() => dispatch(logout())}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
