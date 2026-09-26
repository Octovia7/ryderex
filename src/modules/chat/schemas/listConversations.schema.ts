import { z } from 'zod';

const DEFAULT_LIMIT = 20;

export const listConversationsQuerySchema = z.object({
  // Declared so it survives parsing (Zod would otherwise strip the key and a
  // supplied cursor would be silently treated as "no cursor"), but validated
  // by the service, not here — a bad cursor is INVALID_CURSOR, not
  // VALIDATION_ERROR (same split as searchRidesQuerySchema.cursor).
  cursor: z.unknown().optional(),
  // A `limit` above the service's own ceiling is clamped, not rejected — only
  // a non-positive or non-numeric one is an error.
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(DEFAULT_LIMIT),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
