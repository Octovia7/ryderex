import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

// The workhorse container: a 1px border and no shadow. Shadows are reserved
// for things that genuinely float above the page (dialogs, dropdowns), so a
// card never competes with them for depth.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-border-subtle bg-surface', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 border-b border-border-subtle p-4', className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 border-t border-border-subtle p-4', className)}
      {...props}
    />
  );
}
