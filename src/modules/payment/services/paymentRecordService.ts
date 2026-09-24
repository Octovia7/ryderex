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
