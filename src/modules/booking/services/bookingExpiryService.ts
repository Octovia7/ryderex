import { prisma } from '../../../infrastructure/database/prismaClient';
import * as rideService from '../../ride/services/rideService';
import * as bookingRepository from '../repositories/bookingRepository';

// Runs when a booking's seat-hold TTL fires. Unlike a passenger's own cancel,
// there is no ownership check — the job is system-initiated and trusts the
// bookingId it was scheduled with, the same way it trusts its own `jobId`.
//
//  1. Read the booking. This is ADVISORY, exactly like cancelBooking's own
//     pre-read: it exists only to learn the (immutable) rideId and seat count
//     needed to release seats. If the booking is gone entirely (should not
//     happen — nothing ever deletes one), there is nothing to do.
//  2. In one transaction: the conditional expiry (PENDING_PAYMENT ->
//     CANCELLED via bookingRepository.expireIfPending), and only if it
//     applied, the seat release through the ride-service boundary — the
//     booking module still never touches rideRepository directly. Gating the
//     release on the transition having actually applied is what makes this
//     safe to run any number of times: a booking already confirmed, failed,
//     or cancelled by the time this job runs matches nothing, and its seats
//     are never released a second time.
//  3. A release that cannot be applied is the one thing that throws inside
//     the transaction — an invariant violation, not a normal outcome — which
//     rolls the expiry back with it rather than leaving a booking cancelled
//     with its seats leaked.
//
// No external call is made here: this step is a pure DB operation, which is
// exactly why its queue entry needs no retry budget beyond BullMQ's default.
export async function processBookingExpiry(bookingId: string): Promise<void> {
  const booking = await bookingRepository.findById(bookingId);

  if (!booking) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const expired = await bookingRepository.expireIfPending(tx, bookingId);

    if (!expired) {
      // Already confirmed, failed, or cancelled by the time the job ran — a
      // no-op, not an error. The job is safe to run any number of times.
      return;
    }

    const released = await rideService.releaseSeats(tx, booking.rideId, booking.seats);

    if (!released) {
      throw new Error(`Seat release failed for expiring booking ${bookingId}; expiry rolled back.`);
    }
  });
}
