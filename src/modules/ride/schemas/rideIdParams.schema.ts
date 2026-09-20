import { z } from 'zod';

export const rideIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type RideIdParams = z.infer<typeof rideIdParamsSchema>;
