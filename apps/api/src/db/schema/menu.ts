import type { Allergen, ItemTag } from '@prochia/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, nutritionColumns, quantity, toman } from './_columns';
import { nutritionSourceEnum } from './enums';
import { ingredients } from './inventory';
import { branches, stations } from './tenancy';

export const categories = pgTable('categories', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  /** Default station for new items in this category. */
  stationId: uuid()
    .notNull()
    .references(() => stations.id),
  name: text().notNull(),
  sort: smallint().notNull().default(0),
  isActive: boolean().notNull().default(true),
});

export const menuItems = pgTable(
  'menu_items',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
    /** Which kitchen makes it — decides which station ticket the line lands on. */
    stationId: uuid()
      .notNull()
      .references(() => stations.id),
    name: text().notNull(),
    description: text(),
    price: toman().notNull(),
    imageUrl: text(),
    tags: text().array().$type<ItemTag[]>().notNull().default([]),
    allergens: text().array().$type<Allergen[]>().notNull().default([]),
    ...nutritionColumns(),
    servingGrams: numeric({ precision: 6, scale: 1, mode: 'number' }),
    /** `recipe`: nutrition is recalculated whenever the recipe changes. */
    nutritionSource: nutritionSourceEnum().notNull().default('manual'),
    prepMinutes: smallint().notNull().default(10),
    isPublished: boolean().notNull().default(true),
    /** Manual "sold out" switch, independent of stock. */
    isAvailable: boolean().notNull().default(true),
    /** Can be paid for with package / meal-plan credits. */
    creditEligible: boolean().notNull().default(true),
    sort: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.branchId, t.categoryId)],
);

export const modifierGroups = pgTable('modifier_groups', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  name: text().notNull(),
  minSelect: smallint().notNull().default(0),
  maxSelect: smallint().notNull().default(1),
  sort: smallint().notNull().default(0),
});

/**
 * An option's price and nutrition are deltas on the base item. Negative deltas express swaps,
 * e.g. "almond milk" removes 200 ml milk and adds 200 ml almond milk.
 */
export const modifierOptions = pgTable('modifier_options', {
  id: id(),
  groupId: uuid()
    .notNull()
    .references(() => modifierGroups.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  priceDelta: toman().notNull().default(0),
  ...nutritionColumns(),
  isDefault: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  sort: smallint().notNull().default(0),
});

export const menuItemModifierGroups = pgTable(
  'menu_item_modifier_groups',
  {
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    groupId: uuid()
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sort: smallint().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.menuItemId, t.groupId] })],
);

/**
 * Bill of materials. A line belongs to a menu item (base recipe) or to a modifier option
 * (applied when that option is chosen). Quantities are in the ingredient's base unit.
 */
export const recipeLines = pgTable(
  'recipe_lines',
  {
    id: id(),
    menuItemId: uuid().references(() => menuItems.id, { onDelete: 'cascade' }),
    modifierOptionId: uuid().references(() => modifierOptions.id, { onDelete: 'cascade' }),
    ingredientId: uuid()
      .notNull()
      .references(() => ingredients.id),
    quantity: quantity().notNull(),
  },
  (t) => [
    index().on(t.menuItemId),
    index().on(t.modifierOptionId),
    index().on(t.ingredientId),
    check('recipe_line_owner', sql`num_nonnulls(${t.menuItemId}, ${t.modifierOptionId}) = 1`),
    check('recipe_line_quantity', sql`${t.quantity} <> 0`),
  ],
);
