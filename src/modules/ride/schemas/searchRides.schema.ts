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

// Every sort is ascending and ends with `id` as a unique tie-breaker (see
// rideSearchRepository), so page boundaries can never skip or repeat a row.
export const SEARCH_SORTS = [
  'DEPARTURE_TIME',
  'PICKUP_DISTANCE',
  'DESTINATION_DISTANCE',
  'FARE',
  'DRIVER_RATING',
] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

export const searchRidesQuerySchema = z.object({
  date: z.string().refine(isValidCalendarDate, {
    message: 'must be a valid calendar date in YYYY-MM-DD format',
  }),
  pickupLat: decimal(-90, 90),
  pickupLng: decimal(-180, 180),
  destinationLat: decimal(-90, 90),
  destinationLng: decimal(-180, 180),
  // The client only ever sends the enum value, never SQL: the repository maps
  // each one to a fixed expression. Anything outside the enum is rejected here.
  sort: z.enum(SEARCH_SORTS).default('DEPARTURE_TIME'),
  // Declared so it survives parsing (Zod would otherwise strip the key and a
  // supplied cursor would be silently treated as "no cursor"), but validated
  // by the service, not here: a bad cursor is INVALID_CURSOR, not
  // VALIDATION_ERROR, and whether it is valid depends on the requested sort.
  // Loosely typed on purpose, so every form of a supplied cursor (empty,
  // repeated, malformed) reaches that one check and is refused alike.
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
