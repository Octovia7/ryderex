import { z } from 'zod';
import { VehicleType } from '../../../generated/prisma/enums';

function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

// verificationStatus/verifiedBy/verifiedAt/rejectionReason/status are
// server-controlled and never accepted here — a client attempt to set them
// is silently stripped by Zod's default non-strict parsing, not an error.
export const updateVehicleSchema = z
  .object({
    registrationNumber: z.string().trim().min(1).transform(normalizeRegistrationNumber).optional(),
    vehicleType: z.nativeEnum(VehicleType).optional(),
    seatCapacity: z.number().int().positive().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
