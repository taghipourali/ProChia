import { describe, expect, it } from 'vitest';
import type { Nutrition } from '@prochia/shared';
import {
  recommend,
  slotFor,
  type CandidateItem,
  type RecommendationProfile,
} from '../src/modules/recommendations/engine';

const n = (kcal: number, protein: number, carbs: number, fat: number): Nutrition => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: 0,
  sugar: 0,
  sodium: 0,
});

const menu: CandidateItem[] = [
  {
    id: 'chickenBowl',
    name: 'بول مرغ',
    price: 485_000,
    tags: ['high_protein', 'post_workout'],
    allergens: [],
    nutrition: n(620, 56, 58, 17),
    available: true,
  },
  {
    id: 'pasta',
    name: 'پاستا خامه‌ای',
    price: 400_000,
    tags: [],
    allergens: ['gluten', 'dairy'],
    nutrition: n(900, 22, 95, 45),
    available: true,
  },
  {
    id: 'veganBowl',
    name: 'بول گیاهی',
    price: 390_000,
    tags: ['vegan', 'vegetarian'],
    allergens: [],
    nutrition: n(610, 29, 92, 16),
    available: true,
  },
  {
    id: 'salad',
    name: 'سالاد مرغ',
    price: 450_000,
    tags: ['high_protein', 'low_carb'],
    allergens: ['dairy'],
    nutrition: n(410, 43, 10, 22),
    available: true,
  },
  {
    id: 'espresso',
    name: 'اسپرسو',
    price: 95_000,
    tags: ['caffeine', 'pre_workout'],
    allergens: [],
    nutrition: n(2, 0, 0, 0),
    available: true,
  },
  {
    id: 'soldOut',
    name: 'تمام‌شده',
    price: 1,
    tags: [],
    allergens: [],
    nutrition: n(600, 60, 50, 10),
    available: false,
  },
];

const profile: RecommendationProfile = {
  goal: 'cut',
  targets: { kcal: 2400, protein: 185, carbs: 230, fat: 70 },
  mealsPerDay: 4,
  allergens: [],
  dietPreferences: [],
};
const noSignals = {
  eatenToday: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  orderCounts: new Map(),
  ratings: new Map(),
};

describe('recommend', () => {
  it('ranks high-protein, right-sized meals first after training', () => {
    const [first] = recommend(menu, profile, 'post_workout', noSignals);
    expect(first!.itemId).toBe('chickenBowl');
    expect(first!.reasons[0]).toMatch(/پروتئین/);
  });

  it('never suggests unavailable items or coffee as a main meal', () => {
    const ids = recommend(menu, profile, 'meal', noSignals).map((r) => r.itemId);
    expect(ids).not.toContain('soldOut');
    expect(ids).not.toContain('espresso');
  });

  it('drops items with the member’s allergens and respects diet preferences', () => {
    const dairyFree = recommend(menu, { ...profile, allergens: ['dairy'] }, 'meal', noSignals).map(
      (r) => r.itemId,
    );
    expect(dairyFree).not.toContain('salad');
    expect(dairyFree).not.toContain('pasta');
    const vegan = recommend(
      menu,
      { ...profile, dietPreferences: ['vegan'] },
      'meal',
      noSignals,
    ).map((r) => r.itemId);
    expect(vegan).toEqual(['veganBowl']);
  });

  it('penalises items the member rated poorly', () => {
    const ratings = new Map([['chickenBowl', 1]]);
    const [first] = recommend(menu, profile, 'post_workout', { ...noSignals, ratings });
    expect(first!.itemId).not.toBe('chickenBowl');
  });

  it('shrinks the target to what is left of the day', () => {
    const late = recommend(menu, profile, 'meal', {
      ...noSignals,
      eatenToday: { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
    });
    expect(late[0]!.itemId).toBe('salad');
  });
});

describe('slotFor', () => {
  it('maps the clock to the member’s training window (Tehran time)', () => {
    // Evening training 18–21. 16:30 Tehran = 13:00 UTC.
    expect(slotFor('evening', new Date('2026-09-27T13:00:00Z'))).toBe('pre_workout');
    expect(slotFor('evening', new Date('2026-09-27T16:30:00Z'))).toBe('post_workout');
    expect(slotFor('evening', new Date('2026-09-27T06:00:00Z'))).toBe('meal');
  });
});
