import { prisma } from '../../../infrastructure/database/prismaClient';
import { paymentProvider } from '../../../infrastructure/payments';
import { AppError } from '../../../shared/AppError';
import { cancelScheduledBookingExpiry } from '../../booking/services/bookingExpiryService';
import * as bookingService from '../../booking/services/bookingService';
import * as rideService from '../../ride/services/rideService';
import { paymentWebhookPayloadSchema } from '../schemas/paymentWebhookPayload.schema';
import * as paymentRecordService from './paymentRecordService';

// Razorpay event -> the outcome it represents. Every other event Razorpay
// might ever send (`order.paid`, `refund.processed`, ...) is deliberately
// absent here — architecture.md §11: "Unrecognised events are acknowledged
// 200 and ignored — never make a provider retry an event you don't act on."
const EVENT_OUTCOMES: Record<string, 'SUCCESS' | 'FAILED'> = {
  'payment.captured': 'SUCCESS',
  'payment.failed': 'FAILED',
};

function invalidPayload(cause?: unknown): AppError {
  return new AppError({
    statusCode: 400,
    code: 'INVALID_WEBHOOK_PAYLOAD',
    message: 'The webhook payload could not be processed.',
    cause,
  });
}

// The full flow (architecture.md §11's sequence diagram + "Duplicate webhook
// — three layers of idempotency"):
//
//  1. Verify the signature over the EXACT raw bytes — never a re-serialized
//     body — before trusting anything else in the request.
//  2. Map the event to an outcome; an unrecognised one is a 200 no-op.
//  3. Parse and validate the payload shape (only now — signature verification
//     is what earns the body any trust at all).
//  4. ONE transaction: resolve the Payment/Transaction (only from CREATED —
//     layer 1 of duplicate-webhook idempotency), then the ride/booking
//     transition dispatched by transactionType (itself a conditional
//     update — layer 3): DRIVER_RIDE_FEE moves the ride, BOOKING_PREPAYMENT
//     and FINAL_PAYMENT each move the booking differently (Phase 11 Step 4:
//     a booking now funds two transaction types over its lifetime, so
//     `bookingId` alone no longer says which transition applies).
//  5. After commit: cancel the booking's scheduled expiry job (an external
//     Redis call, so it can never sit inside the transaction above); log a
//     manual-review error if the transition didn't apply even though the
//     Payment/Transaction did resolve — the money moved, but the entity had
//     already gone somewhere else in the meantime (steps.md decision log,
//     2026-08-13). A full automatic fix (an actual refund) needs Phase 11's
//     refund policy, which doesn't exist yet — deferred, not invented.
export async function processPaymentWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<void> {
  if (!signature || !paymentProvider.verifyWebhookSignature(rawBody, signature)) {
    throw new AppError({
      statusCode: 401,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      message: 'The webhook signature is invalid.',
    });
  }

  if (rawBody.length === 0) {
    throw invalidPayload();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody.toString('utf8'));
  } catch (cause) {
    throw invalidPayload(cause);
  }

  const parseResult = paymentWebhookPayloadSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    throw invalidPayload(parseResult.error.flatten());
  }
  const body = parseResult.data;

  const outcome = EVENT_OUTCOMES[body.event];
  if (!outcome) {
    return;
  }

  const providerOrderId = body.payload.payment.entity.order_id;
  const providerPaymentId = body.payload.payment.entity.id;

  const result = await prisma.$transaction(async (tx) => {
    const resolved = await paymentRecordService.resolvePaymentByOrderId(
      tx,
      providerOrderId,
      outcome,
      providerPaymentId,
    );

    if (resolved.outcome !== 'resolved') {
      return resolved;
    }

    // Dispatch by transactionType, not merely by which of rideId/bookingId
    // is set: a booking now funds two different transaction types over its
    // lifetime (BOOKING_PREPAYMENT at creation, FINAL_PAYMENT at ride
    // completion), each needing a different entity transition.
    let applied: boolean;
    if (resolved.transactionType === 'DRIVER_RIDE_FEE' && resolved.rideId) {
      applied = await rideService.resolvePostingFeeOutcome(tx, resolved.rideId, outcome);
    } else if (resolved.transactionType === 'BOOKING_PREPAYMENT' && resolved.bookingId) {
      applied = await bookingService.resolvePaymentOutcome(tx, resolved.bookingId, outcome);
    } else if (resolved.transactionType === 'FINAL_PAYMENT' && resolved.bookingId) {
      applied = await bookingService.resolveFinalPaymentOutcome(tx, resolved.bookingId, outcome);
    } else {
      // Defensive: recordOrder/recordRefundFor* always pair a transactionType
      // with the matching id (DRIVER_RIDE_FEE + rideId, BOOKING_PREPAYMENT/
      // FINAL_PAYMENT + bookingId) — REFUND transactions are resolved by
      // refundService, never by this webhook.
      applied = false;
    }

    return { ...resolved, applied };
  });

  if (result.outcome === 'not_found') {
    // Our own Payment write may not have committed yet (§11: "a genuine
    // crash window ... orphan order ... resolves if the write landed").
    // Retry-worthy, so this must NOT be 200.
    throw new AppError({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
      message: 'No matching payment order was found.',
    });
  }

  if (result.outcome === 'already_resolved') {
    return;
  }

  if (result.bookingId) {
    await cancelScheduledBookingExpiry(result.bookingId).catch((error) => {
      console.error(
        `[webhook] failed to cancel the scheduled expiry job for booking ${result.bookingId}`,
        error,
      );
    });
  }

  if (!result.applied) {
    // The money genuinely moved (Payment/Transaction are correctly resolved)
    // but the ride/booking had already moved on from the state this
    // transition expected by some other path (e.g. the TTL expiry beat a
    // BOOKING_PREPAYMENT webhook to it) — flagged for manual review rather
    // than silently dropped. (resolveFinalPaymentOutcome's own FAILED branch
    // never reaches here — it returns `true` and logs its own message.)
    console.error(
      `[webhook] payment ${result.paymentId} resolved ${outcome} but its ` +
        `${result.rideId ? `ride ${result.rideId}` : `booking ${result.bookingId}`} ` +
        'had already moved on — needs manual review (no automatic refund exists yet).',
    );
  }
}
