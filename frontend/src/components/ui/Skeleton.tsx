import { cn } from '@/lib/cn';

import { Card } from './Card';

// Skeletons rather than spinners for list and detail loads: they hold the
// layout still, so content does not jump when it arrives. A spinner is right
// only where the wait is genuinely indeterminate (the payment poll).
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-slate-200', className)} />;
}

// Mirrors the shape of a real trip/ride row so the swap is visually quiet.
export function CardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
    </Card>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}
