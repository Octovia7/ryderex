import { apiFetch } from './client';

// Verified against src/modules/rating/schemas/submitRating.schema.ts.
// `score` must be an integer 1-5; `comment` is optional with no length
// limit. There is no `rateeId` field — the backend always derives the
// direction (and who is being rated) from (booking, authenticated caller),
// so it can never be supplied here.
export interface SubmitRatingInput {
  score: number;
  comment?: string;
}

// Verified against src/modules/rating/ratingRepository.ts's RatingRecord.
// Ratings are immutable — there is no update/delete endpoint, so this is
// the only shape a rating is ever returned in.
export interface Rating {
  id: string;
  bookingId: string;
  rideId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

// GET /api/v1/bookings/:id/ratings — role-gated PASSENGER+DRIVER
// server-side; participant-only (404 BOOKING_NOT_FOUND for anyone else, the
// same IDOR convention every other booking route uses). Returns every
// rating recorded against this booking (at most two: passenger->driver and
// driver->passenger), oldest first.
export function listRatingsForBooking(
  bookingId: string,
  accessToken?: string | null,
): Promise<Rating[]> {
  return apiFetch(`/bookings/${bookingId}/ratings`, { accessToken });
}

// POST /api/v1/bookings/:id/ratings — same participant gate as above.
// Eligibility is gated on the RIDE's status, not the booking's: 409
// RIDE_NOT_COMPLETED unless the ride has reached COMPLETED. A second
// submission by the same rater for the same booking is rejected with 409
// ALREADY_RATED (the database's own unique (bookingId, raterId)
// constraint). This is the authoritative check — nothing client-side may
// substitute for it.
export function submitRating(
  bookingId: string,
  input: SubmitRatingInput,
  accessToken?: string | null,
): Promise<Rating> {
  return apiFetch(`/bookings/${bookingId}/ratings`, {
    method: 'POST',
    body: input,
    accessToken,
  });
}
