import { z } from 'zod';

export const listVehiclesQuerySchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
});

export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;
