import { asc, eq, inArray } from 'drizzle-orm';
import type { Allergen, ItemTag, Nutrition } from '@prochia/shared';
import { ZERO_NUTRITION, addNutrition, roundNutrition, scaleNutrition } from '@prochia/shared';
import type { Executor } from '../../db/client';
import { gather } from '../../db/gather';
import {
  categories,
  ingredients,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  recipeLines,
  stations,
} from '../../db/schema';

export interface RecipeLine {
  ingredientId: string;
  quantity: number;
}

export interface CatalogOption {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
  nutrition: Nutrition;
  isDefault: boolean;
  isActive: boolean;
  sort: number;
  recipe: RecipeLine[];
}

export interface CatalogGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sort: number;
  options: CatalogOption[];
}

export interface CatalogItem {
  id: string;
  categoryId: string;
  stationId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  tags: ItemTag[];
  allergens: Allergen[];
  nutrition: Nutrition;
  servingGrams: number | null;
  nutritionSource: 'manual' | 'recipe';
  prepMinutes: number;
  isPublished: boolean;
  isAvailable: boolean;
  creditEligible: boolean;
  sort: number;
  groups: CatalogGroup[];
  recipe: RecipeLine[];
}

export interface Catalog {
  categories: (typeof categories.$inferSelect)[];
  stations: (typeof stations.$inferSelect)[];
  items: Map<string, CatalogItem>;
  options: Map<string, CatalogOption>;
}

const pickNutrition = (row: Nutrition): Nutrition => ({
  kcal: row.kcal,
  protein: row.protein,
  carbs: row.carbs,
  fat: row.fat,
  fiber: row.fiber,
  sugar: row.sugar,
  sodium: row.sodium,
});

/** Loads a branch's whole menu with modifiers and recipes — small enough to hold per request. */
export async function loadCatalog(db: Executor, branchId: string): Promise<Catalog> {
  const [cats, stationRows, itemRows, groupRows, links] = await gather(db, [
    () =>
      db
        .select()
        .from(categories)
        .where(eq(categories.branchId, branchId))
        .orderBy(asc(categories.sort)),
    () =>
      db.select().from(stations).where(eq(stations.branchId, branchId)).orderBy(asc(stations.sort)),
    () =>
      db
        .select()
        .from(menuItems)
        .where(eq(menuItems.branchId, branchId))
        .orderBy(asc(menuItems.sort)),
    () => db.select().from(modifierGroups).where(eq(modifierGroups.branchId, branchId)),
    () =>
      db
        .select({
          menuItemId: menuItemModifierGroups.menuItemId,
          groupId: menuItemModifierGroups.groupId,
          sort: menuItemModifierGroups.sort,
        })
        .from(menuItemModifierGroups)
        .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
        .where(eq(menuItems.branchId, branchId)),
  ] as const);

  const groupIds = groupRows.map((g) => g.id);
  const itemIds = itemRows.map((i) => i.id);
  const optionRows = groupIds.length
    ? await db
        .select()
        .from(modifierOptions)
        .where(inArray(modifierOptions.groupId, groupIds))
        .orderBy(asc(modifierOptions.sort))
    : [];
  const optionIds = optionRows.map((o) => o.id);
  const [itemRecipes, optionRecipes] = await gather(db, [
    async () =>
      itemIds.length
        ? db.select().from(recipeLines).where(inArray(recipeLines.menuItemId, itemIds))
        : [],
    async () =>
      optionIds.length
        ? db.select().from(recipeLines).where(inArray(recipeLines.modifierOptionId, optionIds))
        : [],
  ] as const);

  const recipesBy = (
    rows: (typeof recipeLines.$inferSelect)[],
    key: 'menuItemId' | 'modifierOptionId',
  ) => {
    const map = new Map<string, RecipeLine[]>();
    for (const r of rows) {
      const k = r[key]!;
      const list = map.get(k) ?? [];
      list.push({ ingredientId: r.ingredientId, quantity: r.quantity });
      map.set(k, list);
    }
    return map;
  };
  const itemRecipeMap = recipesBy(itemRecipes, 'menuItemId');
  const optionRecipeMap = recipesBy(optionRecipes, 'modifierOptionId');

  const options = new Map<string, CatalogOption>();
  const groups = new Map<string, CatalogGroup>();
  for (const g of groupRows) {
    groups.set(g.id, {
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sort: g.sort,
      options: [],
    });
  }
  for (const o of optionRows) {
    const option: CatalogOption = {
      id: o.id,
      groupId: o.groupId,
      name: o.name,
      priceDelta: o.priceDelta,
      nutrition: pickNutrition(o),
      isDefault: o.isDefault,
      isActive: o.isActive,
      sort: o.sort,
      recipe: optionRecipeMap.get(o.id) ?? [],
    };
    options.set(o.id, option);
    groups.get(o.groupId)?.options.push(option);
  }

  const groupsByItem = new Map<string, { group: CatalogGroup; sort: number }[]>();
  for (const l of links) {
    const group = groups.get(l.groupId);
    if (!group) continue;
    const list = groupsByItem.get(l.menuItemId) ?? [];
    list.push({ group, sort: l.sort });
    groupsByItem.set(l.menuItemId, list);
  }

  const items = new Map<string, CatalogItem>();
  for (const i of itemRows) {
    items.set(i.id, {
      id: i.id,
      categoryId: i.categoryId,
      stationId: i.stationId,
      name: i.name,
      description: i.description,
      price: i.price,
      imageUrl: i.imageUrl,
      tags: i.tags,
      allergens: i.allergens,
      nutrition: pickNutrition(i),
      servingGrams: i.servingGrams,
      nutritionSource: i.nutritionSource,
      prepMinutes: i.prepMinutes,
      isPublished: i.isPublished,
      isAvailable: i.isAvailable,
      creditEligible: i.creditEligible,
      sort: i.sort,
      groups: (groupsByItem.get(i.id) ?? []).sort((a, b) => a.sort - b.sort).map((g) => g.group),
      recipe: itemRecipeMap.get(i.id) ?? [],
    });
  }

  return { categories: cats, stations: stationRows, items, options };
}

// ─── Bill of materials ───────────────────────────────────────────────────────

export type Requirements = Map<string, number>;

export function addRequirement(target: Requirements, ingredientId: string, quantity: number) {
  target.set(ingredientId, (target.get(ingredientId) ?? 0) + quantity);
}

/** Ingredients consumed by `quantity` units of an item with the chosen options. */
export function lineRequirements(
  catalog: Catalog,
  line: { menuItemId: string; optionIds: string[]; quantity: number },
  into: Requirements = new Map(),
): Requirements {
  const item = catalog.items.get(line.menuItemId);
  if (!item) return into;
  for (const r of item.recipe) addRequirement(into, r.ingredientId, r.quantity * line.quantity);
  for (const optionId of line.optionIds) {
    const option = catalog.options.get(optionId);
    if (!option) continue;
    for (const r of option.recipe) addRequirement(into, r.ingredientId, r.quantity * line.quantity);
  }
  return into;
}

/**
 * How many more portions of each item the kitchen can make from what is on hand, after setting
 * aside what not-yet-accepted orders will consume. `null` means the item has no recipe and is
 * not stock-tracked.
 */
export function computeAvailability(catalog: Catalog, available: Map<string, number>) {
  const portionsFor = (recipe: RecipeLine[]): number | null => {
    let portions: number | null = null;
    for (const r of recipe) {
      if (r.quantity <= 0) continue;
      const have = Math.max(available.get(r.ingredientId) ?? 0, 0);
      const n = Math.floor(have / r.quantity + 1e-9);
      portions = portions === null ? n : Math.min(portions, n);
    }
    return portions;
  };

  const items = new Map<string, number | null>();
  for (const item of catalog.items.values()) items.set(item.id, portionsFor(item.recipe));
  const options = new Map<string, number | null>();
  for (const option of catalog.options.values()) options.set(option.id, portionsFor(option.recipe));
  return { items, options };
}

/** Nutrition per unit for an item with chosen options (options carry deltas). */
export function unitNutrition(
  catalog: Catalog,
  menuItemId: string,
  optionIds: string[],
): Nutrition {
  const item = catalog.items.get(menuItemId);
  if (!item) return ZERO_NUTRITION;
  let n = item.nutrition;
  for (const id of optionIds) {
    const option = catalog.options.get(id);
    if (option) n = addNutrition(n, option.nutrition);
  }
  return roundNutrition(n);
}

// ─── Nutrition from recipe ───────────────────────────────────────────────────

export interface RecipeNutritionResult {
  nutrition: Nutrition;
  /** Ingredients without nutrition data — the total undercounts them. */
  missing: string[];
  grams: number;
}

/** Sums ingredient nutrition (stored per 100 g/ml, or per piece) over a recipe. */
export async function recipeNutrition(
  db: Executor,
  recipe: RecipeLine[],
): Promise<RecipeNutritionResult> {
  if (!recipe.length) return { nutrition: ZERO_NUTRITION, missing: [], grams: 0 };
  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      nutrition: ingredients.nutrition,
    })
    .from(ingredients)
    .where(
      inArray(
        ingredients.id,
        recipe.map((r) => r.ingredientId),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  let total = ZERO_NUTRITION;
  let grams = 0;
  const missing: string[] = [];
  for (const line of recipe) {
    const ing = byId.get(line.ingredientId);
    if (!ing) continue;
    if (ing.unit !== 'pcs') grams += line.quantity;
    if (!ing.nutrition) {
      missing.push(ing.name);
      continue;
    }
    const factor = ing.unit === 'pcs' ? line.quantity : line.quantity / 100;
    total = addNutrition(total, scaleNutrition(ing.nutrition, factor));
  }
  return { nutrition: roundNutrition(total), missing, grams: Math.round(grams) };
}
