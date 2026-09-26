import { z } from 'zod';

// The `join_conversation` socket event's payload — validated the same way a
// REST `:id` param would be (claude.md §11: "Every `:id` route needs
// validateParams... an unvalidated one reaches the driver as a raw 500"),
// just via a Zod schema the gateway calls directly instead of Express
// middleware, since there is no middleware chain for socket events.
export const joinConversationSchema = z.object({
  conversationId: z.string().uuid(),
});

export type JoinConversationPayload = z.infer<typeof joinConversationSchema>;
