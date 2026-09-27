import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Allergen, ItemTag, Nutrition } from '@prochia/shared';
import type { AppContext } from '../../context';
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
import type { Branch } from '../../lib/auth';
import { badRequest, notFound } from '../../lib/errors';
import { availableStock } from '../inventory/ledger';
import {
  computeAvailability,
  loadCatalog,
  recipeNutrition,
  type Catalog,
  type RecipeLine,
} from './catalog';

/** Items with this many portions or fewer show a "few left" hint. */
const FEW_LEFT = 5;

export async function publicMenu(ctx: AppContext, branch: Branch) {
  const catalog = await loadCatalog(ctx.db, branch.id);
  const { available } = await availableStock(ctx.db, branch.id, catalog);
  return menuView(catalog, available, branch.settings.enforceStock, { includeHidden: false });
}

export function menuView(
  catalog: Catalog,
  available: Map<string, number>,
  enforceStock: boolean,
  { includeHidden }: { includeHidden: boolean },
) {
  const portions = computeAvailability(catalog, available);
  const isStocked = (p: number | null | undefined) =>
    !enforceStock || p === null || p === undefined || p > 0;

  const items = [...catalog.items.values()].filter((i) => includeHidden || i.isPublished);
  return {
    stations: catalog.stations
      .filter((s) => s.isActive)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        floorLabel: s.floorLabel,
        isAcceptance: s.isAcceptance,
      })),
    categories: catalog.categories
      .filter((c) => includeHidden || c.isActive)
      .map((c) => ({
        id: c.id,
        name: c.name,
        stationId: c.stationId,
        isActive: c.isActive,
        items: items
          .filter((i) => i.categoryId === c.id)
          .map((i) => {
            const left = portions.items.get(i.id) ?? null;
            return {
              id: i.id,
              categoryId: i.categoryId,
              stationId: i.stationId,
              name: i.name,
              description: i.description,
              price: i.price,
              imageUrl: i.imageUrl,
              tags: i.tags,
              allergens: i.allergens,
              nutrition: i.nutrition,
              servingGrams: i.servingGrams,
              nutritionSource: i.nutritionSource,
              prepMinutes: i.prepMinutes,
              creditEligible: i.creditEligible,
              isPublished: i.isPublished,
              isAvailable: i.isAvailable,
              available: i.isAvailable && isStocked(left),
              portionsLeft: left !== null && left <= FEW_LEFT ? left : null,
              stockTracked: left !== null,
              groups: i.groups.map((g) => ({
                id: g.id,
                name: g.name,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                options: g.options
                  .filter((o) => includeHidden || o.isActive)
                  .map((o) => ({
                    id: o.id,
                    name: o.name,
                    priceDelta: o.priceDelta,
                    nutrition: o.nutrition,
                    isDefault: o.isDefault,
                    isActive: o.isActive,
                    available: o.isActive && isStocked(portions.options.get(o.id)),
                  })),
              })),
            };
          }),
      }))
      .filter((c) => includeHidden || c.items.length > 0),
  };
}

export type MenuView = ReturnType<typeof menuView>;
export type MenuItemView = MenuView['categories'][number]['items'][number];

// ─── Staff editing ───────────────────────────────────────────────────────────

export async function staffMenu(ctx: AppContext, branch: Branch) {
  const catalog = await loadCatalog(ctx.db, branch.id);
  const { available } = await availableStock(ctx.db, branch.id, catalog);
  const view = menuView(catalog, available, branch.settings.enforceStock, { includeHidden: true });
  const groups = await ctx.db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.branchId, branch.id));
  const recipes = Object.fromEntries([...catalog.items.values()].map((i) => [i.id, i.recipe]));
  const optionRecipes = Object.fromEntries(
    [...catalog.options.values()].map((o) => [o.id, o.recipe]),
  );
  return {
    ...view,
    modifierGroups: groups.map((g) => ({
      ...g,
      options: [...catalog.options.values()].filter((o) => o.groupId === g.id),
    })),
    recipes,
    optionRecipes,
  };
}

export interface MenuItemInput {
  categoryId: string;
  stationId: string;
  name: string;
  description: string | null;
  price: number;
  tags: ItemTag[];
  allergens: Allergen[];
  nutrition: Nutrition;
  servingGrams: number | null;
  nutritionSource: 'manual' | 'recipe';
  prepMinutes: number;
  isPublished: boolean;
  creditEligible: boolean;
  sort: number;
  groupIds: string[];
}

async function assertStation(ctx: AppContext, branchId: string, stationId: string) {
  const [row] = await ctx.db
    .select({ id: stations.id })
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.branchId, branchId)));
  if (!row) throw badRequest('invalid_station', 'ایستگاه معتبر نیست');
}

async function assertBranchRefs(
  ctx: AppContext,
  branchId: string,
  input: Pick<MenuItemInput, 'categoryId' | 'groupIds' | 'stationId'>,
) {
  await assertStation(ctx, branchId, input.stationId);
  const [cat] = await ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.branchId, branchId)));
  if (!cat) throw badRequest('invalid_category', 'دسته‌بندی معتبر نیست');
  if (input.groupIds.length) {
    const rows = await ctx.db
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(
        and(inArray(modifierGroups.id, input.groupIds), eq(modifierGroups.branchId, branchId)),
      );
    if (rows.length !== new Set(input.groupIds).size)
      throw badRequest('invalid_group', 'گروه گزینه‌ها معتبر نیست');
  }
}

export async function saveMenuItem(
  ctx: AppContext,
  branch: Branch,
  itemId: string | null,
  input: MenuItemInput,
) {
  await assertBranchRefs(ctx, branch.id, input);
  const values = {
    categoryId: input.categoryId,
    stationId: input.stationId,
    name: input.name,
    description: input.description,
    price: input.price,
    tags: input.tags,
    allergens: input.allergens,
    ...input.nutrition,
    servingGrams: input.servingGrams,
    nutritionSource: input.nutritionSource,
    prepMinutes: input.prepMinutes,
    isPublished: input.isPublished,
    creditEligible: input.creditEligible,
    sort: input.sort,
    updatedAt: sql`now()`,
  };
  const id = await ctx.db.transaction(async (tx) => {
    let id = itemId;
    if (id) {
      const [row] = await tx
        .update(menuItems)
        .set(values)
        .where(and(eq(menuItems.id, id), eq(menuItems.branchId, branch.id)))
        .returning({ id: menuItems.id });
      if (!row) throw notFound('آیتم پیدا نشد');
    } else {
      const [row] = await tx
        .insert(menuItems)
        .values({ ...values, branchId: branch.id })
        .returning({ id: menuItems.id });
      id = row!.id;
    }
    await tx.delete(menuItemModifierGroups).where(eq(menuItemModifierGroups.menuItemId, id));
    if (input.groupIds.length) {
      await tx
        .insert(menuItemModifierGroups)
        .values(input.groupIds.map((groupId, sort) => ({ menuItemId: id!, groupId, sort })));
    }
    return id;
  });
  if (input.nutritionSource === 'recipe') await syncRecipeNutrition(ctx, id);
  ctx.bus.publish(branch.id, { type: 'menu.changed' });
  return id;
}

export async function setItemAvailability(
  ctx: AppContext,
  branch: Branch,
  itemId: string,
  isAvailable: boolean,
) {
  const [row] = await ctx.db
    .update(menuItems)
    .set({ isAvailable, updatedAt: sql`now()` })
    .where(and(eq(menuItems.id, itemId), eq(menuItems.branchId, branch.id)))
    .returning({ id: menuItems.id });
  if (!row) throw notFound('آیتم پیدا نشد');
  ctx.bus.publish(branch.id, { type: 'menu.changed' });
}

export async function setItemImage(
  ctx: AppContext,
  branch: Branch,
  itemId: string,
  imageUrl: string | null,
) {
  const [row] = await ctx.db
    .update(menuItems)
    .set({ imageUrl, updatedAt: sql`now()` })
    .where(and(eq(menuItems.id, itemId), eq(menuItems.branchId, branch.id)))
    .returning({ id: menuItems.id });
  if (!row) throw notFound('آیتم پیدا نشد');
}

/** Replaces the recipe of an item or a modifier option. */
export async function setRecipe(
  ctx: AppContext,
  branch: Branch,
  owner: { menuItemId: string } | { modifierOptionId: string },
  lines: RecipeLine[],
) {
  const ingredientIds = [...new Set(lines.map((l) => l.ingredientId))];
  if (ingredientIds.length !== lines.length)
    throw badRequest('duplicate_ingredient', 'هر ماده فقط یک بار در دستور پخت بیاید');
  if (ingredientIds.length) {
    const owned = await ctx.db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.branchId, branch.id), inArray(ingredients.id, ingredientIds)));
    if (owned.length !== ingredientIds.length) {
      throw badRequest('invalid_ingredient', 'ماده انتخاب‌شده متعلق به این شعبه نیست');
    }
  }
  await ctx.db.transaction(async (tx) => {
    if ('menuItemId' in owner) {
      const [item] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.id, owner.menuItemId), eq(menuItems.branchId, branch.id)));
      if (!item) throw notFound('آیتم پیدا نشد');
      await tx.delete(recipeLines).where(eq(recipeLines.menuItemId, owner.menuItemId));
    } else {
      const [option] = await tx
        .select({ id: modifierOptions.id })
        .from(modifierOptions)
        .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
        .where(
          and(
            eq(modifierOptions.id, owner.modifierOptionId),
            eq(modifierGroups.branchId, branch.id),
          ),
        );
      if (!option) throw notFound('گزینه پیدا نشد');
      await tx.delete(recipeLines).where(eq(recipeLines.modifierOptionId, owner.modifierOptionId));
    }
    if (lines.length) {
      await tx.insert(recipeLines).values(
        lines.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: l.quantity,
          menuItemId: 'menuItemId' in owner ? owner.menuItemId : null,
          modifierOptionId: 'modifierOptionId' in owner ? owner.modifierOptionId : null,
        })),
      );
    }
  });
  if ('menuItemId' in owner) await syncRecipeNutrition(ctx, owner.menuItemId);
  ctx.bus.publish(branch.id, { type: 'menu.changed' });
}

/** For items whose nutrition follows the recipe, recompute it from ingredient data. */
async function syncRecipeNutrition(ctx: AppContext, itemId: string) {
  const [item] = await ctx.db.select().from(menuItems).where(eq(menuItems.id, itemId));
  if (!item || item.nutritionSource !== 'recipe') return;
  const lines = await ctx.db.select().from(recipeLines).where(eq(recipeLines.menuItemId, itemId));
  const { nutrition, grams } = await recipeNutrition(ctx.db, lines);
  await ctx.db
    .update(menuItems)
    .set({ ...nutrition, servingGrams: grams || item.servingGrams })
    .where(eq(menuItems.id, itemId));
}

export async function saveCategory(
  ctx: AppContext,
  branch: Branch,
  id: string | null,
  input: { name: string; stationId: string; sort: number; isActive: boolean },
) {
  await assertStation(ctx, branch.id, input.stationId);
  if (id) {
    const [row] = await ctx.db
      .update(categories)
      .set(input)
      .where(and(eq(categories.id, id), eq(categories.branchId, branch.id)))
      .returning();
    if (!row) throw notFound('دسته‌بندی پیدا نشد');
    return row;
  }
  const [row] = await ctx.db
    .insert(categories)
    .values({ ...input, branchId: branch.id })
    .returning();
  return row!;
}

export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  sort: number;
  options: {
    id?: string;
    name: string;
    priceDelta: number;
    nutrition: Nutrition;
    isDefault: boolean;
    isActive: boolean;
    sort: number;
  }[];
}

export async function saveModifierGroup(
  ctx: AppContext,
  branch: Branch,
  id: string | null,
  input: ModifierGroupInput,
) {
  if (input.minSelect > input.maxSelect)
    throw badRequest('invalid_range', 'حداقل انتخاب از حداکثر بیشتر است');
  const groupId = await ctx.db.transaction(async (tx) => {
    let groupId = id;
    const values = {
      name: input.name,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      sort: input.sort,
    };
    if (groupId) {
      const [row] = await tx
        .update(modifierGroups)
        .set(values)
        .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.branchId, branch.id)))
        .returning();
      if (!row) throw notFound('گروه پیدا نشد');
    } else {
      const [row] = await tx
        .insert(modifierGroups)
        .values({ ...values, branchId: branch.id })
        .returning();
      groupId = row!.id;
    }
    const existing = await tx
      .select({ id: modifierOptions.id })
      .from(modifierOptions)
      .where(eq(modifierOptions.groupId, groupId));
    const keep = new Set(input.options.map((o) => o.id).filter(Boolean));
    // Options referenced by past orders are deactivated rather than deleted.
    for (const e of existing) {
      if (!keep.has(e.id))
        await tx
          .update(modifierOptions)
          .set({ isActive: false })
          .where(eq(modifierOptions.id, e.id));
    }
    for (const o of input.options) {
      const values = {
        name: o.name,
        priceDelta: o.priceDelta,
        ...o.nutrition,
        isDefault: o.isDefault,
        isActive: o.isActive,
        sort: o.sort,
      };
      if (o.id && existing.some((e) => e.id === o.id)) {
        await tx.update(modifierOptions).set(values).where(eq(modifierOptions.id, o.id));
      } else {
        await tx.insert(modifierOptions).values({ ...values, groupId });
      }
    }
    return groupId;
  });
  ctx.bus.publish(branch.id, { type: 'menu.changed' });
  return groupId;
}
