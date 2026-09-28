import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prismaClient';
import { AppError } from '../../shared/AppError';
import * as bookingService from '../booking/services/bookingService';
import * as rideService from '../ride/services/rideService';
import * as ratingRepository from './ratingRepository';
import type { RateeRole, RatingRecord } from './ratingRepository';

export interface SubmitRatingInput {
  score: number;
  comment?: string | null;
}

function rideNotCompleted(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'RIDE_NOT_COMPLETED',
    message: 'This ride has not been completed yet.',
  });
}

function alreadyRated(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ALREADY_RATED',
    message: 'You have already rated this trip.',
  });
}

// The database's own `(booking_id, rater_id)` unique constraint is the sole
// duplicate guard (architecture.md's Ratings section) — never a pre-insert
// SELECT, which would only race with a concurrent identical submission
// anyway. This is the one place that translates Prisma's own P2002 into the
// API-facing error; nothing about the constraint itself is exposed further
// up.
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// One function serves both rating directions, because the direction is
// DERIVED from (booking, req.user.id), never declared by the caller
// (architecture.md "Ratings — the same two mechanisms, applied to an
// aggregate": "there is no rateeId field to spoof").
//
// Reuses `bookingService.getBooking`'s own existing "booking exists AND
// caller is a participant" check rather than re-implementing it: a
// non-participant already gets `404 BOOKING_NOT_FOUND` there — the same
// IDOR convention (existence never leaked to anyone not already allowed to
// see the booking) every other resource in this codebase uses — so this
// service needs no authorization logic of its own beyond deriving which
// participant the caller is.
export async function submitRating(
  raterId: string,
  bookingId: string,
  input: SubmitRatingInput,
): Promise<RatingRecord> {
  const booking = await bookingService.getBooking(raterId, bookingId);
  const ride = await rideService.getRideForBooking(booking.rideId, prisma);

  const isPassengerRating = booking.passengerId === raterId;
  const rateeId = isPassengerRating ? ride.driverId : booking.passengerId;
  const role: RateeRole = isPassengerRating ? 'DRIVER' : 'PASSENGER';

  // Eligibility gates on the RIDE, deliberately not the booking
  // (architecture.md: no reconciliation job exists to recover a payment
  // whose webhook never arrived, so gating on the booking would make a trip
  // permanently unrateable for a passenger who did nothing wrong).
  if (ride.status !== 'COMPLETED') {
    throw rideNotCompleted();
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const rating = await ratingRepository.create(tx, {
        bookingId,
        rideId: booking.rideId,
        raterId,
        rateeId,
        score: input.score,
        comment: input.comment ?? null,
      });

      // Same transaction as the insert above — a duplicate rejected by the
      // unique constraint rolls the aggregate back with it, so a rating can
      // never be counted without the row that represents it existing too.
      await ratingRepository.applyToAggregate(tx, rateeId, role, input.score);

      return rating;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw alreadyRated();
    }
    throw error;
  }
}
