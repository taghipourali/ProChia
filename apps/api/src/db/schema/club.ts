import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, toman, tstz } from './_columns';
import { goalEnum, promotionAudienceEnum, promotionKindEnum } from './enums';
import { memberships } from './identity';
import { orders } from './orders';
import { branches } from './tenancy';

/** Members' club levels, earned by spend over the branch's rolling window. */
export const tiers = pgTable('tiers', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  name: text().notNull(),
  minSpend: toman().notNull(),
  discountPct: smallint().notNull().default(0),
  perks: text(),
  sort: smallint().notNull().default(0),
});

/**
 * Discounts. With a `code`, members type it at checkout; without one it applies automatically
 * to everyone in the audience. `personal` promotions are never typed directly — members receive
 * their own codes in `member_codes` (e.g. the birthday gift).
 */
export const promotions = pgTable(
  'promotions',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    title: text().notNull(),
    description: text(),
    kind: promotionKindEnum().notNull(),
    /** Percent (0–100) for `percent`, toman for `amount`. */
    value: numeric({ precision: 12, scale: 2, mode: 'number' }).notNull(),
    maxDiscount: toman(),
    minOrder: toman().notNull().default(0),
    code: varchar({ length: 32 }),
    audience: promotionAudienceEnum().notNull().default('all'),
    tierId: uuid().references(() => tiers.id),
    goal: goalEnum(),
    startsAt: tstz(),
    endsAt: tstz(),
    usageLimit: integer(),
    perMemberLimit: integer().notNull().default(1),
    /** Validity of personal codes issued from this promotion. */
    personalCodeDays: smallint().notNull().default(7),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.branchId, t.code)],
);

export const memberCodes = pgTable(
  'member_codes',
  {
    id: id(),
    promotionId: uuid()
      .notNull()
      .references(() => promotions.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    code: varchar({ length: 32 }).notNull().unique(),
    reason: varchar({ length: 20 }).notNull(),
    expiresAt: tstz().notNull(),
    usedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.membershipId)],
);

export const promotionRedemptions = pgTable(
  'promotion_redemptions',
  {
    id: id(),
    promotionId: uuid()
      .notNull()
      .references(() => promotions.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    memberCodeId: uuid().references(() => memberCodes.id),
    amount: toman().notNull(),
    reversedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.promotionId), index().on(t.membershipId)],
);
