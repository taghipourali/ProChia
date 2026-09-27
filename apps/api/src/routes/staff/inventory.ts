import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  STOCK_REASONS,
  ingredientInput,
  prepRecipeInput,
  productionInput,
  purchaseInput,
  stockAdjustInput,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  ingredients,
  prepRecipeInputs,
  prepRecipes,
  productionRuns,
  purchaseLines,
  purchases,
  staff,
} from '../../db/schema';
import { requireStaff } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  adjustStock,
  movementLog,
  receivePurchase,
  runProduction,
  stockLevels,
} from '../../modules/inventory/service';

const idParam = z.object({ id: z.uuid() });

export function staffInventoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/staff/inventory', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.view');
    return stockLevels(ctx, branch.id);
  });

  app.post('/api/v1/staff/ingredients', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.edit');
    const input = parse(ingredientInput, req.body);
    const [row] = await ctx.db
      .insert(ingredients)
      .values({ ...input, branchId: branch.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('duplicate', 'ماده‌ای با این نام وجود دارد');
    return row;
  });

  app.put('/api/v1/staff/ingredients/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.edit');
    const input = parse(ingredientInput, req.body);
    const [existing] = await ctx.db
      .select()
      .from(ingredients)
      .where(
        and(eq(ingredients.id, parse(idParam, req.params).id), eq(ingredients.branchId, branch.id)),
      );
    if (!existing) throw notFound('ماده اولیه پیدا نشد');
    if (existing.unit !== input.unit && existing.onHand !== 0) {
      throw conflict('unit_locked', 'واحد ماده‌ای که موجودی دارد قابل تغییر نیست');
    }
    const [row] = await ctx.db
      .update(ingredients)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(ingredients.id, existing.id))
      .returning();
    return row;
  });

  app.get('/api/v1/staff/purchases', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.view');
    const rows = await ctx.db
      .select({ purchase: purchases, staffName: staff.name })
      .from(purchases)
      .leftJoin(staff, eq(staff.id, purchases.staffId))
      .where(eq(purchases.branchId, branch.id))
      .orderBy(desc(purchases.createdAt))
      .limit(100);
    const lines = rows.length
      ? await ctx.db
          .select({ line: purchaseLines, name: ingredients.name, unit: ingredients.unit })
          .from(purchaseLines)
          .innerJoin(ingredients, eq(ingredients.id, purchaseLines.ingredientId))
          .where(
            inArray(
              purchaseLines.purchaseId,
              rows.map((r) => r.purchase.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r.purchase,
      staffName: r.staffName,
      lines: lines
        .filter((l) => l.line.purchaseId === r.purchase.id)
        .map((l) => ({ ...l.line, name: l.name, unit: l.unit })),
    }));
  });

  app.post('/api/v1/staff/purchases', async (req) => {
    const auth = await requireStaff(ctx, req, 'inventory.edit');
    return receivePurchase(ctx, auth.branch.id, auth.staff.id, parse(purchaseInput, req.body));
  });

  app.get('/api/v1/staff/prep-recipes', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.view');
    const rows = await ctx.db
      .select()
      .from(prepRecipes)
      .where(eq(prepRecipes.branchId, branch.id))
      .orderBy(asc(prepRecipes.name));
    const inputs = rows.length
      ? await ctx.db
          .select()
          .from(prepRecipeInputs)
          .where(
            inArray(
              prepRecipeInputs.prepRecipeId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({ ...r, inputs: inputs.filter((i) => i.prepRecipeId === r.id) }));
  });

  const savePrepRecipe = async (branchId: string, id: string | null, body: unknown) => {
    const input = parse(prepRecipeInput, body);
    return ctx.db.transaction(async (tx) => {
      const values = {
        name: input.name,
        outputIngredientId: input.outputIngredientId,
        outputQuantity: input.outputQuantity,
        note: input.note,
        isActive: input.isActive,
      };
      let recipeId = id;
      if (recipeId) {
        const [row] = await tx
          .update(prepRecipes)
          .set(values)
          .where(and(eq(prepRecipes.id, recipeId), eq(prepRecipes.branchId, branchId)))
          .returning();
        if (!row) throw notFound('دستور فرآوری پیدا نشد');
        await tx.delete(prepRecipeInputs).where(eq(prepRecipeInputs.prepRecipeId, recipeId));
      } else {
        const [row] = await tx
          .insert(prepRecipes)
          .values({ ...values, branchId })
          .returning();
        recipeId = row!.id;
      }
      await tx
        .insert(prepRecipeInputs)
        .values(input.inputs.map((i) => ({ ...i, prepRecipeId: recipeId! })));
      return { id: recipeId };
    });
  };

  app.post('/api/v1/staff/prep-recipes', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.edit');
    return savePrepRecipe(branch.id, null, req.body);
  });

  app.put('/api/v1/staff/prep-recipes/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.edit');
    return savePrepRecipe(branch.id, parse(idParam, req.params).id, req.body);
  });

  app.get('/api/v1/staff/production', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'inventory.view');
    return ctx.db
      .select({
        id: productionRuns.id,
        outputIngredientId: productionRuns.outputIngredientId,
        outputName: ingredients.name,
        unit: ingredients.unit,
        outputQuantity: productionRuns.outputQuantity,
        totalCost: productionRuns.totalCost,
        note: productionRuns.note,
        staffName: staff.name,
        createdAt: productionRuns.createdAt,
      })
      .from(productionRuns)
      .innerJoin(ingredients, eq(ingredients.id, productionRuns.outputIngredientId))
      .leftJoin(staff, eq(staff.id, productionRuns.staffId))
      .where(eq(productionRuns.branchId, branch.id))
      .orderBy(desc(productionRuns.createdAt))
      .limit(100);
  });

  app.post('/api/v1/staff/production', async (req) => {
    const auth = await requireStaff(ctx, req, 'inventory.produce');
    return runProduction(ctx, auth.branch.id, auth.staff.id, parse(productionInput, req.body));
  });

  app.post('/api/v1/staff/stock-adjustments', async (req) => {
    const auth = await requireStaff(ctx, req, 'inventory.produce');
    const input = parse(stockAdjustInput, req.body);
    if (
      input.reason === 'adjustment' &&
      auth.staff.role !== 'storage' &&
      auth.staff.role !== 'manager' &&
      auth.staff.role !== 'owner'
    ) {
      throw conflict('forbidden', 'اصلاح موجودی فقط با انباردار یا مدیر است');
    }
    await adjustStock(ctx, auth.branch.id, auth.staff.id, input);
    return { ok: true };
  });

  app.get<{ Querystring: { ingredientId?: string; reason?: string; limit?: string } }>(
    '/api/v1/staff/stock-movements',
    async (req) => {
      const { branch } = await requireStaff(ctx, req, 'inventory.view');
      const q = parse(
        z.object({
          ingredientId: z.uuid().optional(),
          reason: z.enum(STOCK_REASONS).optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        req.query,
      );
      return movementLog(ctx, branch.id, q);
    },
  );
}
