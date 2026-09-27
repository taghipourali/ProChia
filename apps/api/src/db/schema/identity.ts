import type { Allergen, DailyTargets, DietPreference } from '@prochia/shared';
import {
  boolean,
  check,
  date,
  index,
  inet,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, toman, tstz } from './_columns';
import {
  activityEnum,
  goalEnum,
  membershipStatusEnum,
  sessionKindEnum,
  sexEnum,
  staffRoleEnum,
  trainingTimeEnum,
} from './enums';
import { branches } from './tenancy';
import { tiers } from './club';

/** A person, identified by mobile number across all branches. */
export const users = pgTable('users', {
  id: id(),
  phone: varchar({ length: 11 }).notNull().unique(),
  firstName: text(),
  lastName: text(),
  birthDate: date({ mode: 'string' }),
  sex: sexEnum(),
  createdAt: createdAt(),
  lastSeenAt: tstz(),
});

export const healthProfiles = pgTable('health_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  heightCm: numeric({ precision: 5, scale: 1, mode: 'number' }).notNull(),
  weightKg: numeric({ precision: 5, scale: 1, mode: 'number' }).notNull(),
  bodyFatPct: numeric({ precision: 4, scale: 1, mode: 'number' }),
  activity: activityEnum().notNull(),
  goal: goalEnum().notNull(),
  trainingTime: trainingTimeEnum().notNull(),
  trainingDaysPerWeek: smallint().notNull(),
  mealsPerDay: smallint().notNull().default(4),
  allergens: text().array().$type<Allergen[]>().notNull().default([]),
  dietPreferences: text().array().$type<DietPreference[]>().notNull().default([]),
  /** Daily targets computed when the profile is saved, so menus can rank without recomputing. */
  targets: jsonb().$type<DailyTargets>().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const weightLogs = pgTable(
  'weight_logs',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weightKg: numeric({ precision: 5, scale: 1, mode: 'number' }).notNull(),
    loggedOn: date({ mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.loggedOn)],
);

/**
 * A user's relationship with one branch: approval, club tier, wallet, VIP credit.
 * Money lives here (not on the user) so every branch keeps its own books.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: membershipStatusEnum().notNull().default('pending'),
    gymMemberCode: varchar({ length: 32 }),
    tierId: uuid().references(() => tiers.id),
    /** VIP members may order now and pay later, up to `creditLimit`. */
    isVip: boolean().notNull().default(false),
    creditLimit: toman().notNull().default(0),
    /** Staff-assigned discount (coaches, staff, partners). The best of this and the tier discount applies. */
    personalDiscountPct: smallint().notNull().default(0),
    walletBalance: toman().notNull().default(0),
    note: text(),
    approvedAt: tstz(),
    approvedBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.branchId, t.userId),
    index().on(t.branchId, t.status),
    check('wallet_non_negative', sql`${t.walletBalance} >= 0`),
    check('personal_discount_range', sql`${t.personalDiscountPct} between 0 and 100`),
  ],
);

/** Gym member list imported by staff; sign-ups matching it are approved automatically. */
export const memberWhitelist = pgTable(
  'member_whitelist',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    phone: varchar({ length: 11 }).notNull(),
    gymMemberCode: varchar({ length: 32 }),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.branchId, t.phone)],
);

/** Staff accounts. `branchId` is null for owners, who manage every branch. */
export const staff = pgTable('staff', {
  id: id(),
  branchId: uuid().references(() => branches.id),
  name: text().notNull(),
  username: varchar({ length: 40 }).notNull().unique(),
  passwordHash: text().notNull(),
  role: staffRoleEnum().notNull(),
  isActive: boolean().notNull().default(true),
  lastLoginAt: tstz(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    /** SHA-256 of the bearer token; the token itself is never stored. */
    tokenHash: varchar({ length: 64 }).notNull().unique(),
    kind: sessionKindEnum().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    staffId: uuid().references(() => staff.id, { onDelete: 'cascade' }),
    branchId: uuid().references(() => branches.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastUsedAt: tstz(),
    userAgent: text(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'session_subject',
      sql`(${t.kind} = 'member' and ${t.userId} is not null) or (${t.kind} = 'staff' and ${t.staffId} is not null)`,
    ),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    phone: varchar({ length: 11 }).notNull(),
    codeHash: varchar({ length: 64 }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    attempts: smallint().notNull().default(0),
    consumedAt: tstz(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.phone, t.createdAt)],
);
