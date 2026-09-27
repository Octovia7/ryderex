import { z } from 'zod';

const DEFAULT_LIMIT = 20;

// Query params for the message history embedded in
// `GET /support/conversations/:id` (no separate messages endpoint exists —
// unlike chat).
export const listSupportMessagesQuerySchema = z.object({
  cursor: z.unknown().optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(DEFAULT_LIMIT),
});

export type ListSupportMessagesQuery = z.infer<typeof listSupportMessagesQuerySchema>;
