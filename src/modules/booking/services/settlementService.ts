// The application's cut on completion: 3% of the total fare, the driver
// keeps the rest. A business rule, deliberately a constant rather than
// configuration — the same reasoning as commissionService's
// POSTING_COMMISSION_PERCENT and bookingService's PREPAYMENT_PERCENT.
const PLATFORM_COMMISSION_PERCENT = 3;

// The one place §84's "application commission is calculated exactly once"
// is computed (architecture.md "Settlement"). Not persisted anywhere — there
// is no wallet or payout table in scope, and `TransactionType` is a closed
// enum, so this is logged in a structured, greppable line by the caller,
// ready for a future payout module to consume.
export interface Settlement {
  platformCommission: number;
  driverShare: number;
}

export function calculateSettlement(totalFare: number): Settlement {
  const platformCommission = Math.round((totalFare * PLATFORM_COMMISSION_PERCENT) / 100);

  return {
    platformCommission,
    driverShare: totalFare - platformCommission,
  };
}

// The remaining 90% a booking owes once its 10% prepayment is subtracted —
// using the fare *locked* on the booking at creation, never recalculated
// (the same historical-immutability discipline as every other fare figure
// in this codebase).
export function calculateRemainingFare(totalFare: number, prepaidAmount: number): number {
  return Math.round(totalFare - prepaidAmount);
}
