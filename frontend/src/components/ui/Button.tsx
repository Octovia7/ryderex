import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-700 text-white hover:bg-accent-800 disabled:hover:bg-accent-700',
  secondary:
    'bg-surface text-ink border border-border-strong hover:bg-slate-50 disabled:hover:bg-surface',
  ghost: 'text-ink-muted hover:bg-slate-100 hover:text-ink disabled:hover:bg-transparent',
  // Destructive actions cost real money (cancelling forfeits the
  // prepayment), so they get their own weight rather than sharing `primary`.
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50';

// Exported so a react-router <Link> can look like a button without nesting an
// <a> inside a <button> (invalid markup) or needing a polymorphic-`as` helper:
//   <Link to="/offer" className={buttonStyles({ variant: 'secondary' })}>
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      // Defaults to "button": an unspecified <button> inside a form submits
      // it, which is rarely what a secondary action wants.
      type={type}
      // A loading button must not be clickable twice — several of these
      // create payment orders.
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
