import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Accessible-ish modal dialog: backdrop click and Escape both close.
 *
 * The panel is height-capped and its BODY scrolls, with the header and footer
 * pinned. Without that, a tall form (the Review 3 automation-rule form is the
 * worst case) overflowed the viewport with no way to reach its lower fields or
 * its Save button — the dialog is centred in a `fixed inset-0` flex container,
 * so overflow was simply clipped off both ends. `max-w-lg` is unchanged, so
 * nothing about the existing modals' width or spacing moves.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Ties the dialog to its own heading, so a screen reader announces the title
  // rather than just "dialog".
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col cs-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h3 id={titleId} className="text-sm font-semibold text-content">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-content-muted hover:bg-raised hover:text-content"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
