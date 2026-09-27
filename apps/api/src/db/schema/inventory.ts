import type { Allergen, Nutrition } from '@prochia/shared';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, quantity, toman } from './_columns';
import { ingredientKindEnum, stockReasonEnum, unitEnum } from './enums';
import { staff } from './identity';
import { branches } from './tenancy';

const unitCost = () => numeric({ precision: 14, scale: 4, mode: 'number' });

/**
 * Anything the storage tracks. `raw` ingredients arrive from suppliers; `prepared` ones are
 * produced in-house by processing raw ones (cleaned chicken, cooked rice, cold brew…).
 */
export const ingredients = pgTable(
  'ingredients',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    name: text().notNull(),
    kind: ingredientKindEnum().notNull(),
    unit: unitEnum().notNull(),
    /** Per 100 g / 100 ml / 1 piece. Null when unknown — recipe nutrition then flags it as incomplete. */
    nutrition: jsonb().$type<Nutrition>(),
    allergens: text().array().$type<Allergen[]>().notNull().default([]),
    /** Live stock level, kept in step with `stock_movements` inside the same transaction. */
    onHand: quantity().notNull().default(0),
    /** Weighted-average cost per base unit, in toman. */
    avgCost: unitCost().notNull().default(0),
    lowStockThreshold: quantity().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.branchId, t.name)],
);

/** Append-only stock ledger. Every change to `ingredients.on_hand` has a row here. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    delta: quantity().notNull(),
    balanceAfter: quantity().notNull(),
    reason: stockReasonEnum().notNull(),
    unitCost: unitCost(),
    refType: varchar({ length: 20 }),
    refId: uuid(),
    staffId: uuid().references(() => staff.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.ingredientId, t.createdAt),
    index().on(t.branchId, t.createdAt),
    index().on(t.refType, t.refId),
  ],
);

export const purchases = pgTable('purchases', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  supplier: text(),
  invoiceNo: varchar({ length: 40 }),
  totalCost: toman().notNull(),
  staffId: uuid().references(() => staff.id),
  note: text(),
  createdAt: createdAt(),
});

export const purchaseLines = pgTable('purchase_lines', {
  id: id(),
  purchaseId: uuid()
    .notNull()
    .references(() => purchases.id, { onDelete: 'cascade' }),
  ingredientId: uuid()
    .notNull()
    .references(() => ingredients.id),
  quantity: quantity().notNull(),
  unitCost: unitCost().notNull(),
  lineCost: toman().notNull(),
  expiresOn: date({ mode: 'string' }),
});

/** A reusable processing definition, e.g. "clean & marinate chicken": 1000 g raw → 820 g ready. */
export const prepRecipes = pgTable('prep_recipes', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  name: text().notNull(),
  outputIngredientId: uuid()
    .notNull()
    .references(() => ingredients.id),
  /** Expected output of one batch; the actual yield is recorded on each run. */
  outputQuantity: quantity().notNull(),
  note: text(),
  isActive: boolean().notNull().default(true),
});

export const prepRecipeInputs = pgTable('prep_recipe_inputs', {
  id: id(),
  prepRecipeId: uuid()
    .notNull()
    .references(() => prepRecipes.id, { onDelete: 'cascade' }),
  ingredientId: uuid()
    .notNull()
    .references(() => ingredients.id),
  quantity: quantity().notNull(),
});

/** One processing batch actually performed by the storage/kitchen team. */
export const productionRuns = pgTable(
  'production_runs',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    prepRecipeId: uuid().references(() => prepRecipes.id),
    outputIngredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    outputQuantity: quantity().notNull(),
    totalCost: toman().notNull(),
    staffId: uuid().references(() => staff.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.branchId, t.createdAt)],
);

export const productionRunInputs = pgTable('production_run_inputs', {
  id: id(),
  runId: uuid()
    .notNull()
    .references(() => productionRuns.id, { onDelete: 'cascade' }),
  ingredientId: uuid()
    .notNull()
    .references(() => ingredients.id),
  quantity: quantity().notNull(),
  unitCost: unitCost().notNull(),
});
