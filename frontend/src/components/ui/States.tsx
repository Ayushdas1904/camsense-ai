import type { ReactNode } from 'react';
import { Loader2, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './Button';

/**
 * The four standard view states from the error-handling spec (§15):
 * Loading, Empty, Error, and a generic Placeholder for future-ready pages.
 * Every data view should render one of these instead of a blank screen.
 */

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-content-muted">
      <Loader2 className="h-6 w-6 animate-spin text-brand" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon,
  action,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full bg-raised p-3 text-content-muted">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div>
        <p className="text-sm font-medium text-content">{title}</p>
        {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  message = 'Unable to retrieve data. Please try again.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full bg-critical/10 p-3 text-critical">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="text-sm text-content-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
