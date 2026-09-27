import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { StockReason } from '@prochia/shared';
import { formatNumber, UNIT_LABELS } from '@prochia/shared';
import { gather, type Executor, type Tx } from '../../db/client';
import { ingredients, orderLines, orders, stockMovements } from '../../db/schema';
import { conflict } from '../../lib/errors';
import { lineRequirements, type Catalog, type Requirements } from '../menu/catalog';

export interface Movement {
  ingredientId: string;
  delta: number;
  reason: StockReason;
  /** Toman per base unit — required for stock coming in, recorded for stock going out. */
  unitCost?: number;
  refType?: string;
  refId?: string;
  staffId?: string | null;
  note?: string | null;
}

export interface Shortage {
  ingredientId: string;
  name: string;
  unit: string;
  required: number;
  onHand: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The only way stock changes. Locks the affected ingredient rows (in id order, so concurrent
 * orders cannot deadlock), checks for shortages, updates the running balance and weighted
 * average cost, and appends to the ledger.
 */
export async function applyMovements(
  tx: Tx,
  branchId: string,
  movements: Movement[],
  { allowNegative = false }: { allowNegative?: boolean } = {},
): Promise<string[]> {
  const nonZero = movements.filter((m) => m.delta !== 0);
  if (!nonZero.length) return [];

  const ids = [...new Set(nonZero.map((m) => m.ingredientId))].sort();
  const rows = await tx
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.branchId, branchId), inArray(ingredients.id, ids)))
    .orderBy(asc(ingredients.id))
    .for('update');
  const state = new Map(rows.map((r) => [r.id, { ...r }]));

  const shortages: Shortage[] = [];
  const netOut = new Map<string, number>();
  for (const m of nonZero) {
    if (!state.has(m.ingredientId))
      throw conflict('unknown_ingredient', 'ماده اولیه متعلق به این شعبه نیست');
    if (m.delta < 0) netOut.set(m.ingredientId, (netOut.get(m.ingredientId) ?? 0) - m.delta);
  }
  if (!allowNegative) {
    for (const [id, out] of netOut) {
      const ing = state.get(id)!;
      const incoming = nonZero
        .filter((m) => m.ingredientId === id && m.delta > 0)
        .reduce((s, m) => s + m.delta, 0);
      if (ing.onHand + incoming - out < -1e-6) {
        shortages.push({
          ingredientId: id,
          name: ing.name,
          unit: ing.unit,
          required: round2(out),
          onHand: ing.onHand,
        });
      }
    }
    if (shortages.length) {
      const list = shortages
        .map(
          (s) =>
            `${s.name} (${formatNumber(s.onHand)} از ${formatNumber(s.required)} ${UNIT_LABELS[s.unit as 'g']})`,
        )
        .join('، ');
      throw conflict('insufficient_stock', `موجودی کافی نیست: ${list}`, { shortages });
    }
  }

  const ledger: (typeof stockMovements.$inferInsert)[] = [];
  for (const m of nonZero) {
    const ing = state.get(m.ingredientId)!;
    const before = ing.onHand;
    const after = round2(before + m.delta);
    const isIncoming = m.delta > 0 && (m.reason === 'purchase' || m.reason === 'production_in');
    if (isIncoming && m.unitCost !== undefined) {
      const base = Math.max(before, 0);
      ing.avgCost =
        base + m.delta > 0
          ? (base * ing.avgCost + m.delta * m.unitCost) / (base + m.delta)
          : m.unitCost;
    }
    ing.onHand = after;
    ledger.push({
      branchId,
      ingredientId: m.ingredientId,
      delta: round2(m.delta),
      balanceAfter: after,
      reason: m.reason,
      unitCost: m.unitCost ?? ing.avgCost,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      staffId: m.staffId ?? null,
      note: m.note ?? null,
    });
  }

  for (const ing of state.values()) {
    await tx
      .update(ingredients)
      .set({ onHand: ing.onHand, avgCost: ing.avgCost, updatedAt: sql`now()` })
      .where(eq(ingredients.id, ing.id));
  }
  await tx.insert(stockMovements).values(ledger);
  return ids;
}

/** Ingredients that orders still awaiting acceptance (or payment) will consume. */
export async function pendingRequirements(
  db: Executor,
  branchId: string,
  catalog: Catalog,
): Promise<Requirements> {
  const lines = await db
    .select({
      menuItemId: orderLines.menuItemId,
      quantity: orderLines.quantity,
      options: orderLines.options,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        eq(orders.branchId, branchId),
        inArray(orders.status, ['placed', 'awaiting_payment']),
        eq(orderLines.removed, false),
      ),
    );
  const req: Requirements = new Map();
  for (const l of lines) {
    lineRequirements(
      catalog,
      { menuItemId: l.menuItemId, quantity: l.quantity, optionIds: l.options.map((o) => o.id) },
      req,
    );
  }
  return req;
}

/** On-hand minus what pending orders will take. */
export async function availableStock(db: Executor, branchId: string, catalog: Catalog) {
  const [rows, pending] = await gather(db, [
    () =>
      db
        .select({ id: ingredients.id, onHand: ingredients.onHand })
        .from(ingredients)
        .where(eq(ingredients.branchId, branchId)),
    () => pendingRequirements(db, branchId, catalog),
  ] as const);
  const available = new Map<string, number>();
  for (const r of rows) available.set(r.id, r.onHand - (pending.get(r.id) ?? 0));
  return { available, pending };
}
