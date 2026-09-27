import { z } from 'zod';

export const supportConversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type SupportConversationIdParams = z.infer<typeof supportConversationIdParamsSchema>;
