import { z } from 'zod';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// `seats` is bound into SQL as an int4, so anything beyond that is a database
// error (a 500), not a rejected request. Whether the ride actually has that many
// seats is the conditional UPDATE's job (409 NO_SEATS_AVAILABLE), not this.
const MAX_SEATS = 2_147_483_647;

// Unknown keys are stripped, so a client can never supply `passengerId`,
// `status`, `farePerSeat`, `totalFare` or `prepaidAmount` — the passenger comes
// from the token, and every amount is derived from the ride's own fare.
//
// The pickup and drop points are each optional, and independently so: a missing
// pickup defaults to the ride's origin, a missing drop to its destination. A
// latitude without its longitude (or the reverse) is half a point, so is refused.
export const createBookingSchema = z
  .object({
    seats: z.number().int().min(1).max(MAX_SEATS),
    pickupLat: latitude.optional(),
    pickupLng: longitude.optional(),
    dropLat: latitude.optional(),
    dropLng: longitude.optional(),
  })
  .refine((body) => (body.pickupLat === undefined) === (body.pickupLng === undefined), {
    message: 'pickupLat and pickupLng must be provided together',
    path: ['pickupLat'],
  })
  .refine((body) => (body.dropLat === undefined) === (body.dropLng === undefined), {
    message: 'dropLat and dropLng must be provided together',
    path: ['dropLat'],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
