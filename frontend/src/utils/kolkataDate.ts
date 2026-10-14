// Mirrors the backend's own reasoning (src/utils/kolkataDate.ts): India has
// used a fixed UTC+05:30 offset with no DST since 1945, so dates are always
// computed in Asia/Kolkata specifically, never the browser's local zone —
// a user searching from outside India must still get India's "today".

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// en-CA formats as YYYY-MM-DD directly — exactly the backend's expected
// `date` query param shape (src/modules/ride/schemas/searchRides.schema.ts).
export function kolkataDateString(date: Date): string {
  return formatter.format(date);
}

export function kolkataToday(): Date {
  return new Date();
}

export interface DateOption {
  dateStr: string;
  label: string;
  sub: string;
}

export function upcomingKolkataDates(count: number): DateOption[] {
  const base = kolkataToday();
  const options: DateOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = kolkataDateString(d);
    const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d);
    const monthDay = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit' }).format(d);
    options.push({
      dateStr,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday,
      sub: monthDay,
    });
  }
  return options;
}
