import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, toman, tstz } from './_columns';
import {
  paymentMethodEnum,
  paymentPurposeEnum,
  paymentStatusEnum,
  walletEntryKindEnum,
} from './enums';
import { memberships, staff } from './identity';
import { orders } from './orders';
import { subscriptions } from './plans';
import { branches } from './tenancy';

/**
 * Every money movement a member initiates: paying an order, topping up the wallet, buying a
 * package, settling VIP credit. Gateway and card-to-card payments start `pending` /
 * `awaiting_review` and settle later; wallet and counter payments settle immediately.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    purpose: paymentPurposeEnum().notNull(),
    method: paymentMethodEnum().notNull(),
    amount: toman().notNull(),
    status: paymentStatusEnum().notNull(),
    orderId: uuid().references(() => orders.id),
    subscriptionId: uuid().references(() => subscriptions.id),
    gateway: varchar({ length: 20 }),
    authority: varchar({ length: 64 }),
    refId: varchar({ length: 64 }),
    cardPan: varchar({ length: 20 }),
    trackingCode: varchar({ length: 32 }),
    cardLast4: varchar({ length: 4 }),
    reviewedBy: uuid().references(() => staff.id),
    reviewedAt: tstz(),
    reviewNote: text(),
    meta: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    paidAt: tstz(),
  },
  (t) => [
    index().on(t.branchId, t.status),
    index().on(t.membershipId, t.createdAt),
    index().on(t.orderId),
    unique().on(t.gateway, t.authority),
    check('payment_amount_positive', sql`${t.amount} > 0`),
  ],
);

/** Wallet ledger; `memberships.wallet_balance` is the running total. */
export const walletEntries = pgTable(
  'wallet_entries',
  {
    id: id(),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    amount: toman().notNull(),
    balanceAfter: toman().notNull(),
    kind: walletEntryKindEnum().notNull(),
    paymentId: uuid().references(() => payments.id),
    orderId: uuid().references(() => orders.id),
    staffId: uuid().references(() => staff.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.membershipId, t.createdAt)],
);

/** Top-up bonus tiers: charge at least `minAmount`, receive `percent` extra (capped at `maxBonus`). */
export const cashbackRules = pgTable('cashback_rules', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  title: text().notNull(),
  minAmount: toman().notNull(),
  percent: numeric({ precision: 5, scale: 2, mode: 'number' }).notNull(),
  maxBonus: toman(),
  startsAt: tstz(),
  endsAt: tstz(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});
