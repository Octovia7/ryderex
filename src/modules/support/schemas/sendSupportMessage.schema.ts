import { z } from 'zod';
import { config } from '../../../config';

// Cost control (architecture.md §17): message length is one of the
// chatbot's bounded resources, alongside the history window and tool-round
// budget — env-configurable (`SUPPORT_CHAT_MAX_MESSAGE_LENGTH`), never a
// hard-coded literal duplicated here.
export const sendSupportMessageSchema = z.object({
  content: z.string().trim().min(1).max(config.supportChat.maxMessageLength),
});

export type SendSupportMessageInput = z.infer<typeof sendSupportMessageSchema>;
