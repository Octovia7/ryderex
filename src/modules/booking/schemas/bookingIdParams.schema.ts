import { z } from 'zod';

export const bookingIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type BookingIdParams = z.infer<typeof bookingIdParamsSchema>;
