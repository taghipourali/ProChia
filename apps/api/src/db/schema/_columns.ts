import { bigint, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid().primaryKey().defaultRandom();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const tstz = () => timestamp({ withTimezone: true });

/** Toman amounts. Stored as bigint so ledger sums never overflow; read back as JS numbers. */
export const toman = () => bigint({ mode: 'number' });

/** Quantities in an ingredient's base unit (g, ml, pcs). */
export const quantity = () => numeric({ precision: 12, scale: 2, mode: 'number' });

/** Nutrition values per serving (kcal and sodium in mg, others in grams). */
export const nutritionColumns = () => ({
  kcal: numeric({ precision: 7, scale: 1, mode: 'number' }).notNull().default(0),
  protein: numeric({ precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
  carbs: numeric({ precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
  fat: numeric({ precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
  fiber: numeric({ precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
  sugar: numeric({ precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
  sodium: numeric({ precision: 7, scale: 1, mode: 'number' }).notNull().default(0),
});
