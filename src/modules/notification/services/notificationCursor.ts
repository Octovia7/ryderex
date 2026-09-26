import { AppError } from '../../../shared/AppError';

// The keyset position of the last row on a page: `createdAt` and the row's
// own `id` as the tie-breaker (steps.md §13: "a simpler single-fixed-order
// cursor than ride search's" — GET /notifications has exactly one sort,
// newest-first, so unlike rideSearchCursor.ts there is no `sort` field and
// no per-sort value-type validation).
export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `YYYY-MM-DDTHH:MM:SS.mmmZ`, and a real instant: `new Date` rolls an
// impossible day over rather than failing, so the round trip must match
// (same check as rideSearchCursor.ts's `isTimestamp`).
const TIMESTAMP = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: 'INVALID_CURSOR',
    message: 'The pagination cursor is not valid.',
  });
}

function isTimestamp(value: string): boolean {
  if (!TIMESTAMP.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

// base64url(JSON.stringify({ createdAt, id })). Opaque to the client: it
// carries no SQL and no query state, only a position — meant to be handed
// back verbatim, never parsed or built by a consumer.
export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');
}

// Anything that is not exactly a cursor this endpoint could have issued is
// refused with INVALID_CURSOR: malformed, tampered, or wrong shape. A cursor
// is a position, not a credential — so it is validated for form, not signed.
export function decodeNotificationCursor(raw: unknown): NotificationCursor {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_CURSOR_LENGTH ||
    !BASE64URL.test(raw)
  ) {
    throw invalidCursor();
  }

  const json = Buffer.from(raw, 'base64url').toString('utf8');

  // Decoding is lenient (stray bits and invalid UTF-8 are tolerated), so
  // require the canonical round trip: what we would have issued, byte for byte.
  if (Buffer.from(json, 'utf8').toString('base64url') !== raw) {
    throw invalidCursor();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidCursor();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor();
  }

  const keys = Object.keys(parsed).sort();

  if (keys.length !== 2 || keys[0] !== 'createdAt' || keys[1] !== 'id') {
    throw invalidCursor();
  }

  const { createdAt, id } = parsed as Record<string, unknown>;

  if (typeof createdAt !== 'string' || typeof id !== 'string') {
    throw invalidCursor();
  }

  if (!isTimestamp(createdAt) || !UUID.test(id)) {
    throw invalidCursor();
  }

  return { createdAt: new Date(createdAt), id };
}
