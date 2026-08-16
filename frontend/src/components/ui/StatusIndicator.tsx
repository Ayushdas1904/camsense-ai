import { cn } from '@/utils/cn';

type Status = 'online' | 'offline' | 'warning' | 'error' | 'ai';

/**
 * Status dot + label. Never relies on color alone — always pairs the dot with
 * a text label so status is legible to colorblind users (per UI/UX spec §11).
 */
const config: Record<Status, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-safe', label: 'Online', text: 'text-safe' },
  offline: { dot: 'bg-content-faint', label: 'Offline', text: 'text-content-muted' },
  warning: { dot: 'bg-warning', label: 'Warning', text: 'text-warning' },
  error: { dot: 'bg-critical', label: 'Error', text: 'text-critical' },
  ai: { dot: 'bg-info', label: 'AI Active', text: 'text-info' },
};

export function StatusIndicator({
  status,
  label,
  pulse = false,
}: {
  status: Status;
  label?: string;
  pulse?: boolean;
}) {
  const c = config[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', c.dot)} />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', c.dot)} />
      </span>
      <span className={c.text}>{label ?? c.label}</span>
    </span>
  );
}
