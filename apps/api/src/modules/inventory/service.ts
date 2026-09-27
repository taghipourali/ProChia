import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { StockReason } from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  ingredients,
  prepRecipeInputs,
  prepRecipes,
  productionRunInputs,
  productionRuns,
  purchaseLines,
  purchases,
  staff,
  stockMovements,
} from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { loadCatalog } from '../menu/catalog';
import { applyMovements, pendingRequirements } from './ledger';

export interface PurchaseInput {
  supplier?: string | null;
  invoiceNo?: string | null;
  note?: string | null;
  lines: { ingredientId: string; quantity: number; lineCost: number; expiresOn?: string | null }[];
}

/** Goods received from a supplier. `lineCost` is what was paid for the line, in toman. */
export async function receivePurchase(
  ctx: AppContext,
  branchId: string,
  staffId: string,
  input: PurchaseInput,
) {
  const result = await ctx.db.transaction(async (tx) => {
    const totalCost = input.lines.reduce((s, l) => s + l.lineCost, 0);
    const [purchase] = await tx
      .insert(purchases)
      .values({
        branchId,
        supplier: input.supplier ?? null,
        invoiceNo: input.invoiceNo ?? null,
        note: input.note ?? null,
        totalCost,
        staffId,
      })
      .returning();
    await tx.insert(purchaseLines).values(
      input.lines.map((l) => ({
        purchaseId: purchase!.id,
        ingredientId: l.ingredientId,
        quantity: l.quantity,
        unitCost: l.lineCost / l.quantity,
        lineCost: l.lineCost,
        expiresOn: l.expiresOn ?? null,
      })),
    );
    const changed = await applyMovements(
      tx,
      branchId,
      input.lines.map((l) => ({
        ingredientId: l.ingredientId,
        delta: l.quantity,
        reason: 'purchase',
        unitCost: l.lineCost / l.quantity,
        refType: 'purchase',
        refId: purchase!.id,
        staffId,
      })),
    );
    return { purchase: purchase!, changed };
  });
  ctx.bus.publish(branchId, { type: 'stock.changed', ingredientIds: result.changed });
  return result.purchase;
}

export interface ProductionInput {
  prepRecipeId?: string | null;
  outputIngredientId?: string;
  /** Actual output, in the output ingredient's base unit. */
  outputQuantity: number;
  /** Actual inputs. Omit to use the prep recipe scaled by `batches`. */
  inputs?: { ingredientId: string; quantity: number }[];
  batches?: number;
  note?: string | null;
}

/**
 * Turns raw materials into ready-to-cook ingredients (e.g. 5 kg raw chicken → 4.1 kg cleaned
 * and marinated). Inputs leave stock at their average cost; the output enters at the combined
 * cost divided by the real yield, so waste in processing shows up in the dish cost.
 */
export async function runProduction(
  ctx: AppContext,
  branchId: string,
  staffId: string,
  input: ProductionInput,
) {
  const result = await ctx.db.transaction(async (tx) => {
    let outputIngredientId = input.outputIngredientId;
    let inputs = input.inputs;
    if (input.prepRecipeId) {
      const [recipe] = await tx
        .select()
        .from(prepRecipes)
        .where(and(eq(prepRecipes.id, input.prepRecipeId), eq(prepRecipes.branchId, branchId)));
      if (!recipe) throw notFound('دستور فرآوری پیدا نشد');
      outputIngredientId ??= recipe.outputIngredientId;
      if (!inputs) {
        const batches = input.batches ?? 1;
        const rows = await tx
          .select()
          .from(prepRecipeInputs)
          .where(eq(prepRecipeInputs.prepRecipeId, recipe.id));
        inputs = rows.map((r) => ({
          ingredientId: r.ingredientId,
          quantity: r.quantity * batches,
        }));
      }
    }
    if (!outputIngredientId) throw badRequest('output_required', 'خروجی فرآوری را مشخص کنید');
    if (!inputs?.length) throw badRequest('inputs_required', 'مواد مصرفی فرآوری را وارد کنید');
    if (inputs.some((i) => i.ingredientId === outputIngredientId)) {
      throw badRequest('invalid_inputs', 'خروجی نمی‌تواند جزو مواد مصرفی باشد');
    }

    const costRows = await tx
      .select({ id: ingredients.id, avgCost: ingredients.avgCost })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.branchId, branchId),
          inArray(
            ingredients.id,
            inputs.map((i) => i.ingredientId),
          ),
        ),
      );
    const cost = new Map(costRows.map((r) => [r.id, r.avgCost]));
    const totalCost = inputs.reduce((s, i) => s + i.quantity * (cost.get(i.ingredientId) ?? 0), 0);

    const [run] = await tx
      .insert(productionRuns)
      .values({
        branchId,
        prepRecipeId: input.prepRecipeId ?? null,
        outputIngredientId,
        outputQuantity: input.outputQuantity,
        totalCost: Math.round(totalCost),
        staffId,
        note: input.note ?? null,
      })
      .returning();
    await tx.insert(productionRunInputs).values(
      inputs.map((i) => ({
        runId: run!.id,
        ingredientId: i.ingredientId,
        quantity: i.quantity,
        unitCost: cost.get(i.ingredientId) ?? 0,
      })),
    );
    const changed = await applyMovements(tx, branchId, [
      ...inputs.map((i) => ({
        ingredientId: i.ingredientId,
        delta: -i.quantity,
        reason: 'production_out' as const,
        refType: 'production',
        refId: run!.id,
        staffId,
      })),
      {
        ingredientId: outputIngredientId,
        delta: input.outputQuantity,
        reason: 'production_in',
        unitCost: totalCost / input.outputQuantity,
        refType: 'production',
        refId: run!.id,
        staffId,
      },
    ]);
    return { run: run!, changed };
  });
  ctx.bus.publish(branchId, { type: 'stock.changed', ingredientIds: result.changed });
  return result.run;
}

/** Waste (spoiled, dropped) or a manual correction to a physical count. */
export async function adjustStock(
  ctx: AppContext,
  branchId: string,
  staffId: string,
  input: {
    ingredientId: string;
    reason: Extract<StockReason, 'waste' | 'adjustment'>;
    quantity?: number;
    countedOnHand?: number;
    note?: string | null;
  },
) {
  const changed = await ctx.db.transaction(async (tx) => {
    let delta: number;
    if (input.reason === 'waste') {
      if (!input.quantity || input.quantity <= 0)
        throw badRequest('quantity_required', 'مقدار ضایعات را وارد کنید');
      delta = -input.quantity;
    } else {
      if (input.countedOnHand === undefined)
        throw badRequest('count_required', 'موجودی شمارش‌شده را وارد کنید');
      const [ing] = await tx
        .select({ onHand: ingredients.onHand })
        .from(ingredients)
        .where(and(eq(ingredients.id, input.ingredientId), eq(ingredients.branchId, branchId)));
      if (!ing) throw notFound('ماده اولیه پیدا نشد');
      delta = input.countedOnHand - ing.onHand;
    }
    return applyMovements(
      tx,
      branchId,
      [
        {
          ingredientId: input.ingredientId,
          delta,
          reason: input.reason,
          staffId,
          note: input.note ?? null,
          refType: 'manual',
        },
      ],
      // A counted correction is the truth, even if the books were wrong; waste may not exceed stock.
      { allowNegative: input.reason === 'adjustment' },
    );
  });
  ctx.bus.publish(branchId, { type: 'stock.changed', ingredientIds: changed });
}

/** The live storage view: on hand, promised to pending orders, free, value, and alerts. */
export async function stockLevels(ctx: AppContext, branchId: string) {
  const catalog = await loadCatalog(ctx.db, branchId);
  const since = new Date(ctx.now().getTime() - 7 * 86_400_000);
  const [rows, pending, usage] = await Promise.all([
    ctx.db
      .select()
      .from(ingredients)
      .where(eq(ingredients.branchId, branchId))
      .orderBy(asc(ingredients.name)),
    pendingRequirements(ctx.db, branchId, catalog),
    ctx.db
      .select({
        ingredientId: stockMovements.ingredientId,
        used: sql<number>`sum(-${stockMovements.delta})`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.branchId, branchId),
          inArray(stockMovements.reason, ['sale', 'production_out']),
          gte(stockMovements.createdAt, since),
        ),
      )
      .groupBy(stockMovements.ingredientId),
  ]);
  const weeklyUse = new Map(usage.map((u) => [u.ingredientId, u.used]));

  return rows.map((r) => {
    const reserved = pending.get(r.id) ?? 0;
    const dailyUse = (weeklyUse.get(r.id) ?? 0) / 7;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      unit: r.unit,
      isActive: r.isActive,
      onHand: r.onHand,
      reserved: Math.round(reserved * 100) / 100,
      available: Math.round((r.onHand - reserved) * 100) / 100,
      avgCost: r.avgCost,
      value: Math.round(Math.max(r.onHand, 0) * r.avgCost),
      lowStockThreshold: r.lowStockThreshold,
      isLow: r.onHand - reserved <= r.lowStockThreshold,
      /** Days of stock left at last week's pace; null when there was no usage. */
      daysLeft: dailyUse > 0 ? Math.max(Math.floor((r.onHand - reserved) / dailyUse), 0) : null,
      nutrition: r.nutrition,
      allergens: r.allergens,
    };
  });
}

export async function movementLog(
  ctx: AppContext,
  branchId: string,
  filter: { ingredientId?: string; reason?: StockReason; limit?: number },
) {
  const conditions = [eq(stockMovements.branchId, branchId)];
  if (filter.ingredientId) conditions.push(eq(stockMovements.ingredientId, filter.ingredientId));
  if (filter.reason) conditions.push(eq(stockMovements.reason, filter.reason));
  return ctx.db
    .select({
      id: stockMovements.id,
      ingredientId: stockMovements.ingredientId,
      ingredientName: ingredients.name,
      unit: ingredients.unit,
      delta: stockMovements.delta,
      balanceAfter: stockMovements.balanceAfter,
      reason: stockMovements.reason,
      unitCost: stockMovements.unitCost,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      note: stockMovements.note,
      staffName: staff.name,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(ingredients, eq(ingredients.id, stockMovements.ingredientId))
    .leftJoin(staff, eq(staff.id, stockMovements.staffId))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(Math.min(filter.limit ?? 100, 500));
}
