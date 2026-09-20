// India has used one fixed UTC+05:30 offset with no daylight saving since
// 1945, so a hardcoded offset is correct here — not a general timezone
// shortcut. Anywhere that ever needed another zone would need a real
// timezone library instead.
const KOLKATA_OFFSET = '+05:30';
const DAY_MS = 86_400_000;

// A real calendar day in strict YYYY-MM-DD form. `new Date(...)` cannot be
// trusted to reject a bad one: V8 rolls `2026-02-30` over to March 1 instead
// of failing, which would silently search the wrong day. Round-tripping the
// components catches that.
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// The half-open UTC interval [start, end) covering one Asia/Kolkata calendar
// day. Half-open so a ride departing exactly at midnight belongs to exactly
// one day, never both. Callers must have validated `dateStr` first.
export function kolkataDayRangeUtc(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00${KOLKATA_OFFSET}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
