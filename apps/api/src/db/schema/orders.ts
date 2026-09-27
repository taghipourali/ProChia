import type { Nutrition } from '@prochia/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';
import { createdAt, id, toman, tstz } from './_columns';
import {
  actorKindEnum,
  orderPaymentStateEnum,
  orderSourceEnum,
  orderStatusEnum,
  orderTypeEnum,
  paymentMethodEnum,
  ticketStatusEnum,
} from './enums';
import { memberships, staff, users } from './identity';
import { menuItems } from './menu';
import { subscriptions } from './plans';
import { promotions } from './club';
import { branches, spots, stations } from './tenancy';

export interface OrderLineOption {
  id: string;
  groupName: string;
  name: string;
  priceDelta: number;
}

export const orders = pgTable(
  'orders',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    /** Short number called out at the counter; restarts every day per branch. */
    number: integer().notNull(),
    businessDate: date({ mode: 'string' }).notNull(),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: orderTypeEnum().notNull(),
    spotId: uuid().references(() => spots.id),
    /** Set for pre-orders: when the member wants to pick the order up. */
    scheduledFor: tstz(),
    status: orderStatusEnum().notNull(),
    paymentState: orderPaymentStateEnum().notNull().default('unpaid'),
    paymentMethod: paymentMethodEnum().notNull(),
    subtotal: toman().notNull(),
    /** Value of the lines covered by package / meal-plan credits. */
    creditsValue: toman().notNull().default(0),
    memberDiscountPct: smallint().notNull().default(0),
    memberDiscount: toman().notNull().default(0),
    promoDiscount: toman().notNull().default(0),
    promotionId: uuid().references(() => promotions.id),
    total: toman().notNull(),
    paidAmount: toman().notNull().default(0),
    nutrition: jsonb().$type<Nutrition>().notNull(),
    note: text(),
    rejectReason: text(),
    source: orderSourceEnum().notNull().default('app'),
    subscriptionId: uuid().references(() => subscriptions.id),
    acceptedAt: tstz(),
    acceptedBy: uuid().references(() => staff.id),
    readyAt: tstz(),
    completedAt: tstz(),
    cancelledAt: tstz(),
    rating: smallint(),
    ratingComment: text(),
    ratedAt: tstz(),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.branchId, t.businessDate, t.number),
    index().on(t.branchId, t.status),
    index().on(t.membershipId, t.createdAt),
    index().on(t.branchId, t.createdAt),
    check('order_total_non_negative', sql`${t.total} >= 0`),
  ],
);

/** Atomic per-branch, per-day order number allocation. */
export const orderCounters = pgTable(
  'order_counters',
  {
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    businessDate: date({ mode: 'string' }).notNull(),
    lastNumber: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.businessDate] })],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id),
    stationId: uuid()
      .notNull()
      .references(() => stations.id),
    name: text().notNull(),
    /** Base price plus option deltas, per unit. */
    unitPrice: toman().notNull(),
    quantity: smallint().notNull(),
    options: jsonb().$type<OrderLineOption[]>().notNull().default([]),
    lineTotal: toman().notNull(),
    creditsUsed: smallint().notNull().default(0),
    /** Per unit, options included. */
    nutrition: jsonb().$type<Nutrition>().notNull(),
    note: text(),
    /** Struck by the restaurant during acceptance (e.g. an ingredient ran out). */
    removed: boolean().notNull().default(false),
  },
  (t) => [index().on(t.orderId)],
);

export const stationTickets = pgTable(
  'station_tickets',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    stationId: uuid()
      .notNull()
      .references(() => stations.id),
    status: ticketStatusEnum().notNull(),
    /** When the station should start, for scheduled pre-orders. */
    dueAt: tstz(),
    releasedAt: tstz(),
    startedAt: tstz(),
    readyAt: tstz(),
    servedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.orderId, t.stationId), index().on(t.branchId, t.stationId, t.status)],
);

/** Timeline of everything that happened to an order — the basis for service-time analytics. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: varchar({ length: 40 }).notNull(),
    actorKind: actorKindEnum().notNull(),
    actorId: uuid(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId, t.createdAt)],
);

/** Which subscription paid for which order line; reversed when the order is cancelled or rejected. */
export const creditRedemptions = pgTable(
  'credit_redemptions',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderLineId: uuid()
      .notNull()
      .references(() => orderLines.id, { onDelete: 'cascade' }),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id),
    credits: smallint().notNull(),
    value: toman().notNull(),
    reversedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.subscriptionId), index().on(t.orderId)],
);
