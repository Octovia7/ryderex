import { z } from 'zod';

export const vehicleParamsSchema = z.object({
  id: z.string().uuid(),
});

export type VehicleParams = z.infer<typeof vehicleParamsSchema>;
