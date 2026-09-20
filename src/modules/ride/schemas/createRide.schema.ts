import { z } from 'zod';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// Unknown keys are stripped, so a client can never supply `driverId`,
// `farePerSeat`, `postingCommissionAmount`, `availableSeats` or `status` —
// those are derived server-side, never trusted from the body.
export const createRideSchema = z.object({
  vehicleId: z.string().uuid(),
  originLat: latitude,
  originLng: longitude,
  destinationLat: latitude,
  destinationLng: longitude,
  // An ISO-8601 instant with an explicit offset — the column is Timestamptz,
  // and an offset-less wall-clock time would be silently misread.
  departureTime: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now(), {
      message: 'departureTime must be in the future',
    }),
  // Capacity is enforced against the vehicle (409 VEHICLE_NOT_ELIGIBLE), not here.
  totalSeats: z.number().int().positive(),
});

export type CreateRideInput = z.infer<typeof createRideSchema>;
