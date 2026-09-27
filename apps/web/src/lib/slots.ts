import type { OpeningHours } from '@prochia/shared';
import {
  WEEKDAYS_FA,
  addDaysIso,
  formatJalali,
  isOpenAt,
  tehranDateTime,
  tehranIsoDate,
  tehranParts,
} from '@prochia/shared';

export interface DayOption {
  iso: string;
  label: string;
}

/** Pickup days a member can choose: today, tomorrow and the rest up to the branch limit. */
export function preorderDays(now: Date, maxDays: number): DayOption[] {
  const today = tehranIsoDate(now);
  return Array.from({ length: maxDays + 1 }, (_, i) => {
    const iso = addDaysIso(today, i);
    const date = tehranDateTime(iso, '12:00');
    const label =
      i === 0
        ? 'امروز'
        : i === 1
          ? 'فردا'
          : `${WEEKDAYS_FA[tehranParts(date).weekday]} ${formatJalali(date, 'dayMonth')}`;
    return { iso, label };
  });
}

/** 15-minute pickup slots on a day, from the minimum lead time on, within opening hours. */
export function preorderSlots(
  iso: string,
  now: Date,
  minLeadMinutes: number,
  hours: OpeningHours,
): string[] {
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  const slots: string[] = [];
  for (let m = 6 * 60; m < 24 * 60; m += 15) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const at = tehranDateTime(iso, hhmm);
    if (at.getTime() >= earliest && isOpenAt(hours, at)) slots.push(hhmm);
  }
  return slots;
}
