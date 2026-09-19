import { z } from 'zod';

export const driverApplicationParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type DriverApplicationParams = z.infer<typeof driverApplicationParamsSchema>;
