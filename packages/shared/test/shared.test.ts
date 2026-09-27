import { describe, expect, it } from 'vitest';
import {
  bmi,
  bmiBand,
  computeDailyTargets,
  formatJalali,
  formatNumber,
  formatToman,
  jalaliToIsoDate,
  mealTarget,
  normalizeIranMobile,
  parseJalali,
  tehranDateTime,
  tehranIsoDate,
  toEnDigits,
  toJalali,
} from '../src';

describe('Persian formatting', () => {
  it('groups thousands with the Persian separator and Persian digits', () => {
    expect(formatNumber(385000)).toBe('۳۸۵٬۰۰۰');
    expect(formatToman(1250000)).toBe('۱٬۲۵۰٬۰۰۰ تومان');
    expect(formatNumber(12.5, 1)).toBe('۱۲٫۵');
    expect(formatNumber(12, 1)).toBe('۱۲');
  });

  it('normalizes typed digits', () => {
    expect(toEnDigits('۰۹۱۲۳٤٥٦')).toBe('09123456');
  });

  it('normalizes Iranian mobile numbers', () => {
    expect(normalizeIranMobile('۰۹۱۲ ۳۴۵ ۶۷۸۹')).toBe('09123456789');
    expect(normalizeIranMobile('+989123456789')).toBe('09123456789');
    expect(normalizeIranMobile('00989123456789')).toBe('09123456789');
    expect(normalizeIranMobile('9123456789')).toBe('09123456789');
    expect(normalizeIranMobile('02112345678')).toBeNull();
  });
});

describe('Jalali calendar', () => {
  it('converts in the Tehran timezone, not the host timezone', () => {
    // 1 Farvardin 1405 = 21 March 2026. 22:00 UTC on 20 March is already 01:30 on the 21st in Tehran.
    expect(toJalali(new Date('2026-03-20T22:00:00Z'))).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(tehranIsoDate(new Date('2026-03-20T22:00:00Z'))).toBe('2026-03-21');
  });

  it('parses and validates typed dates', () => {
    expect(parseJalali('۱۳۷۵/۲/۱۴')).toEqual({ jy: 1375, jm: 2, jd: 14 });
    expect(parseJalali('1404-12-30')).toBeNull(); // 1404 is not a leap year
    expect(jalaliToIsoDate({ jy: 1375, jm: 2, jd: 14 })).toBe('1996-05-03');
  });

  it('formats with Persian digits', () => {
    expect(formatJalali({ jy: 1405, jm: 7, jd: 5 }, 'long')).toBe('۵ مهر ۱۴۰۵');
    expect(formatJalali({ jy: 1405, jm: 7, jd: 5 })).toBe('۱۴۰۵/۰۷/۰۵');
  });

  it('builds Tehran wall-clock instants', () => {
    expect(tehranDateTime('2026-09-27', '19:30').toISOString()).toBe('2026-09-27T16:00:00.000Z');
  });
});

describe('Body metrics and targets', () => {
  it('computes BMI bands', () => {
    const value = bmi(180, 81);
    expect(value).toBeCloseTo(25, 1);
    expect(bmiBand(value)).toBe('over');
    expect(bmiBand(22)).toBe('normal');
  });

  it('builds cutting targets with a deficit and high protein', () => {
    const t = computeDailyTargets({
      sex: 'male',
      age: 28,
      heightCm: 180,
      weightKg: 85,
      activity: 'high',
      goal: 'cut',
    });
    // Mifflin–St Jeor: 10*85 + 6.25*180 - 5*28 + 5 = 1840
    expect(t.bmr).toBe(1840);
    expect(t.tdee).toBe(Math.round(1840 * 1.725));
    expect(t.kcal).toBeLessThan(t.tdee);
    expect(t.protein).toBe(Math.round(85 * 2.2));
    // Macros add back up to the energy target (within rounding).
    expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal)).toBeLessThan(20);
  });

  it('uses lean mass when body fat is known', () => {
    const withFat = computeDailyTargets({
      sex: 'female',
      age: 30,
      heightCm: 165,
      weightKg: 60,
      bodyFatPct: 22,
      activity: 'moderate',
      goal: 'maintain',
    });
    expect(withFat.bmr).toBe(Math.round(370 + 21.6 * 60 * 0.78));
  });

  it('caps protein reference weight for high BMI', () => {
    const t = computeDailyTargets({
      sex: 'male',
      age: 35,
      heightCm: 175,
      weightKg: 130,
      activity: 'light',
      goal: 'cut',
    });
    expect(t.protein).toBe(Math.round(27 * 1.75 * 1.75 * 2.2));
  });

  it('splits the day into slot targets', () => {
    const post = mealTarget({ kcal: 2400, protein: 180, carbs: 250, fat: 70 }, 'post_workout');
    expect(post).toEqual({ kcal: 720, protein: 54, carbs: 88, fat: 14 });
    expect(mealTarget({ kcal: 2400, protein: 180, carbs: 250, fat: 70 }, 'meal', 4).kcal).toBe(600);
  });
});
