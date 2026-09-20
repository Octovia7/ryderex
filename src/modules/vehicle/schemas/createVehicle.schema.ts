import { z } from 'zod';
import { VehicleType } from '../../../generated/prisma/enums';

// Uppercased, whitespace/hyphens stripped, so "KA 01 AB 1234" and
// "ka01ab1234" collide as the same registration before the uniqueness check.
function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

export const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(1).transform(normalizeRegistrationNumber),
  vehicleType: z.nativeEnum(VehicleType),
  seatCapacity: z.number().int().positive(),
  // Both optional: shown to passengers in ride search, but a vehicle can be
  // registered without them. Bounded so a search page can't be inflated by
  // an enormous free-text field.
  model: z.string().trim().min(1).max(100).optional(),
  isAc: z.boolean().optional(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
