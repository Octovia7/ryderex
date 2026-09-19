import { z } from 'zod';

export const rejectVehicleSchema = z.object({
  rejectionReason: z.string().trim().min(1),
});

export type RejectVehicleInput = z.infer<typeof rejectVehicleSchema>;
