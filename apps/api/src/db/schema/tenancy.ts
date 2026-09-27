import {
  boolean,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_columns';

/** Weekday (0 = Sunday … 6 = Saturday) → list of [open, close] "HH:MM" ranges in Tehran time. */
export type OpeningHours = Partial<
  Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', [string, string][]>
>;

export interface BranchSettings {
  /** How new sign-ups become members: instantly, only if listed by the gym, or after staff approval. */
  memberApproval: 'auto' | 'whitelist' | 'manual';
  /** Accept orders automatically when every ingredient is in stock. Off = restaurant confirms each order. */
  autoAccept: boolean;
  /** Block orders (and hide items) when recipes cannot be covered by stock. */
  enforceStock: boolean;
  /** How far ahead members may pre-order. */
  preorderMaxDays: number;
  /** Minimum minutes between placing a pre-order and its pickup time. */
  preorderMinLeadMinutes: number;
  /** Rolling window used to compute club tiers from spend. */
  tierWindowDays: number;
  /** Promotion issued as a personal code on each member's birthday. */
  birthdayPromotionId: string | null;
  /** Remind members when a package drops to this many meals. */
  lowCreditsThreshold: number;
}

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  memberApproval: 'manual',
  autoAccept: false,
  enforceStock: true,
  preorderMaxDays: 3,
  preorderMinLeadMinutes: 20,
  tierWindowDays: 90,
  birthdayPromotionId: null,
  lowCreditsThreshold: 2,
};

/** A tenant: one ProChia kitchen inside one gym, served on its own subdomain. */
export const branches = pgTable('branches', {
  id: id(),
  slug: varchar({ length: 40 }).notNull().unique(),
  name: text().notNull(),
  gymName: text().notNull(),
  address: text(),
  phone: varchar({ length: 20 }),
  instagram: varchar({ length: 60 }),
  whatsapp: varchar({ length: 20 }),
  /** Destination for card-to-card payments, shown at checkout. */
  cardNumber: varchar({ length: 19 }),
  cardHolder: text(),
  openingHours: jsonb().$type<OpeningHours>().notNull().default({}),
  settings: jsonb().$type<BranchSettings>().notNull().default(DEFAULT_BRANCH_SETTINGS),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/**
 * A preparation point, e.g. the restaurant on the first floor and the café on the ground floor.
 * Exactly one station per branch is the acceptance station: it confirms orders before other
 * stations start working on them.
 */
export const stations = pgTable(
  'stations',
  {
    id: id(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    code: varchar({ length: 20 }).notNull(),
    name: text().notNull(),
    floorLabel: text(),
    isAcceptance: boolean().notNull().default(false),
    defaultPrepMinutes: smallint().notNull().default(10),
    sort: smallint().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.branchId, t.code)],
);

/** QR-code targets: restaurant tables, the café counter, spots on the gym floor. */
export const spots = pgTable('spots', {
  id: id(),
  branchId: uuid()
    .notNull()
    .references(() => branches.id),
  code: varchar({ length: 12 }).notNull().unique(),
  label: text().notNull(),
  stationId: uuid().references(() => stations.id),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});
