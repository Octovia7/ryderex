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
// Note: `bookingId`/`rideId` alone tell the caller which entity to transition
// (Ride for a driver's posting fee, Booking for a passenger's prepayment) —
// there is exactly one payment-producing transaction type per entity today
// (`DRIVER_RIDE_FEE`, `BOOKING_PREPAYMENT`), so this does not yet need to
// disambiguate further. FINAL_PAYMENT (Phase 11) will need its own handling
// once a booking can have more than one resolved Payment.
export type ResolvePaymentResult =
  | { outcome: 'not_found' }
  | { outcome: 'already_resolved' }
  | {
      outcome: 'resolved';
      paymentId: string;
      rideId: string | null;
      bookingId: string | null;
      amount: number;
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

  return {
    outcome: 'resolved',
    paymentId: existing.id,
    rideId: existing.rideId,
    bookingId: existing.bookingId,
    amount: existing.amount,
  };
}
