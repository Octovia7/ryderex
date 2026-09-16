import { z } from 'zod';

export const vehicleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type VehicleIdParams = z.infer<typeof vehicleIdParamsSchema>;
