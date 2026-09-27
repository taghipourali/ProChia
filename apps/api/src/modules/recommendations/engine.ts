import type {
  Allergen,
  DietPreference,
  Goal,
  ItemTag,
  MacroTarget,
  MealSlot,
  Nutrition,
  TrainingTime,
} from '@prochia/shared';
import {
  GOAL_LABELS,
  MEAL_SLOT_LABELS,
  formatNumber,
  mealTarget,
  proteinDensity,
  tehranParts,
} from '@prochia/shared';

export interface CandidateItem {
  id: string;
  name: string;
  price: number;
  tags: ItemTag[];
  allergens: Allergen[];
  nutrition: Nutrition;
  available: boolean;
}

export interface RecommendationProfile {
  goal: Goal;
  targets: MacroTarget;
  mealsPerDay: number;
  allergens: Allergen[];
  dietPreferences: DietPreference[];
}

export interface RecommendationSignals {
  /** What the member already ordered today, so suggestions fill the remaining budget. */
  eatenToday: MacroTarget;
  /** itemId → times ordered in the last 60 days. */
  orderCounts: Map<string, number>;
  /** itemId → the member's average rating. */
  ratings: Map<string, number>;
}

export interface Recommendation {
  itemId: string;
  score: number;
  reasons: string[];
  fit: { kcal: number; protein: number };
}

/** Training-time windows in Tehran local hours: [start, end). */
const TRAINING_WINDOWS: Record<TrainingTime, [number, number]> = {
  morning: [6, 10],
  noon: [11, 14],
  afternoon: [15, 18],
  evening: [18, 21],
  night: [21, 24],
};

/** Picks the meal slot from the clock and the member's usual training time. */
export function slotFor(trainingTime: TrainingTime, at: Date): MealSlot {
  const hour = tehranParts(at).hour + tehranParts(at).minute / 60;
  const [start, end] = TRAINING_WINDOWS[trainingTime];
  if (hour >= start - 2 && hour < start) return 'pre_workout';
  if (hour >= start && hour < end + 1.5) return 'post_workout';
  return 'meal';
}

function excluded(item: CandidateItem, profile: RecommendationProfile): boolean {
  if (item.allergens.some((a) => profile.allergens.includes(a))) return true;
  if (profile.allergens.includes('dairy') && item.allergens.includes('lactose')) return true;
  for (const pref of profile.dietPreferences) {
    if (pref === 'vegan' && !item.tags.includes('vegan')) return true;
    if (pref === 'vegetarian' && !item.tags.includes('vegan') && !item.tags.includes('vegetarian'))
      return true;
    if (pref === 'gluten_free' && item.allergens.includes('gluten')) return true;
    if (pref === 'no_caffeine' && item.tags.includes('caffeine')) return true;
  }
  return false;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * Ranks menu items for one meal. The target is the slot's share of the member's daily macros,
 * shrunk to what is left of today's budget. Items are scored on calorie fit, protein coverage,
 * not overshooting carbs/fat for the goal, protein density, workout tags, and the member's own
 * history (reorders up, poor ratings down). Every suggestion carries human-readable reasons.
 */
export function recommend(
  items: CandidateItem[],
  profile: RecommendationProfile,
  slot: MealSlot,
  signals: RecommendationSignals,
  limit = 6,
): Recommendation[] {
  const slotTarget = mealTarget(profile.targets, slot, profile.mealsPerDay);
  const remaining = {
    kcal: Math.max(profile.targets.kcal - signals.eatenToday.kcal, 0),
    protein: Math.max(profile.targets.protein - signals.eatenToday.protein, 0),
  };
  const target: MacroTarget = {
    ...slotTarget,
    kcal: Math.max(Math.min(slotTarget.kcal, remaining.kcal || slotTarget.kcal), 150),
    protein: Math.max(Math.min(slotTarget.protein, remaining.protein || slotTarget.protein), 10),
  };
  const isMainSlot = slot === 'meal' || slot === 'post_workout';

  const scored: Recommendation[] = [];
  for (const item of items) {
    if (!item.available || excluded(item, profile)) continue;
    const n = item.nutrition;
    if (n.kcal <= 0) continue;
    // A black coffee is not a post-workout meal.
    if (isMainSlot && n.kcal < target.kcal * 0.35) continue;

    const kcalFit = 1 - clamp01(Math.abs(n.kcal - target.kcal) / target.kcal);
    const proteinFit = clamp01(n.protein / target.protein);
    const carbExcess =
      profile.goal === 'bulk' ? 0 : clamp01((n.carbs - target.carbs) / Math.max(target.carbs, 15));
    const fatExcess = clamp01((n.fat - target.fat) / Math.max(target.fat, 8));
    const density = clamp01(proteinDensity(n) / 10);

    let score =
      0.35 * kcalFit +
      0.3 * proteinFit +
      0.1 * (1 - carbExcess) +
      0.1 * (1 - fatExcess) +
      0.15 * density;

    if (slot === 'pre_workout' && item.tags.includes('pre_workout')) score += 0.08;
    if (slot === 'post_workout' && item.tags.includes('post_workout')) score += 0.08;
    if (profile.goal === 'cut' && (item.tags.includes('low_carb') || item.tags.includes('low_fat')))
      score += 0.04;
    if (profile.goal === 'bulk' && n.kcal >= target.kcal * 0.9) score += 0.04;

    const times = signals.orderCounts.get(item.id) ?? 0;
    score += (0.05 * Math.min(times, 3)) / 3;
    // Explicit dislikes outweigh a good macro fit.
    const rating = signals.ratings.get(item.id);
    if (rating !== undefined && rating <= 1.5) score -= 0.4;
    else if (rating !== undefined && rating <= 2.5) score -= 0.25;

    const reasons: string[] = [];
    const proteinShare = Math.round((n.protein / target.protein) * 100);
    reasons.push(
      `${formatNumber(n.protein)} گرم پروتئین — ${formatNumber(Math.min(proteinShare, 999))}٪ نیاز ${MEAL_SLOT_LABELS[slot]}`,
    );
    if (kcalFit >= 0.8)
      reasons.push(
        `${formatNumber(n.kcal)} کالری؛ اندازه مناسب برای هدف ${GOAL_LABELS[profile.goal]}`,
      );
    if (density >= 0.8) reasons.push('پروتئین بالا نسبت به کالری');
    if (slot === 'pre_workout' && n.fat <= target.fat)
      reasons.push('چربی کم؛ قبل تمرین سنگین نمی‌کند');
    if (times >= 2) reasons.push('از انتخاب‌های همیشگی خودت');

    scored.push({
      itemId: item.id,
      score: Math.round(score * 1000) / 1000,
      reasons: reasons.slice(0, 3),
      fit: { kcal: Math.round(kcalFit * 100), protein: Math.min(proteinShare, 200) },
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
