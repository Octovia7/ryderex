import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';

import { cn } from '@/lib/cn';

interface FieldProps {
  label: string;
  // Rendered in place of the hint when present, and wires aria-invalid /
  // aria-describedby so the error is announced rather than only coloured.
  error?: string;
  hint?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required === true && (
          <span className="text-red-600" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, describedBy: message !== undefined ? messageId : undefined })}
      {message !== undefined && (
        <p
          id={messageId}
          className={cn('text-xs', error !== undefined ? 'text-red-600' : 'text-ink-faint')}
        >
          {message}
        </p>
      )}
    </div>
  );
}

const CONTROL_CLASSES =
  'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors focus:border-accent-700 focus:outline-none disabled:bg-slate-50 ' +
  'disabled:text-ink-faint';

export interface TextInputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

export function TextInput({ invalid = false, className, ...props }: TextInputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_CLASSES,
        invalid ? 'border-red-500' : 'border-border-strong',
        className,
      )}
      {...props}
    />
  );
}

export interface SelectInputProps extends ComponentProps<'select'> {
  invalid?: boolean;
}

export function SelectInput({ invalid = false, className, children, ...props }: SelectInputProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_CLASSES,
        'appearance-none bg-[length:1rem] bg-[right_0.625rem_center] bg-no-repeat pr-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        invalid ? 'border-red-500' : 'border-border-strong',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({
  invalid = false,
  className,
  ...props
}: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_CLASSES,
        'h-auto min-h-20 resize-y py-2',
        invalid ? 'border-red-500' : 'border-border-strong',
        className,
      )}
      {...props}
    />
  );
}
