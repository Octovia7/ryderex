import { prisma } from '../../../infrastructure/database/prismaClient';
import { paymentProvider } from '../../../infrastructure/payments';
import * as notificationService from '../../notification/services/notificationService';
import * as paymentRepository from '../repositories/paymentRepository';

// The BullMQ refund worker's own handler (steps.md §12): loads the REFUND
// transaction by the id its job payload carries, and short-circuits before
// ever calling the provider if it isn't (still) PENDING — the same
// conditional-update idempotency pattern as every other resolution in this
// codebase, and what makes a BullMQ retry of this same job safe to run any
// number of times: not_found or already-resolved (SUCCESS/FAILED) is a
// no-op, never a second gateway call.
export async function processRefund(transactionId: string): Promise<void> {
  const transaction = await paymentRepository.findTransactionById(prisma, transactionId);

  if (!transaction || transaction.status !== 'PENDING') {
    return;
  }

  // A refund Transaction's own `paymentId` already points directly at the
  // ORIGINAL captured Payment it refunds (set once, at creation, by
  // paymentRecordService's recordRefundForRide/recordRefundForBooking) — a
  // plain by-id read, never a second ride/booking-scoped search for it.
  const payment = await paymentRepository.findById(prisma, transaction.paymentId);

  if (!payment || !payment.providerPaymentId) {
    // Invariant violation, not a normal outcome: a REFUND transaction's
    // paymentId always references a SUCCESS Payment with a
    // providerPaymentId — recordRefundForRide/recordRefundForBooking only
    // ever create one from a successful lookup. Thrown (not returned) so
    // BullMQ's own retry/backoff surfaces this for investigation rather
    // than silently dropping a refund that should have happened.
    throw new Error(`Refund transaction ${transactionId} has no valid Payment to refund against.`);
  }

  // The external call — never inside a transaction. A failure here throws
  // and BullMQ retries the whole job (attempts: 5, exponential); safe,
  // because the PENDING-only guard above makes every attempt, retry or not,
  // start from the same idempotent check.
  await paymentProvider.refund({
    paymentId: payment.providerPaymentId,
    amount: transaction.amount,
  });

  await paymentRepository.resolveTransactionById(prisma, transactionId, 'SUCCESS');

  // REFUND_PROCESSED (steps.md §13), after the refund actually resolves to
  // SUCCESS — to whichever user originally paid (the driver for a posting-
  // commission refund, the passenger for a prepayment refund): `payment`
  // already has their userId in scope (derived from `ride.driverId` /
  // `booking.passengerId` via paymentRepository's widened select, never a
  // second lookup). It can be null only if the Payment's own Ride/Booking
  // was itself deleted, in which case there is no one left to notify.
  if (payment.userId) {
    await notificationService.notifyRefundProcessed(payment.userId, transaction.amount);
  }
}
