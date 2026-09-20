import { z } from 'zod';
import { isValidCalendarDate } from '../../../utils/kolkataDate';

// Query values arrive as strings. `z.coerce.number()` is deliberately NOT
// used: it turns an empty `?pickupLat=` into 0 and would quietly search the
// equator. A strict decimal pattern is checked first, then converted.
function decimal(min: number, max: number) {
  return z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal number')
    .transform(Number)
    .pipe(z.number().min(min).max(max));
}

const DEFAULT_LIMIT = 20;

export const searchRidesQuerySchema = z.object({
  date: z.string().refine(isValidCalendarDate, {
    message: 'must be a valid calendar date in YYYY-MM-DD format',
  }),
  pickupLat: decimal(-90, 90),
  pickupLng: decimal(-180, 180),
  destinationLat: decimal(-90, 90),
  destinationLng: decimal(-180, 180),
  // Only the default ordering exists so far; the remaining sort orders arrive
  // with the next step. Anything else is rejected here, never passed on.
  sort: z.enum(['DEPARTURE_TIME']).default('DEPARTURE_TIME'),
  // Declared only so it survives parsing and the service can refuse it:
  // Zod would otherwise strip the key and a supplied cursor would be silently
  // treated as "no cursor". Loosely typed on purpose, so every form of a
  // supplied cursor (empty, repeated, plausible-looking) is refused alike.
  cursor: z.unknown().optional(),
  // A `limit` above RIDE_SEARCH_MAX_LIMIT is clamped by the service, not
  // rejected — only a non-positive or non-numeric one is an error.
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(DEFAULT_LIMIT),
});

export type SearchRidesQuery = z.infer<typeof searchRidesQuerySchema>;
