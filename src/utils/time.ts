/**
 * Timezone helpers. Trip departure times are wall-clock times in Africa/Kigali,
 * which is UTC+2 year-round (Rwanda observes no daylight saving), so a fixed
 * offset is exact and dependency-free. All instants are stored in UTC.
 *
 * `@db.Date` columns (starts_on/ends_on) come back from Prisma as a Date at UTC
 * midnight whose calendar Y-M-D IS the local Kigali date — treat them as "local
 * days" via localDayKey/addLocalDays.
 */

export const TZ_OFFSET_MIN = 120; // Africa/Kigali = UTC+2, no DST

const OFFSET_MS = TZ_OFFSET_MIN * 60_000;

/**
 * The UTC instant for a wall-clock "HH:MM" on a given local calendar day.
 * `localDay` carries the Kigali Y-M-D at UTC midnight (e.g. a @db.Date value).
 * Kigali wall clock = UTC + offset, so UTC = wall − offset.
 */
export const localWallTimeToUtc = (localDay: Date, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  const y = localDay.getUTCFullYear();
  const mo = localDay.getUTCMonth();
  const d = localDay.getUTCDate();
  return new Date(Date.UTC(y, mo, d, h ?? 0, m ?? 0, 0, 0) - OFFSET_MS);
};

/** The Kigali calendar day (UTC-midnight Date) that a UTC instant falls on. */
export const utcToLocalDay = (utc: Date): Date => {
  const shifted = new Date(utc.getTime() + OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

/** Add `n` whole days to a local-day Date (UTC-midnight, calendar-safe). */
export const addLocalDays = (localDay: Date, n: number): Date =>
  new Date(Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate() + n));

/**
 * UTC bounds of a Kigali calendar day for a "YYYY-MM-DD" (or ISO) date string.
 * Used by trip search so "date=2026-06-15" means the Kigali day, not a UTC day.
 */
export const localDayBoundsUtc = (dateStr: string): { start: Date; end: Date } => {
  const d = new Date(dateStr);
  const localDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = localWallTimeToUtc(localDay, '00:00');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};
