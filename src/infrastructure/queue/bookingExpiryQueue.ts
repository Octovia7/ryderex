import { Queue } from 'bullmq';
import { config } from '../../config';
import { queueConnection } from './queueConnection';
import { withQueueDeadline } from './withQueueDeadline';

export const BOOKING_EXPIRY_QUEUE_NAME = 'booking-expiry';
export const EXPIRE_BOOKING_JOB_NAME = 'expire-booking';

export interface ExpireBookingJobData {
  bookingId: string;
}

export const bookingExpiryQueue = new Queue<ExpireBookingJobData>(BOOKING_EXPIRY_QUEUE_NAME, {
  connection: queueConnection,
});

// Scheduled once, at booking creation, delayed by the configured hold TTL.
// `jobId = bookingId` is the natural key BullMQ dedupes delayed jobs on, so
// re-scheduling the same booking is a no-op rather than a duplicate job.
//
// No `attempts` option is set: the default of 1 (no automatic retry) is
// deliberate here — the handler is a single idempotent DB operation, safe to
// re-run by any later mechanism (a manual re-trigger, a future retroactive
// re-schedule), but a genuine failure should surface once for investigation
// rather than retry against a possibly-still-broken dependency.
//
// `withQueueDeadline` (Phase 15 Pass 1 finding): called from a request
// handler immediately after the seat-reservation transaction has already
// committed — this must resolve or reject within a bound, never hang the
// response, regardless of `queueConnection`'s own health.
export function scheduleBookingExpiry(bookingId: string) {
  return withQueueDeadline(
    bookingExpiryQueue.add(
      EXPIRE_BOOKING_JOB_NAME,
      { bookingId },
      { jobId: bookingId, delay: config.booking.paymentTtlSeconds * 1000 },
    ),
  );
}
