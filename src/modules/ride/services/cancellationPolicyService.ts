import { POSTING_COMMISSION_PERCENT } from './commissionService';

// A driver who cancels far enough ahead gets 2 of the 5 percentage points of
// their posting commission back — "2 percentage points of the 5% posting
// fee" (architecture.md §12), not "2%" of the commission amount itself. The
// ratio is expressed against `POSTING_COMMISSION_PERCENT` (imported, never
// re-declared) so 2 + 3 = 5 stays visibly true against whatever the
// commission actually is, and so this can never silently drift from it.
export const DRIVER_EARLY_CANCEL_REFUND_PERCENT = 2;

// How far ahead of departure counts as "early" enough for a partial refund.
export const DRIVER_CANCEL_THRESHOLD_HOURS = 18;

export interface DriverCancellationRefund {
  refundAmount: number;
  retainedAmount: number;
}

// The sole place this formula is computed (architecture.md §12). `retained`
// is derived as the complement of `refund`, never computed independently —
// that is what guarantees `refund + retained === commission` exactly,
// regardless of rounding, satisfying "a refund never exceeds the refundable
// amount" by construction rather than by a runtime check.
export function calculateDriverCancellationRefund(
  postingCommissionAmount: number,
  departureTime: Date,
): DriverCancellationRefund {
  const hoursUntilDeparture = (departureTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const isEarly = hoursUntilDeparture >= DRIVER_CANCEL_THRESHOLD_HOURS;

  const refundAmount = isEarly
    ? Math.round(
        postingCommissionAmount * (DRIVER_EARLY_CANCEL_REFUND_PERCENT / POSTING_COMMISSION_PERCENT),
      )
    : 0;

  return {
    refundAmount,
    retainedAmount: postingCommissionAmount - refundAmount,
  };
}
