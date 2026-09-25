// The driver's posting commission: 5% of the ride's total fare
// (`farePerSeat × totalSeats`). A business rule, deliberately a constant
// rather than configuration — it lives in exactly one place. Exported so
// cancellationPolicyService's "2/5 of the commission" ratio is expressed
// against this same value, never a second, independently-declared 5%.
export const POSTING_COMMISSION_PERCENT = 5;

// Integer arithmetic until the single final division, so a .5 boundary is
// decided exactly rather than by how 0.05 happens to round in binary.
// `farePerSeat` is already a whole rupee amount, so the product below is exact.
export function calculatePostingCommission(farePerSeat: number, totalSeats: number): number {
  return Math.round((farePerSeat * totalSeats * POSTING_COMMISSION_PERCENT) / 100);
}
