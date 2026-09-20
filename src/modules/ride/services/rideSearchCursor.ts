import { AppError } from '../../../shared/AppError';
import type { SearchSort } from '../schemas/searchRides.schema';

// The keyset position of the last row on a page: the value of the sort
// expression for that row, and its id (the unique tie-breaker). Both are
// kept as text — exactly as PostgreSQL rendered them — so nothing is lost or
// rounded on the way back into the query.
export interface SearchCursor {
  value: string;
  id: string;
}

const MAX_CURSOR_LENGTH = 512;
const MAX_VALUE_LENGTH = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: 'INVALID_CURSOR',
    message: 'The pagination cursor is not valid.',
  });
}

// The value is cast in SQL (`::timestamptz`, `::double precision`,
// `::numeric`), and casting malformed text is a database error — a 500 — not
// a rejected cursor. So a value has to be proven well-formed for its sort
// BEFORE it can reach a query. These accept exactly the text the query itself
// produces, and nothing else.

// `YYYY-MM-DDTHH:MM:SS.mmmZ`, and a real instant: `new Date` rolls an
// impossible day over rather than failing, so the round trip must match.
const TIMESTAMP = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isTimestamp(value: string): boolean {
  if (!TIMESTAMP.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

// A plain decimal, as a numeric column renders it. No exponent, and short
// enough that a hostile value cannot make the database chew on a huge number.
function isNumeric(value: string): boolean {
  return /^-?\d{1,20}(\.\d{1,10})?$/.test(value);
}

// A double, as PostgreSQL renders one: a plain decimal, or with an exponent
// (very small distances print as e.g. `1.5e-05`). It must also survive the
// cast: a value that overflows to Infinity, or that underflows to zero
// although its digits are non-zero, is an out-of-range error in PostgreSQL.
function isFloat(value: string): boolean {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d{1,3})?$/.test(value)) {
    return false;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return false;
  }

  const mantissa = value.split(/[eE]/)[0] ?? '';
  return parsed !== 0 || !/[1-9]/.test(mantissa);
}

const VALUE_VALIDATORS: Record<SearchSort, (value: string) => boolean> = {
  DEPARTURE_TIME: isTimestamp,
  PICKUP_DISTANCE: isFloat,
  DESTINATION_DISTANCE: isFloat,
  FARE: isNumeric,
  DRIVER_RATING: isNumeric,
};

// base64url(JSON.stringify({ sort, value, id })). Opaque to the client: it
// carries no SQL and no query state, only a position — and it is meant to be
// handed back verbatim, never parsed or built by a consumer.
export function encodeSearchCursor(sort: SearchSort, cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify({ sort, value: cursor.value, id: cursor.id })).toString(
    'base64url',
  );
}

// Anything that is not exactly a cursor this endpoint could have issued for
// THIS sort is refused with INVALID_CURSOR: malformed, tampered, wrong shape,
// or minted for a different sort (whose value would be the wrong type for the
// keyset comparison). A cursor is a position, not a credential — so it is
// validated for form, not signed.
export function decodeSearchCursor(raw: unknown, sort: SearchSort): SearchCursor {
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

  if (keys.length !== 3 || keys[0] !== 'id' || keys[1] !== 'sort' || keys[2] !== 'value') {
    throw invalidCursor();
  }

  const { sort: cursorSort, value, id } = parsed as Record<string, unknown>;

  if (cursorSort !== sort || typeof value !== 'string' || typeof id !== 'string') {
    throw invalidCursor();
  }

  if (value.length > MAX_VALUE_LENGTH || !VALUE_VALIDATORS[sort](value) || !UUID.test(id)) {
    throw invalidCursor();
  }

  return { value, id };
}
