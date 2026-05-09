/**
 * Business calendar & query bounds for Bangladesh (UTC+6, no DST).
 * Date-only API strings `YYYY-MM-DD` are interpreted as Dhaka civil days.
 */

export const APP_TIMEZONE = 'Asia/Dhaka';

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsYmd(ymd: string): [y: number, m: number, d: number] | null {
  const m = YMD.exec(ymd.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** Start of calendar day in Bangladesh → UTC `Date` (for Prisma DateTime filters). */
export function bdDayStartUtc(ymd: string): Date {
  const p = partsYmd(ymd);
  if (!p) return new Date(ymd);
  const [y, mo, d] = p;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - BD_OFFSET_MS);
}

/** End of calendar day in Bangladesh → UTC `Date`. */
export function bdDayEndUtc(ymd: string): Date {
  const p = partsYmd(ymd);
  if (!p) return new Date(ymd);
  const [y, mo, d] = p;
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - BD_OFFSET_MS);
}

/** `YYYY-MM` bucket in Dhaka for a stored UTC instant. */
export function yearMonthKeyBd(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}
