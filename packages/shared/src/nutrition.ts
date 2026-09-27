import type { ActivityLevel, Goal, MealSlot, Sex } from './enums';

/** Grams, except `kcal` and `sodium` (milligrams). */
export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'sodium',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  kcal: 'کالری',
  protein: 'پروتئین',
  carbs: 'کربوهیدرات',
  fat: 'چربی',
  fiber: 'فیبر',
  sugar: 'قند',
  sodium: 'سدیم',
};

export const ZERO_NUTRITION: Nutrition = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
};

export function addNutrition(a: Nutrition, b: Partial<Nutrition>): Nutrition {
  return {
    kcal: a.kcal + (b.kcal ?? 0),
    protein: a.protein + (b.protein ?? 0),
    carbs: a.carbs + (b.carbs ?? 0),
    fat: a.fat + (b.fat ?? 0),
    fiber: a.fiber + (b.fiber ?? 0),
    sugar: a.sugar + (b.sugar ?? 0),
    sodium: a.sodium + (b.sodium ?? 0),
  };
}

export function scaleNutrition(n: Nutrition, factor: number): Nutrition {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    fiber: n.fiber * factor,
    sugar: n.sugar * factor,
    sodium: n.sodium * factor,
  };
}

export function roundNutrition(n: Nutrition): Nutrition {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    kcal: Math.round(n.kcal),
    protein: r1(n.protein),
    carbs: r1(n.carbs),
    fat: r1(n.fat),
    fiber: r1(n.fiber),
    sugar: r1(n.sugar),
    sodium: Math.round(n.sodium),
  };
}

export function sumNutrition(items: Iterable<Nutrition>): Nutrition {
  let total = ZERO_NUTRITION;
  for (const n of items) total = addNutrition(total, n);
  return total;
}

/** Share of energy from each macro, using 4/4/9 kcal per gram. */
export function macroEnergySplit(n: Pick<Nutrition, 'protein' | 'carbs' | 'fat'>) {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f || 1;
  return { protein: p / total, carbs: c / total, fat: f / total };
}

/** Protein grams per 100 kcal — the "how efficient is this meal" number gym members care about. */
export function proteinDensity(n: Pick<Nutrition, 'kcal' | 'protein'>): number {
  return n.kcal > 0 ? (n.protein / n.kcal) * 100 : 0;
}

// ─── Body metrics ────────────────────────────────────────────────────────────

export function bmi(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export type BmiBand = 'under' | 'normal' | 'over' | 'obese';
export const BMI_BAND_LABELS: Record<BmiBand, string> = {
  under: 'کمبود وزن',
  normal: 'نرمال',
  over: 'اضافه وزن',
  obese: 'چاقی',
};

export function bmiBand(value: number): BmiBand {
  if (value < 18.5) return 'under';
  if (value < 25) return 'normal';
  if (value < 30) return 'over';
  return 'obese';
}

export function ageOn(birthIsoDate: string, on: Date = new Date()): number {
  const [y, m, d] = birthIsoDate.split('-').map(Number) as [number, number, number];
  let age = on.getUTCFullYear() - y;
  const beforeBirthday =
    on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  athlete: 1.9,
};

const GOAL_ENERGY_ADJUSTMENT: Record<Goal, number> = {
  cut: -0.2,
  recomp: -0.1,
  maintain: 0,
  bulk: 0.1,
};

/** Grams of protein per kg of reference body weight. */
const GOAL_PROTEIN_PER_KG: Record<Goal, number> = {
  cut: 2.2,
  recomp: 2.0,
  maintain: 1.8,
  bulk: 1.8,
};

export interface BodyProfile {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number | null;
  activity: ActivityLevel;
  goal: Goal;
}

export interface DailyTargets {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
}

/**
 * Katch–McArdle when body fat is known (more accurate for trained people),
 * Mifflin–St Jeor otherwise.
 */
export function basalMetabolicRate(
  p: Pick<BodyProfile, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'bodyFatPct'>,
): number {
  if (p.bodyFatPct != null && p.bodyFatPct > 2 && p.bodyFatPct < 60) {
    const leanMass = p.weightKg * (1 - p.bodyFatPct / 100);
    return 370 + 21.6 * leanMass;
  }
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

/**
 * Protein is dosed on body weight, but for BMI > 30 we dose on the weight at BMI 27 —
 * otherwise targets for heavier members become unrealistically high.
 */
function proteinReferenceWeight(p: BodyProfile): number {
  const m = p.heightCm / 100;
  const cap = 27 * m * m;
  return Math.min(p.weightKg, Math.max(cap, 0));
}

export function computeDailyTargets(p: BodyProfile): DailyTargets {
  const bmr = basalMetabolicRate(p);
  const tdee = bmr * ACTIVITY_FACTORS[p.activity];
  const kcal = Math.max(
    tdee * (1 + GOAL_ENERGY_ADJUSTMENT[p.goal]),
    p.sex === 'male' ? 1500 : 1200,
  );

  const protein = proteinReferenceWeight(p) * GOAL_PROTEIN_PER_KG[p.goal];
  const fat = Math.max((kcal * 0.25) / 9, p.weightKg * 0.6);
  const carbs = Math.max((kcal - protein * 4 - fat * 9) / 4, 0);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal: Math.round(kcal / 10) * 10,
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    fiber: Math.round((kcal / 1000) * 14),
    waterMl: Math.round((p.weightKg * 35) / 50) * 50,
  };
}

export type MacroTarget = Pick<Nutrition, 'kcal' | 'protein' | 'carbs' | 'fat'>;

/**
 * Share of the day each slot should cover. Post-workout meals lean on protein and carbs
 * for recovery; pre-workout meals keep fat low so they digest quickly.
 */
const SLOT_SHARE: Record<Exclude<MealSlot, 'meal'>, MacroTarget> = {
  post_workout: { kcal: 0.3, protein: 0.3, carbs: 0.35, fat: 0.2 },
  pre_workout: { kcal: 0.2, protein: 0.2, carbs: 0.25, fat: 0.1 },
  snack: { kcal: 0.1, protein: 0.12, carbs: 0.08, fat: 0.1 },
};

export function mealTarget(daily: MacroTarget, slot: MealSlot, mealsPerDay = 4): MacroTarget {
  const share =
    slot === 'meal'
      ? {
          kcal: 1 / mealsPerDay,
          protein: 1 / mealsPerDay,
          carbs: 1 / mealsPerDay,
          fat: 1 / mealsPerDay,
        }
      : SLOT_SHARE[slot];
  return {
    kcal: Math.round(daily.kcal * share.kcal),
    protein: Math.round(daily.protein * share.protein),
    carbs: Math.round(daily.carbs * share.carbs),
    fat: Math.round(daily.fat * share.fat),
  };
}
