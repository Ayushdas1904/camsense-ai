import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Toast notifications — the success/failure channel for the Review 2 flows
 * (person saved, recognition disabled, face registered, request rejected).
 *
 * Deliberately dependency-free and deliberately quiet: corner-anchored,
 * auto-dismissing, no modal takeover and no animation library, per the UI/UX
 * requirement that alerts be noticeable without being disruptive. Styling uses
 * only the semantic Tailwind tokens from tailwind.config.js.
 *
 * A toast is a transient confirmation, not a record. Anything that must be
 * durable (an alert, a recognition event) is persisted by the backend and shown
 * on the Alerts page.
 */

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 5000;

const toneStyles: Record<ToastTone, string> = {
  success: 'border-safe/40 text-safe',
  error: 'border-critical/40 text-critical',
  info: 'border-info/40 text-info',
};

const toneIcons: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4" />,
  error: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev, { id, tone, message }].slice(-4));
      const timer = window.setTimeout(() => {
        dismiss(id);
        timers.current = timers.current.filter((t) => t !== timer);
      }, AUTO_DISMISS_MS);
      timers.current.push(timer);
    },
    [dismiss]
  );

  // Clear any pending auto-dismiss timers if the provider unmounts.
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    []
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live so a screen reader announces the outcome without stealing focus. */}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-panel px-3.5 py-2.5 shadow-panel',
              toneStyles[toast.tone]
            )}
          >
            <span className="mt-0.5 shrink-0">{toneIcons[toast.tone]}</span>
            <p className="flex-1 text-xs leading-relaxed text-content">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-md p-0.5 text-content-muted hover:bg-raised hover:text-content"
              aria-label="Dismiss notification"
              title="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Must be called beneath a ToastProvider (see App.tsx). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
