import { toGregorian, toJalaali, isValidJalaaliDate, jalaaliMonthLength } from 'jalaali-js';
import { toEnDigits, toFaDigits } from './fa';

/** Iran has had a fixed UTC+03:30 offset since DST was abolished in 2022. */
export const TEHRAN_TZ = 'Asia/Tehran';

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** Saturday-first, as Iranian calendars are laid out. Index matches `Date.getDay()` via WEEKDAY_ORDER. */
export const WEEKDAYS_FA = [
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
  'شنبه',
] as const;
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export interface TehranParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday, like Date.getDay()
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock parts of an instant in Tehran, independent of the host timezone. */
export function tehranParts(date: Date): TehranParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday!] ?? 0,
  };
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export function toJalali(date: Date): JalaliDate {
  const p = tehranParts(date);
  return toJalaali(p.year, p.month, p.day);
}

/** Gregorian ISO date (YYYY-MM-DD) for a Jalali date — the form we store in `date` columns. */
export function jalaliToIsoDate({ jy, jm, jd }: JalaliDate): string {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

export function isoDateToJalali(iso: string): JalaliDate {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return toJalaali(y, m, d);
}

/** Parses "۱۳۷۵/۲/۱۴", "1375-02-14" etc. Returns null when the date does not exist. */
export function parseJalali(input: string): JalaliDate | null {
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(toEnDigits(input.trim()));
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidJalaaliDate(jy, jm, jd) ? { jy, jm, jd } : null;
}

export function formatJalali(
  value: Date | JalaliDate,
  style: 'numeric' | 'long' | 'dayMonth' = 'numeric',
): string {
  const j = value instanceof Date ? toJalali(value) : value;
  if (style === 'long') return toFaDigits(`${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`);
  if (style === 'dayMonth') return toFaDigits(`${j.jd} ${JALALI_MONTHS[j.jm - 1]}`);
  return toFaDigits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
}

export function formatTime(date: Date): string {
  const p = tehranParts(date);
  return toFaDigits(`${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`);
}

export function formatDateTime(date: Date): string {
  return `${formatJalali(date, 'dayMonth')}، ساعت ${formatTime(date)}`;
}

/** "۵ دقیقه پیش" style relative time, for order boards and activity lists. */
export function formatAgo(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${toFaDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toFaDigits(hours)} ساعت پیش`;
  return formatJalali(date, 'dayMonth');
}

/** The instant at a Tehran wall-clock time. */
export function tehranDateTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00+03:30`);
}

/** Today's Gregorian ISO date in Tehran. */
export function tehranIsoDate(date: Date = new Date()): string {
  const p = tehranParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { jalaaliMonthLength as jalaliMonthLength };
