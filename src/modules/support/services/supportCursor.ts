import { AppError } from '../../../shared/AppError';

// The keyset position of the last row on a page: a timestamp value and the
// row's own `id` as the tie-breaker. Named generically (`value`, not
// `createdAt`) because this one cursor module serves BOTH
// `GET /support/conversations` (keyed on `lastMessageAt`) and the message
// history embedded in `GET /support/conversations/:id` (keyed on
// `createdAt`) — the cursor is opaque to the client either way, so the
// underlying column it represents is never part of its shape.
export interface SupportCursor {
  value: Date;
  id: string;
}

const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

export function encodeSupportCursor(cursor: SupportCursor): string {
  return Buffer.from(JSON.stringify({ value: cursor.value.toISOString(), id: cursor.id })).toString(
    'base64url',
  );
}

export function decodeSupportCursor(raw: unknown): SupportCursor {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_CURSOR_LENGTH ||
    !BASE64URL.test(raw)
  ) {
    throw invalidCursor();
  }

  const json = Buffer.from(raw, 'base64url').toString('utf8');

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

  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'value') {
    throw invalidCursor();
  }

  const { value, id } = parsed as Record<string, unknown>;

  if (typeof value !== 'string' || typeof id !== 'string') {
    throw invalidCursor();
  }

  if (!isTimestamp(value) || !UUID.test(id)) {
    throw invalidCursor();
  }

  return { value: new Date(value), id };
}
