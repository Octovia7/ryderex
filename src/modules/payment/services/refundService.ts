import { prisma } from '../../../infrastructure/database/prismaClient';
import { paymentProvider } from '../../../infrastructure/payments';
import * as notificationService from '../../notification/services/notificationService';
import * as paymentRepository from '../repositories/paymentRepository';

// The BullMQ refund worker's own handler (steps.md §12): loads the REFUND
// transaction by the id its job payload carries, and short-circuits before
// ever calling the provider if it isn't (still) PENDING.
//
// Phase 15 Pass 1 finding: a plain PENDING-only read-then-branch is not
// enough — two genuinely concurrent invocations for the SAME transaction
// (a BullMQ stalled-job re-pickup, or any other out-of-band caller) could
// both observe PENDING and both call paymentProvider.refund(), producing two
// real gateway calls for one logical refund. `claimTransactionForProcessing`
// closes that gap with the same atomic conditional-UPDATE idiom every other
// resolution in this codebase already uses (resolvePayment, resolveTransaction):
// PENDING -> PROCESSING, and only the caller for whom `count === 1` may ever
// reach the provider call below. A caller that loses the claim returns —
// not_found, already-processing, or already-resolved (SUCCESS/FAILED) are
// all the same no-op from its perspective.
//
// Everything from the claim onward is wrapped in try/catch: on ANY failure
// (an invariant violation below, or the provider call itself), the claim is
// reverted PROCESSING -> PENDING before rethrowing, so BullMQ's own
// retry/backoff (attempts: 5, exponential) gets another attempt at the same
// job rather than the transaction being left permanently unclaimable. This
// bounds the same "external call outside a DB transaction" trade-off already
// accepted elsewhere in this codebase (steps.md §11/§20: an interruption
// between two non-transactional steps leaves a recoverable gap, never
// double-executes) — a genuine hard process kill in the narrow window between
// a successful claim and the revert is the one case no code-level try/catch
// can close, the same inherent limit already accepted for the ride/booking
// creation external-call ordering.
export async function processRefund(transactionId: string): Promise<void> {
  const claimed = await paymentRepository.claimTransactionForProcessing(prisma, transactionId);

  if (!claimed) {
    return;
  }

  try {
    const transaction = await paymentRepository.findTransactionById(prisma, transactionId);

    // Invariant violation, not a normal outcome: the claim above only
    // succeeds for a row that exists and was PENDING, so it must still be
    // findable here. Guarded anyway rather than asserted, matching this
    // function's existing discipline of throwing (never silently dropping)
    // on a state it cannot explain.
    if (!transaction) {
      throw new Error(`Refund transaction ${transactionId} vanished after being claimed.`);
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
      throw new Error(
        `Refund transaction ${transactionId} has no valid Payment to refund against.`,
      );
    }

    // The external call — never inside a transaction. A failure here is
    // caught below, the claim is released, and BullMQ retries the whole job.
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
  } catch (error) {
    await paymentRepository.revertTransactionToPending(prisma, transactionId);
    throw error;
  }
}
