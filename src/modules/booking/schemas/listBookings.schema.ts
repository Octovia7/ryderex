import { z } from 'zod';

const DEFAULT_LIMIT = 20;

// Mirrors listNotifications.schema.ts exactly: cursor is validated by the
// service (a bad one is INVALID_CURSOR, not VALIDATION_ERROR), and a limit
// above the service's own ceiling is clamped there, not rejected here —
// only a non-positive or non-numeric one is a request error.
export const listBookingsQuerySchema = z.object({
  cursor: z.unknown().optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(DEFAULT_LIMIT),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
