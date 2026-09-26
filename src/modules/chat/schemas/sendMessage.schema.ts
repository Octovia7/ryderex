import { z } from 'zod';

// The `send_message` socket event's payload. No maximum length is specified
// anywhere in the canonical docs for a chat message — only non-empty is
// validated, the same way no length limit exists for a rating comment.
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1),
});

export type SendMessagePayload = z.infer<typeof sendMessageSchema>;
