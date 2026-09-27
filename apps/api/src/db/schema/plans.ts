import type { SubscriptionScheduleInput } from '@prochia/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, toman, tstz } from './_columns';
import { goalEnum, planKindEnum, subscriptionStatusEnum } from './enums';
import { memberships } from './identity';
import { branches } from './tenancy';

/**
 * Something a member can buy up front:
 * - `package`: N meal credits (10, 30, 60…) spent whenever they like, at a discount.
 * - `meal_plan`: credits tied to a goal (cut / bulk) with an optional daily auto-order schedule.
 */
export const plans = pgTable('plans', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  kind: planKindEnum().notNull(),
  name: text().notNull(),
  description: text(),
  goal: goalEnum(),
  meals: integer().notNull(),
  validityDays: integer().notNull(),
  price: toman().notNull(),
  /** What the same meals cost without the plan — shown as the saving. */
  compareAtPrice: toman(),
  mealsPerDay: smallint(),
  /** Empty = every credit-eligible item. */
  eligibleCategoryIds: uuid().array().notNull().default([]),
  /** Credits cover items up to this price; the member pays the difference above it. */
  maxItemPrice: toman(),
  isFeatured: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  sort: smallint().notNull().default(0),
  createdAt: createdAt(),
});

export type SubscriptionSchedule = SubscriptionScheduleInput;

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum().notNull(),
    credits: integer().notNull(),
    creditsUsed: integer().notNull().default(0),
    startsOn: date({ mode: 'string' }).notNull(),
    expiresOn: date({ mode: 'string' }).notNull(),
    pricePaid: toman().notNull(),
    schedule: jsonb().$type<SubscriptionSchedule>(),
    lastAutoOrderOn: date({ mode: 'string' }),
    expiryRemindedAt: tstz(),
    lowCreditsRemindedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.membershipId, t.status),
    check('credits_within_total', sql`${t.creditsUsed} between 0 and ${t.credits}`),
  ],
);
