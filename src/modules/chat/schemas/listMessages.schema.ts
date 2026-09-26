import { z } from 'zod';

const DEFAULT_LIMIT = 20;

export const listMessagesQuerySchema = z.object({
  cursor: z.unknown().optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(DEFAULT_LIMIT),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
