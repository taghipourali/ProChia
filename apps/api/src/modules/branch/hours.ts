import { tehranParts } from '@prochia/shared';
import type { OpeningHours } from '../../db/schema/tenancy';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Whether the branch is open at an instant. No hours configured means always open. */
export function isOpenAt(hours: OpeningHours, at: Date): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;
  const p = tehranParts(at);
  const minutes = p.hour * 60 + p.minute;
  const key = (d: number) => String(d) as keyof OpeningHours;

  for (const [open, close] of hours[key(p.weekday)] ?? []) {
    const o = toMinutes(open);
    const c = toMinutes(close);
    if (c > o ? minutes >= o && minutes < c : minutes >= o) return true;
  }
  // Ranges that cross midnight (e.g. 18:00–01:00) continue into the next day.
  for (const [open, close] of hours[key((p.weekday + 6) % 7)] ?? []) {
    const o = toMinutes(open);
    const c = toMinutes(close);
    if (c <= o && minutes < c) return true;
  }
  return false;
}
