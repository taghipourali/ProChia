import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tstz } from './_columns';
import { campaignStatusEnum, smsStatusEnum, smsTemplateEnum } from './enums';
import { staff, users } from './identity';
import { branches } from './tenancy';

/** Outbound SMS queue, drained by the scheduler so a slow provider never blocks a request. */
export const smsOutbox = pgTable(
  'sms_outbox',
  {
    id: id(),
    branchId: uuid().references(() => branches.id),
    phone: varchar({ length: 11 }).notNull(),
    template: smsTemplateEnum().notNull(),
    body: text().notNull(),
    /** Provider template tokens (e.g. Kavenegar verify lookup). */
    tokens: jsonb().$type<Record<string, string>>(),
    status: smsStatusEnum().notNull().default('queued'),
    provider: varchar({ length: 20 }),
    providerMessageId: varchar({ length: 64 }),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    sendAfter: tstz().notNull().defaultNow(),
    sentAt: tstz(),
    campaignId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.status, t.sendAfter)],
);

export interface CampaignAudience {
  goal?: string | null;
  tierId?: string | null;
  vipOnly?: boolean;
  /** Members who have not ordered in at least this many days. */
  inactiveDays?: number | null;
}

export const campaigns = pgTable('campaigns', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  title: text().notNull(),
  body: text().notNull(),
  audience: jsonb().$type<CampaignAudience>().notNull().default({}),
  status: campaignStatusEnum().notNull().default('draft'),
  recipients: integer().notNull().default(0),
  createdBy: uuid().references(() => staff.id),
  createdAt: createdAt(),
  sentAt: tstz(),
});

/** Product analytics: what members look at and add, to understand the ordering experience. */
export const events = pgTable(
  'events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    userId: uuid().references(() => users.id),
    anonId: varchar({ length: 64 }),
    name: varchar({ length: 40 }).notNull(),
    props: jsonb().$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.branchId, t.name, t.createdAt)],
);
