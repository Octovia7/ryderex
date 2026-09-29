import { z } from 'zod';

// Unknown keys are stripped, so a client can never supply `raterId`/`rateeId` —
// both are always derived from the authenticated session plus the booking,
// never sent (architecture.md's Ratings section: "there is no rateeId field
// to spoof"). No maximum length on `comment` — the same "no length limit"
// choice already made for a chat message (chat/schemas/sendMessage.schema.ts).
export const submitRatingSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().optional(),
});

export type SubmitRatingInput = z.infer<typeof submitRatingSchema>;
