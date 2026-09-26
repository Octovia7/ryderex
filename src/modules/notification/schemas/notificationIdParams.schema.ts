import { z } from 'zod';

export const notificationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type NotificationIdParams = z.infer<typeof notificationIdParamsSchema>;
