import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-content-muted">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={cn(
            'w-full rounded-lg bg-surface border px-3 py-2 text-sm text-content',
            'placeholder:text-content-faint',
            'focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand',
            error ? 'border-critical' : 'border-border',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-critical">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
