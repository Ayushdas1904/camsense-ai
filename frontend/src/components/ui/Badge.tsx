import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

type Tone = 'neutral' | 'safe' | 'critical' | 'warning' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-raised text-content-muted border-border',
  safe: 'bg-safe/10 text-safe border-safe/30',
  critical: 'bg-critical/10 text-critical border-critical/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  info: 'bg-info/10 text-info border-info/30',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}
