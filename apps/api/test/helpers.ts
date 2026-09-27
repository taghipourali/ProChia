import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import type { Unit } from '@prochia/shared';
import { loadConfig } from '../src/config';
import type { AppContext } from '../src/context';
import { createDb, type Db } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import * as s from '../src/db/schema';
import type { Branch, StaffAuth } from '../src/lib/auth';
import { EventBus } from '../src/lib/bus';
import { hashPassword } from '../src/lib/crypto';
import { receivePurchase } from '../src/modules/inventory/service';
import { saveMenuItem, setRecipe } from '../src/modules/menu/service';
import { ConsoleSmsProvider } from '../src/modules/notifications/providers';
import { FakeGateway } from '../src/modules/payments/gateways';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://prochia:prochia@localhost:5432/prochia_test';

/** Fresh schema for each test file. */
export async function resetDatabase() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await client.end();
  await runMigrations(TEST_DB);
}

export interface TestContext extends AppContext {
  clock: { now: Date };
  smsLog: ConsoleSmsProvider;
  fakeGateway: FakeGateway;
  close: () => Promise<void>;
}

export function createTestContext(env: Record<string, string> = {}): TestContext {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    DEFAULT_BRANCH: 'gym',
    DEV_ECHO_OTP: 'true',
    ...env,
  });
  const { db, pool } = createDb(TEST_DB);
  const clock = { now: new Date('2026-09-27T09:00:00Z') }; // 12:30 in Tehran
  const smsLog = new ConsoleSmsProvider(() => {});
  const fakeGateway = new FakeGateway();
  return {
    config,
    db,
    bus: new EventBus(),
    sms: smsLog,
    gateway: fakeGateway,
    now: () => clock.now,
    clock,
    smsLog,
    fakeGateway,
    close: () => pool.end(),
  };
}

export interface Fixture {
  branch: Branch;
  restaurant: typeof s.stations.$inferSelect;
  cafe: typeof s.stations.$inferSelect;
  staff: Record<'manager' | 'kitchen' | 'barista' | 'cashier', StaffAuth>;
  ingredients: Record<'chicken' | 'rice' | 'milk' | 'coffee' | 'lettuce', string>;
  items: Record<'bowl' | 'latte' | 'salad', string>;
  categories: Record<'meals' | 'drinks', string>;
}

/**
 * A small branch: a restaurant (acceptance station) making a chicken bowl and salad, and a café
 * making lattes, with stock for a handful of each.
 */
export async function createFixture(
  ctx: AppContext,
  settings: Partial<s.BranchSettings> = {},
): Promise<Fixture> {
  const db = ctx.db;
  const [branch] = await db
    .insert(s.branches)
    .values({
      slug: 'gym',
      name: 'پروچیا',
      gymName: 'باشگاه تست',
      settings: { ...s.DEFAULT_BRANCH_SETTINGS, ...settings },
    })
    .returning();
  const [restaurant, cafe] = await db
    .insert(s.stations)
    .values([
      {
        branchId: branch!.id,
        code: 'restaurant',
        name: 'رستوران',
        floorLabel: 'طبقه اول',
        isAcceptance: true,
        defaultPrepMinutes: 15,
      },
      {
        branchId: branch!.id,
        code: 'cafe',
        name: 'کافه',
        floorLabel: 'همکف',
        isAcceptance: false,
        defaultPrepMinutes: 5,
        sort: 1,
      },
    ])
    .returning();

  const passwordHash = await hashPassword('password123');
  const staffRows = await db
    .insert(s.staff)
    .values([
      { name: 'مدیر', username: 'manager', role: 'manager', branchId: branch!.id, passwordHash },
      { name: 'آشپز', username: 'kitchen', role: 'restaurant', branchId: branch!.id, passwordHash },
      { name: 'باریستا', username: 'barista', role: 'cafe', branchId: branch!.id, passwordHash },
      { name: 'صندوق', username: 'cashier', role: 'cashier', branchId: branch!.id, passwordHash },
    ])
    .returning();
  const auth = (username: string): StaffAuth => ({
    sessionId: 'test',
    staff: staffRows.find((r) => r.username === username)!,
    branch: branch!,
  });

  const ing = async (name: string, unit: Unit) => {
    const [row] = await db
      .insert(s.ingredients)
      .values({ branchId: branch!.id, name, kind: 'raw', unit })
      .returning();
    return row!.id;
  };
  const chicken = await ing('مرغ', 'g');
  const rice = await ing('برنج', 'g');
  const milk = await ing('شیر', 'ml');
  const coffee = await ing('قهوه', 'g');
  const lettuce = await ing('کاهو', 'g');

  await receivePurchase(ctx, branch!.id, staffRows[0]!.id, {
    lines: [
      { ingredientId: chicken, quantity: 1000, lineCost: 400_000 },
      { ingredientId: rice, quantity: 2000, lineCost: 200_000 },
      { ingredientId: milk, quantity: 1000, lineCost: 60_000 },
      { ingredientId: coffee, quantity: 200, lineCost: 400_000 },
      { ingredientId: lettuce, quantity: 1000, lineCost: 70_000 },
    ],
  });

  const [meals, drinks] = await db
    .insert(s.categories)
    .values([
      { branchId: branch!.id, name: 'غذا', stationId: restaurant!.id },
      { branchId: branch!.id, name: 'نوشیدنی', stationId: cafe!.id, sort: 1 },
    ])
    .returning();

  const base = {
    description: null,
    tags: [],
    allergens: [],
    nutrition: { kcal: 500, protein: 45, carbs: 50, fat: 12, fiber: 3, sugar: 2, sodium: 300 },
    servingGrams: null,
    nutritionSource: 'manual' as const,
    prepMinutes: 12,
    isPublished: true,
    creditEligible: true,
    sort: 0,
    groupIds: [],
  };
  const bowl = await saveMenuItem(ctx, branch!, null, {
    ...base,
    categoryId: meals!.id,
    stationId: restaurant!.id,
    name: 'بول مرغ',
    price: 500_000,
  });
  const salad = await saveMenuItem(ctx, branch!, null, {
    ...base,
    categoryId: meals!.id,
    stationId: restaurant!.id,
    name: 'سالاد',
    price: 300_000,
    nutrition: { kcal: 300, protein: 30, carbs: 10, fat: 15, fiber: 4, sugar: 3, sodium: 400 },
  });
  const latte = await saveMenuItem(ctx, branch!, null, {
    ...base,
    categoryId: drinks!.id,
    stationId: cafe!.id,
    name: 'لاته',
    price: 150_000,
    prepMinutes: 3,
    creditEligible: false,
    nutrition: { kcal: 95, protein: 7, carbs: 11, fat: 2, fiber: 0, sugar: 11, sodium: 90 },
  });
  await setRecipe(ctx, branch!, { menuItemId: bowl }, [
    { ingredientId: chicken, quantity: 200 },
    { ingredientId: rice, quantity: 150 },
  ]);
  await setRecipe(ctx, branch!, { menuItemId: salad }, [
    { ingredientId: chicken, quantity: 150 },
    { ingredientId: lettuce, quantity: 100 },
  ]);
  await setRecipe(ctx, branch!, { menuItemId: latte }, [
    { ingredientId: coffee, quantity: 18 },
    { ingredientId: milk, quantity: 220 },
  ]);

  return {
    branch: branch!,
    restaurant: restaurant!,
    cafe: cafe!,
    staff: {
      manager: auth('manager'),
      kitchen: auth('kitchen'),
      barista: auth('barista'),
      cashier: auth('cashier'),
    },
    ingredients: { chicken, rice, milk, coffee, lettuce },
    items: { bowl, latte, salad },
    categories: { meals: meals!.id, drinks: drinks!.id },
  };
}

export async function createMember(
  db: Db,
  branch: Branch,
  opts: { phone?: string; wallet?: number; vip?: number; status?: 'active' | 'pending' } = {},
) {
  const [user] = await db
    .insert(s.users)
    .values({ phone: opts.phone ?? '09120000001', firstName: 'تست', lastName: 'کاربر' })
    .returning();
  const [membership] = await db
    .insert(s.memberships)
    .values({
      branchId: branch.id,
      userId: user!.id,
      status: opts.status ?? 'active',
      walletBalance: opts.wallet ?? 0,
      isVip: Boolean(opts.vip),
      creditLimit: opts.vip ?? 0,
    })
    .returning();
  return { sessionId: 'test', user: user!, branch, membership: membership! };
}

export async function onHand(db: Db, ingredientId: string) {
  const [row] = await db
    .select({ onHand: s.ingredients.onHand })
    .from(s.ingredients)
    .where(eq(s.ingredients.id, ingredientId));
  return row!.onHand;
}

export async function reloadMember(db: Db, member: Awaited<ReturnType<typeof createMember>>) {
  const [membership] = await db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.id, member.membership.id));
  return { ...member, membership: membership! };
}

export async function orderRow(db: Db, id: string) {
  const [row] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  return row!;
}

export async function ticketsOf(db: Db, orderId: string) {
  return db.select().from(s.stationTickets).where(eq(s.stationTickets.orderId, orderId));
}

export { sql, s };
