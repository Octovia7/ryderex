import type { TransactionType } from '../../../generated/prisma/enums';
import * as paymentRepository from '../repositories/paymentRepository';
import type { PaymentRecord, TransactionRecord } from '../repositories/paymentRepository';

// The one function that writes a Payment and its Transaction together
// (architecture.md §11: "Both are written by paymentRecordService.recordOrder
// ... so they cannot drift"). Every caller supplies exactly one of
// rideId/bookingId — a driver's posting fee funds a Ride, a passenger's
// prepayment funds a Booking — never both, never neither.
//
// Takes a client so the caller can run this inside the SAME transaction as
// the ride/booking write it accompanies: for ride creation, the ride INSERT
// itself; for booking creation, the small follow-up transaction that attaches
// the order id once the external createOrder() call returns (a payment call
// or an order-id attachment must never sit inside the seat-reservation
// transaction — both are documented elsewhere as external-call-adjacent
// writes, not seat-holding ones).
export interface RecordOrderInput {
  rideId: string | null;
  bookingId: string | null;
  provider: string;
  providerOrderId: string;
  amount: number;
  transactionType: TransactionType;
}

export interface RecordOrderResult {
  payment: PaymentRecord;
  transaction: TransactionRecord;
}

export async function recordOrder(
  client: Parameters<typeof paymentRepository.createPayment>[0],
  input: RecordOrderInput,
): Promise<RecordOrderResult> {
  const payment = await paymentRepository.createPayment(client, {
    rideId: input.rideId,
    bookingId: input.bookingId,
    provider: input.provider,
    providerOrderId: input.providerOrderId,
    amount: input.amount,
  });

  const transaction = await paymentRepository.createTransaction(client, {
    paymentId: payment.id,
    rideId: input.rideId,
    bookingId: input.bookingId,
    type: input.transactionType,
    amount: input.amount,
  });

  return { payment, transaction };
}

// The webhook's counterpart to recordOrder above: resolves a Payment and its
// Transaction together, the same way they were created together — never
// independently, so a failed attempt gets a financial-history record too,
// not just a successful one (steps.md decision log, 2026-08-13).
//
// `not_found` vs `already_resolved` is a distinction the caller (webhookService)
// acts on: `not_found` means our own Payment write may not have committed yet
// (retry-worthy); `already_resolved` means a concurrent or earlier duplicate
// delivery already won the race — nothing is left to do.
//
// Note: `bookingId`/`rideId` alone told the caller which entity to
// transition (Ride for a driver's posting fee, Booking for a passenger's
// prepayment) back when there was exactly one payment-producing transaction
// type per entity. Phase 11 Step 4 added a second one a booking can have
// (`FINAL_PAYMENT`, alongside `BOOKING_PREPAYMENT`) — `transactionType` is
// what disambiguates them; the caller no longer decides from `bookingId`
// alone.
export type ResolvePaymentResult =
  | { outcome: 'not_found' }
  | { outcome: 'already_resolved' }
  | {
      outcome: 'resolved';
      paymentId: string;
      rideId: string | null;
      bookingId: string | null;
      amount: number;
      transactionType: TransactionType;
    };

export async function resolvePaymentByOrderId(
  client: Parameters<typeof paymentRepository.createPayment>[0],
  providerOrderId: string,
  outcome: 'SUCCESS' | 'FAILED',
  providerPaymentId: string,
): Promise<ResolvePaymentResult> {
  const existing = await paymentRepository.findByProviderOrderId(client, providerOrderId);

  if (!existing) {
    return { outcome: 'not_found' };
  }

  if (existing.status !== 'CREATED') {
    return { outcome: 'already_resolved' };
  }

  const applied = await paymentRepository.resolvePayment(
    client,
    providerOrderId,
    outcome,
    providerPaymentId,
  );

  if (!applied) {
    // Lost the race to a concurrent identical delivery between the read
    // above and this UPDATE — the other one already resolved it.
    return { outcome: 'already_resolved' };
  }

  await paymentRepository.resolveTransaction(client, existing.id, outcome);

  // Every Payment is created together with exactly one Transaction
  // (recordOrder writes both) — this is what carries `transactionType`,
  // since a Payment row itself has no `type` field of its own.
  const transaction = await paymentRepository.findTransactionByPaymentId(client, existing.id);

  if (!transaction) {
    // Invariant violation, not a normal outcome: recordOrder never creates a
    // Payment without its Transaction. Thrown (not returned) so this rolls
    // back with the rest of the webhook's transaction rather than resolving
    // the Payment with no way to decide what it was for.
    throw new Error(`Resolved Payment ${existing.id} has no associated Transaction.`);
  }

  return {
    outcome: 'resolved',
    paymentId: existing.id,
    rideId: existing.rideId,
    bookingId: existing.bookingId,
    amount: existing.amount,
    transactionType: transaction.type,
  };
}

// Records a refund INTENT (steps.md §12/architecture.md §11: "Refund
// intents are recorded as PENDING transactions inside that transaction; the
// actual gateway call happens afterwards as a retryable job" — the actual
// call is a later step's work, not this one's). Unlike recordOrder above,
// neither of these creates a new Payment row — a refund references the
// ORIGINAL captured Payment it refunds against, looked up here so neither
// ride nor booking module ever needs to reach into paymentRepository
// directly, only this service (the same module-boundary shape as
// recordOrder/resolvePaymentByOrderId above).
//
// Both take a client so the caller (rideService.cancelRide's cascade) can
// run them inside its own transaction, alongside the ride/booking
// cancellation they accompany.

// A ride cancelled before its posting-fee payment ever resolved SUCCESS
// (still CREATED, e.g. cancelled while PENDING_PAYMENT) has nothing to
// refund — `null` is a legitimate, non-exceptional outcome here, not an
// invariant violation. The caller decides whether to call this at all
// (only when the cancellation policy says `refundAmount > 0`); this only
// decides whether there is anything captured to refund against.
export async function recordRefundForRide(
  client: Parameters<typeof paymentRepository.createTransaction>[0],
  rideId: string,
  amount: number,
): Promise<TransactionRecord | null> {
  const payment = await paymentRepository.findSuccessfulByRideId(client, rideId);

  if (!payment) {
    return null;
  }

  return paymentRepository.createTransaction(client, {
    paymentId: payment.id,
    rideId,
    bookingId: null,
    type: 'REFUND',
    amount,
  });
}

// Unlike the ride case above, a CONFIRMED booking's prepayment was
// necessarily captured — CONFIRMED is only ever reached via a successful
// payment resolution (webhookService, Phase 10 Step 3). A missing
// successful Payment here is a genuine invariant violation, not a normal
// outcome, so this throws (rolling back the cascade transaction) rather
// than returning null.
export async function recordRefundForBooking(
  client: Parameters<typeof paymentRepository.createTransaction>[0],
  bookingId: string,
  amount: number,
): Promise<TransactionRecord> {
  const payment = await paymentRepository.findSuccessfulByBookingId(client, bookingId);

  if (!payment) {
    throw new Error(`No successful Payment found to refund for booking ${bookingId}.`);
  }

  return paymentRepository.createTransaction(client, {
    paymentId: payment.id,
    rideId: null,
    bookingId,
    type: 'REFUND',
    amount,
  });
}
