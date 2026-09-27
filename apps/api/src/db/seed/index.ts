/**
 * Seeds a demo branch and ~3 weeks of realistic history by driving the real services with a
 * simulated clock: purchases and processing in the storage, orders through acceptance, both
 * stations and handover, wallet top-ups, packages, ratings. Run with `pnpm db:seed [--reset]`.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { CheckoutInput, Goal, HealthProfileInput } from '@prochia/shared';
import { addDaysIso, tehranDateTime, tehranIsoDate } from '@prochia/shared';
import { loadConfig } from '../../config';
import type { AppContext } from '../../context';
import { EventBus } from '../../lib/bus';
import type { Branch, StaffAuth } from '../../lib/auth';
import { hashPassword } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { ConsoleSmsProvider } from '../../modules/notifications/providers';
import { FakeGateway } from '../../modules/payments/gateways';
import { receivePurchase, runProduction } from '../../modules/inventory/service';
import { saveMenuItem, saveModifierGroup, setRecipe, publicMenu } from '../../modules/menu/service';
import { recipeNutrition } from '../../modules/menu/catalog';
import { saveHealthProfile } from '../../modules/members/service';
import { adjustWallet } from '../../modules/members/staff';
import {
  acceptOrder,
  handoverOrder,
  placeOrder,
  rejectOrder,
  releaseDueTickets,
  updateTicket,
} from '../../modules/orders/service';
import { purchasePlan } from '../../modules/plans/service';
import { reviewPayment } from '../../modules/payments/service';
import { runMigrations } from '../migrate';
import { createDb } from '../client';
import * as s from '../schema';
import { CATEGORIES, GROUPS, INGREDIENTS, ITEMS, PREP_RECIPES } from './data';

const config = loadConfig();
const reset = process.argv.includes('--reset');
const PASSWORD = process.env.SEED_PASSWORD ?? 'prochia1234';

await runMigrations(config.DATABASE_URL);
const { db, pool } = createDb(config.DATABASE_URL);

const clock = { now: new Date() };
const ctx: AppContext = {
  config,
  db,
  bus: new EventBus(),
  sms: new ConsoleSmsProvider(() => {}),
  gateway: new FakeGateway(),
  now: () => clock.now,
};

// Deterministic randomness so every seed produces the same story.
let seedState = 1405;
const rand = () => {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

async function main() {
  const [existing] = await db.select().from(s.branches).where(eq(s.branches.slug, 'demo'));
  if (existing && !reset) {
    console.log('Demo branch already exists. Use --reset to wipe and reseed.');
    return;
  }
  if (reset) {
    const tables = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = tables.rows.map((r) => `"${r.tablename}"`).join(', ');
    await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  }

  const realStart = new Date();
  const today = tehranIsoDate(realStart);
  const day0 = addDaysIso(today, -21);
  clock.now = tehranDateTime(day0, '08:00');

  // ─── Branch, stations, staff ─────────────────────────────────────────────
  const [branch] = await db
    .insert(s.branches)
    .values({
      slug: 'demo',
      name: 'پروچیا',
      gymName: 'باشگاه نمونه',
      address: 'تهران، خیابان نمونه، باشگاه نمونه — طبقه اول و همکف',
      phone: '02100000000',
      instagram: 'prochia',
      whatsapp: '09120000000',
      cardNumber: '6037-9900-0000-0000',
      cardHolder: 'پروچیا',
      openingHours: {},
      settings: { ...s.DEFAULT_BRANCH_SETTINGS, memberApproval: 'whitelist' },
      createdAt: clock.now,
    })
    .returning();
  const b = branch as Branch;

  const [restaurant, cafe] = await db
    .insert(s.stations)
    .values([
      {
        branchId: b.id,
        code: 'restaurant',
        name: 'رستوران',
        floorLabel: 'طبقه اول',
        isAcceptance: true,
        defaultPrepMinutes: 15,
        sort: 0,
      },
      {
        branchId: b.id,
        code: 'cafe',
        name: 'کافه',
        floorLabel: 'همکف',
        isAcceptance: false,
        defaultPrepMinutes: 4,
        sort: 1,
      },
    ])
    .returning();

  const passwordHash = await hashPassword(PASSWORD);
  const staffRows = await db
    .insert(s.staff)
    .values([
      { name: 'مالک پروچیا', username: 'owner', role: 'owner', branchId: null, passwordHash },
      { name: 'مدیر شعبه', username: 'manager', role: 'manager', branchId: b.id, passwordHash },
      {
        name: 'آشپزخانه طبقه اول',
        username: 'kitchen',
        role: 'restaurant',
        branchId: b.id,
        passwordHash,
      },
      { name: 'باریستا همکف', username: 'barista', role: 'cafe', branchId: b.id, passwordHash },
      { name: 'انباردار', username: 'storage', role: 'storage', branchId: b.id, passwordHash },
      { name: 'صندوق', username: 'cashier', role: 'cashier', branchId: b.id, passwordHash },
    ])
    .returning();
  const staffBy = (u: string) => staffRows.find((r) => r.username === u)!;
  const as = (u: string): StaffAuth => ({ sessionId: 'seed', staff: staffBy(u), branch: b });

  // ─── Storage: ingredients, first delivery, processing ────────────────────
  const ingredientRows = await db
    .insert(s.ingredients)
    .values(
      INGREDIENTS.map((i) => ({
        branchId: b.id,
        name: i.name,
        kind: i.kind,
        unit: i.unit,
        nutrition: i.nutrition,
        allergens: i.allergens ?? [],
        lowStockThreshold: i.lowStock,
      })),
    )
    .returning();
  const ing = Object.fromEntries(
    INGREDIENTS.map((i, idx) => [i.key, ingredientRows[idx]!.id]),
  ) as Record<string, string>;

  const prepRows: ((typeof PREP_RECIPES)[number] & { id: string })[] = [];
  for (const p of PREP_RECIPES) {
    const [row] = await db
      .insert(s.prepRecipes)
      .values({
        branchId: b.id,
        name: p.name,
        outputIngredientId: ing[p.output]!,
        outputQuantity: p.outputQuantity,
      })
      .returning();
    await db
      .insert(s.prepRecipeInputs)
      .values(
        p.inputs.map(([k, q]) => ({ prepRecipeId: row!.id, ingredientId: ing[k]!, quantity: q })),
      );
    prepRows.push({ ...p, id: row!.id });
  }

  const restock = async (factor: number) => {
    const bulk = (u: string) => (u === 'pcs' ? 1 : 1000);
    const raw = INGREDIENTS.filter((i) => i.kind === 'raw' && i.stock);
    await receivePurchase(ctx, b.id, staffBy('storage').id, {
      supplier: 'پخش مواد غذایی نمونه',
      invoiceNo: `F-${between(1000, 9999)}`,
      lines: raw.map((i) => ({
        ingredientId: ing[i.key]!,
        quantity: Math.round(i.stock! * factor * bulk(i.unit)),
        lineCost: Math.round(i.stock! * factor * i.bulkPrice! * (0.95 + rand() * 0.1)),
      })),
    });
    for (const p of prepRows) {
      const batches = Math.max(1, Math.round(p.runs * factor));
      for (let r = 0; r < batches; r++) {
        clock.now = addMinutes(clock.now, 12);
        // Real yields wander a little around the recipe's expected output.
        await runProduction(ctx, b.id, staffBy(pick(['storage', 'kitchen'])).id, {
          prepRecipeId: p.id,
          outputQuantity: Math.round(p.outputQuantity * (0.96 + rand() * 0.06)),
        });
      }
    }
  };
  await restock(1);

  // ─── Menu ────────────────────────────────────────────────────────────────
  const categoryRows = await db
    .insert(s.categories)
    .values(
      CATEGORIES.map((c, i) => ({
        branchId: b.id,
        name: c.name,
        stationId: c.station === 'restaurant' ? restaurant!.id : cafe!.id,
        sort: i,
      })),
    )
    .returning();
  const catId = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, categoryRows[i]!.id]));

  const groupIds: Record<string, string> = {};
  for (const [gi, g] of GROUPS.entries()) {
    const options = [];
    for (const [oi, o] of g.options.entries()) {
      const { nutrition } = await recipeNutrition(
        db,
        o.recipe.map(([k, q]) => ({ ingredientId: ing[k]!, quantity: q })),
      );
      options.push({
        name: o.name,
        priceDelta: o.priceDelta,
        nutrition,
        isDefault: Boolean(o.isDefault),
        isActive: true,
        sort: oi,
      });
    }
    groupIds[g.key] = await saveModifierGroup(ctx, b, null, {
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sort: gi,
      options,
    });
    const saved = await db
      .select()
      .from(s.modifierOptions)
      .where(eq(s.modifierOptions.groupId, groupIds[g.key]!));
    for (const o of g.options) {
      if (!o.recipe.length) continue;
      const option = saved.find((x) => x.name === o.name)!;
      await setRecipe(
        ctx,
        b,
        { modifierOptionId: option.id },
        o.recipe.map(([k, q]) => ({ ingredientId: ing[k]!, quantity: q })),
      );
    }
  }

  const itemId: Record<string, string> = {};
  for (const [idx, item] of ITEMS.entries()) {
    const category = CATEGORIES.find((c) => c.key === item.category)!;
    itemId[item.key] = await saveMenuItem(ctx, b, null, {
      categoryId: catId[item.category]!,
      stationId: category.station === 'restaurant' ? restaurant!.id : cafe!.id,
      name: item.name,
      description: item.description,
      price: item.price,
      tags: item.tags,
      allergens: item.allergens,
      nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
      servingGrams: null,
      nutritionSource: 'recipe',
      prepMinutes: item.prepMinutes,
      isPublished: true,
      creditEligible: item.creditEligible ?? true,
      sort: idx,
      groupIds: (item.groups ?? []).map((g) => groupIds[g]!),
    });
    await setRecipe(
      ctx,
      b,
      { menuItemId: itemId[item.key]! },
      item.recipe.map(([k, q]) => ({ ingredientId: ing[k]!, quantity: q })),
    );
  }

  // ─── Club, packages, cashback, QR spots ──────────────────────────────────
  await db.insert(s.tiers).values([
    {
      branchId: b.id,
      name: 'برنزی',
      minSpend: 0,
      discountPct: 0,
      perks: 'پیشنهادهای اختصاصی و هدیه تولد',
      sort: 0,
    },
    {
      branchId: b.id,
      name: 'نقره‌ای',
      minSpend: 6_000_000,
      discountPct: 5,
      perks: '۵٪ تخفیف همیشگی روی همه سفارش‌ها',
      sort: 1,
    },
    {
      branchId: b.id,
      name: 'طلایی',
      minSpend: 15_000_000,
      discountPct: 10,
      perks: '۱۰٪ تخفیف همیشگی و اولویت پیش‌سفارش',
      sort: 2,
    },
  ]);

  const [, birthday] = await db
    .insert(s.promotions)
    .values([
      {
        branchId: b.id,
        title: '۱۵٪ تخفیف اولین سفارش',
        description: 'خوش آمدی! روی اولین سفارشت خودکار اعمال می‌شود.',
        kind: 'percent',
        value: 15,
        maxDiscount: 150_000,
        audience: 'first_order',
      },
      {
        branchId: b.id,
        title: '۲۵٪ تخفیف تولد',
        description: 'هدیه تولد اعضای باشگاه؛ یک هفته اعتبار دارد.',
        kind: 'percent',
        value: 25,
        maxDiscount: 300_000,
        audience: 'personal',
        personalCodeDays: 7,
      },
      {
        branchId: b.id,
        title: 'بعد از تمرین',
        description: '۱۰٪ تخفیف سفارش‌های بالای ۴۰۰ هزار تومان.',
        kind: 'percent',
        value: 10,
        maxDiscount: 120_000,
        minOrder: 400_000,
        code: 'POSTWORKOUT',
        audience: 'all',
        perMemberLimit: 10,
      },
    ])
    .returning();
  await db
    .update(s.branches)
    .set({ settings: { ...b.settings, birthdayPromotionId: birthday!.id } })
    .where(eq(s.branches.id, b.id));

  await db.insert(s.cashbackRules).values([
    { branchId: b.id, title: 'شارژ ۱ میلیونی', minAmount: 1_000_000, percent: 3 },
    { branchId: b.id, title: 'شارژ ۳ میلیونی', minAmount: 3_000_000, percent: 6 },
    {
      branchId: b.id,
      title: 'شارژ ۵ میلیونی',
      minAmount: 5_000_000,
      percent: 10,
      maxBonus: 800_000,
    },
    {
      branchId: b.id,
      title: 'شارژ ۱۰ میلیونی',
      minAmount: 10_000_000,
      percent: 12,
      maxBonus: 1_500_000,
    },
  ]);

  const mealCats = [catId.bowls!, catId.wraps!, catId.breakfast!];
  const planRows = await db
    .insert(s.plans)
    .values([
      {
        branchId: b.id,
        kind: 'package',
        name: 'بسته ۱۰ وعده',
        description: '۱۰ وعده اصلی با ۱۰٪ تخفیف؛ هر وقت خواستی استفاده کن.',
        meals: 10,
        validityDays: 30,
        price: 4_450_000,
        compareAtPrice: 4_950_000,
        eligibleCategoryIds: mealCats,
        maxItemPrice: 550_000,
        sort: 0,
      },
      {
        branchId: b.id,
        kind: 'package',
        name: 'بسته ۳۰ وعده',
        description: 'محبوب‌ترین بسته؛ ۲۰٪ ارزان‌تر از خرید تکی.',
        meals: 30,
        validityDays: 60,
        price: 11_880_000,
        compareAtPrice: 14_850_000,
        eligibleCategoryIds: mealCats,
        maxItemPrice: 550_000,
        isFeatured: true,
        sort: 1,
      },
      {
        branchId: b.id,
        kind: 'package',
        name: 'بسته ۶۰ وعده',
        description: 'برای کسانی که هر روز با پروچیا غذا می‌خورند؛ ۲۵٪ تخفیف.',
        meals: 60,
        validityDays: 90,
        price: 22_280_000,
        compareAtPrice: 29_700_000,
        eligibleCategoryIds: mealCats,
        maxItemPrice: 550_000,
        sort: 2,
      },
      {
        branchId: b.id,
        kind: 'meal_plan',
        goal: 'cut',
        name: 'برنامه کات ۴ هفته',
        description: '۶ روز در هفته یک وعده پرپروتئین و کم‌کالری، هر روز خودکار سفارش داده می‌شود.',
        meals: 24,
        validityDays: 30,
        mealsPerDay: 1,
        price: 9_800_000,
        compareAtPrice: 11_640_000,
        eligibleCategoryIds: mealCats,
        maxItemPrice: 550_000,
        sort: 3,
      },
      {
        branchId: b.id,
        kind: 'meal_plan',
        goal: 'bulk',
        name: 'برنامه حجم ۴ هفته',
        description: 'روزی دو وعده کالری‌بالا برای عضله‌سازی، با تحویل خودکار.',
        meals: 48,
        validityDays: 30,
        mealsPerDay: 2,
        price: 18_900_000,
        compareAtPrice: 23_280_000,
        eligibleCategoryIds: mealCats,
        maxItemPrice: 550_000,
        sort: 4,
      },
    ])
    .returning();

  await db.insert(s.spots).values([
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      branchId: b.id,
      code: `T${n}DEMO`,
      label: `میز ${n}`,
      stationId: restaurant!.id,
    })),
    { branchId: b.id, code: 'CAFEBAR', label: 'پیشخوان کافه', stationId: cafe!.id },
    { branchId: b.id, code: 'GYMFLR', label: 'سالن بدنسازی', stationId: null },
  ]);

  // ─── Members ─────────────────────────────────────────────────────────────
  type P = Omit<HealthProfileInput, 'allergens' | 'dietPreferences'> &
    Partial<Pick<HealthProfileInput, 'allergens' | 'dietPreferences'>>;
  const people: {
    phone: string;
    first: string;
    last: string;
    profile: P;
    vip?: number;
    topup: number;
    pending?: boolean;
  }[] = [
    {
      phone: '09121111111',
      first: 'علی',
      last: 'رضایی',
      vip: 8_000_000,
      topup: 10_000_000,
      profile: {
        sex: 'male',
        birthDate: '1998-04-10',
        heightCm: 180,
        weightKg: 84,
        bodyFatPct: 16,
        activity: 'high',
        goal: 'cut',
        trainingTime: 'evening',
        trainingDaysPerWeek: 5,
        mealsPerDay: 4,
      },
    },
    {
      phone: '09122222222',
      first: 'سارا',
      last: 'محمدی',
      topup: 5_000_000,
      profile: {
        sex: 'female',
        birthDate: '1995-09-02',
        heightCm: 165,
        weightKg: 60,
        bodyFatPct: 24,
        activity: 'moderate',
        goal: 'recomp',
        trainingTime: 'morning',
        trainingDaysPerWeek: 4,
        mealsPerDay: 4,
        allergens: ['lactose'],
      },
    },
    {
      phone: '09123333333',
      first: 'رضا',
      last: 'کریمی',
      topup: 3_000_000,
      profile: {
        sex: 'male',
        birthDate: '2002-01-20',
        heightCm: 176,
        weightKg: 72,
        bodyFatPct: null,
        activity: 'athlete',
        goal: 'bulk',
        trainingTime: 'afternoon',
        trainingDaysPerWeek: 6,
        mealsPerDay: 5,
      },
    },
    {
      phone: '09124444444',
      first: 'مریم',
      last: 'احمدی',
      topup: 2_000_000,
      profile: {
        sex: 'female',
        birthDate: '1991-11-15',
        heightCm: 160,
        weightKg: 68,
        bodyFatPct: null,
        activity: 'light',
        goal: 'cut',
        trainingTime: 'noon',
        trainingDaysPerWeek: 3,
        mealsPerDay: 3,
        dietPreferences: ['vegetarian'],
      },
    },
    {
      phone: '09125555555',
      first: 'محمد',
      last: 'نوری',
      topup: 1_500_000,
      profile: {
        sex: 'male',
        birthDate: '1989-06-30',
        heightCm: 184,
        weightKg: 95,
        bodyFatPct: 22,
        activity: 'moderate',
        goal: 'cut',
        trainingTime: 'night',
        trainingDaysPerWeek: 4,
        mealsPerDay: 4,
      },
    },
    {
      phone: '09126666666',
      first: 'نگار',
      last: 'صادقی',
      topup: 3_500_000,
      profile: {
        sex: 'female',
        birthDate: '1999-03-08',
        heightCm: 170,
        weightKg: 58,
        bodyFatPct: 20,
        activity: 'high',
        goal: 'maintain',
        trainingTime: 'evening',
        trainingDaysPerWeek: 5,
        mealsPerDay: 4,
      },
    },
    {
      phone: '09127777777',
      first: 'حسین',
      last: 'جعفری',
      topup: 15_000_000,
      profile: {
        sex: 'male',
        birthDate: '1996-08-25',
        heightCm: 178,
        weightKg: 80,
        bodyFatPct: 14,
        activity: 'athlete',
        goal: 'bulk',
        trainingTime: 'evening',
        trainingDaysPerWeek: 6,
        mealsPerDay: 5,
      },
    },
    {
      phone: '09128888888',
      first: 'الهام',
      last: 'قاسمی',
      topup: 1_000_000,
      profile: {
        sex: 'female',
        birthDate: '1993-12-12',
        heightCm: 162,
        weightKg: 64,
        bodyFatPct: null,
        activity: 'moderate',
        goal: 'cut',
        trainingTime: 'afternoon',
        trainingDaysPerWeek: 3,
        mealsPerDay: 4,
      },
    },
    {
      phone: '09129999999',
      first: 'امیر',
      last: 'حسینی',
      topup: 0,
      pending: true,
      profile: {
        sex: 'male',
        birthDate: '2000-05-05',
        heightCm: 175,
        weightKg: 70,
        bodyFatPct: null,
        activity: 'moderate',
        goal: 'maintain',
        trainingTime: 'evening',
        trainingDaysPerWeek: 3,
        mealsPerDay: 4,
      },
    },
  ];

  // The gym's member list, as reception would import it.
  await db
    .insert(s.memberWhitelist)
    .values(
      people
        .filter((p) => !p.pending)
        .map((p, i) => ({ branchId: b.id, phone: p.phone, gymMemberCode: `G-${1200 + i}` })),
    );

  const members: ((typeof people)[number] & {
    user: typeof s.users.$inferSelect;
    membership: typeof s.memberships.$inferSelect;
  })[] = [];
  for (const [i, p] of people.entries()) {
    const [user] = await db
      .insert(s.users)
      .values({ phone: p.phone, firstName: p.first, lastName: p.last, createdAt: clock.now })
      .returning();
    const [membership] = await db
      .insert(s.memberships)
      .values({
        branchId: b.id,
        userId: user!.id,
        status: p.pending ? 'pending' : 'active',
        gymMemberCode: p.pending ? null : `G-${1200 + i}`,
        isVip: Boolean(p.vip),
        creditLimit: p.vip ?? 0,
        approvedAt: p.pending ? null : clock.now,
        createdAt: addMinutes(clock.now, i * 90),
      })
      .returning();
    await saveHealthProfile(ctx, user!.id, { allergens: [], dietPreferences: [], ...p.profile });
    if (p.topup) {
      const before = new Date();
      await adjustWallet(ctx, as('cashier'), membership!.id, {
        kind: 'topup',
        amount: p.topup,
        note: 'شارژ حضوری',
      });
      await db
        .update(s.walletEntries)
        .set({ createdAt: addMinutes(clock.now, i * 90 + 5) })
        .where(
          and(
            eq(s.walletEntries.membershipId, membership!.id),
            gte(s.walletEntries.createdAt, before),
          ),
        );
    }
    members.push({ ...p, user: user!, membership: membership! });
  }
  const active = members.filter((m) => !m.pending);

  const reload = async (m: (typeof members)[number]) => {
    const [membership] = await db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.id, m.membership.id));
    return { sessionId: 'seed', user: m.user, branch: b, membership: membership! };
  };

  // Two members buy packages with their wallet at the start of the period.
  for (const [who, planName] of [
    ['09121111111', 'برنامه کات ۴ هفته'],
    ['09127777777', 'بسته ۳۰ وعده'],
  ] as const) {
    const m = members.find((x) => x.phone === who)!;
    const before = new Date();
    const plan = planRows.find((p) => p.name === planName)!;
    await purchasePlan(ctx, await reload(m), plan.id, { method: 'wallet', startsOn: day0 }, '');
    await db
      .update(s.subscriptions)
      .set({ createdAt: clock.now })
      .where(gte(s.subscriptions.createdAt, before));
    await db
      .update(s.payments)
      .set({ createdAt: clock.now, paidAt: clock.now })
      .where(gte(s.payments.createdAt, before));
    await db
      .update(s.walletEntries)
      .set({ createdAt: clock.now })
      .where(gte(s.walletEntries.createdAt, before));
  }

  // ─── Three weeks of service ──────────────────────────────────────────────
  const goalPrefs: Record<Goal, string[]> = {
    cut: [
      'chickenSalad',
      'chickenBowl',
      'tunaSalad',
      'omelette',
      'chocoShake',
      'berryShake',
      'americano',
      'troutBowl',
    ],
    recomp: [
      'chickenBowl',
      'troutBowl',
      'omelette',
      'berryShake',
      'chickenWrap',
      'proteinLatte',
      'chiaPudding',
    ],
    maintain: [
      'chickenWrap',
      'veganBowl',
      'latte',
      'chiaPudding',
      'yogurtBowl',
      'troutBowl',
      'coldBrew',
    ],
    bulk: [
      'beefBowl',
      'chickenBowl',
      'oatmeal',
      'bananaShake',
      'chickenWrap',
      'energyBalls',
      'proteinLatte',
    ],
  };
  const vegetarianOk = new Set([
    'veganBowl',
    'omelette',
    'oatmeal',
    'chiaPudding',
    'energyBalls',
    'yogurtBowl',
    'latte',
    'americano',
    'berryShake',
  ]);
  const lowComments = ['کمی دیر آماده شد', 'برنج خشک بود', 'سس کم بود', 'دمای غذا مناسب نبود'];
  const goodComments = [
    'عالی بود',
    'خیلی خوشمزه و سیرکننده',
    'بهترین بول بعد از تمرین',
    null,
    null,
    null,
  ];

  let simulated = 0;
  for (let d = 0; d < 21; d++) {
    const date = addDaysIso(day0, d);
    if (d === 7 || d === 14) {
      clock.now = tehranDateTime(date, '07:00');
      await restock(0.8);
    }
    const count = between(5, 10);
    const times = Array.from({ length: count }, () => between(7 * 60, 22 * 60)).sort(
      (a, b) => a - b,
    );
    for (const minutes of times) {
      clock.now = tehranDateTime(
        date,
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      );
      const m = pick(active);
      const auth = await reload(m);
      const menu = await publicMenu(ctx, b);
      const available = new Set(
        menu.categories
          .flatMap((c) => c.items)
          .filter((i) => i.available)
          .map((i) => i.id),
      );
      let prefs = goalPrefs[m.profile.goal];
      if (m.profile.dietPreferences?.includes('vegetarian'))
        prefs = prefs.filter((k) => vegetarianOk.has(k)).concat(['veganBowl', 'omelette']);
      if (m.profile.allergens?.includes('lactose'))
        prefs = prefs.filter(
          (k) =>
            ![
              'latte',
              'proteinLatte',
              'oatmeal',
              'bananaShake',
              'berryShake',
              'yogurtBowl',
            ].includes(k),
        );
      const keys = [...new Set(Array.from({ length: between(1, 3) }, () => pick(prefs)))].filter(
        (k) => available.has(itemId[k]!),
      );
      if (!keys.length) continue;

      const isPreorder = rand() < 0.3;
      const scheduledFor = isPreorder ? addMinutes(clock.now, between(45, 150)) : null;
      const vip = Boolean(m.vip);
      const methodRoll = rand();
      const paymentMethod: CheckoutInput['paymentMethod'] =
        vip && methodRoll < 0.3
          ? 'postpaid'
          : methodRoll < 0.6 && auth.membership.walletBalance > 900_000
            ? 'wallet'
            : methodRoll < 0.8
              ? 'counter'
              : 'card_to_card';
      const spot = !isPreorder && rand() < 0.4 ? `T${between(1, 6)}DEMO` : undefined;

      const placedAt = clock.now;
      const events = [
        'menu_view',
        'item_view',
        'item_view',
        'add_to_cart',
        'checkout_start',
        'order_placed',
      ];
      await db.insert(s.events).values(
        events.map((name, i) => ({
          branchId: b.id,
          userId: m.user.id,
          name,
          createdAt: addMinutes(placedAt, i - events.length),
        })),
      );
      if (rand() < 0.5) {
        await db.insert(s.events).values([
          {
            branchId: b.id,
            userId: m.user.id,
            name: 'suggestion_shown',
            createdAt: addMinutes(placedAt, -6),
          },
          ...(rand() < 0.45
            ? [
                {
                  branchId: b.id,
                  userId: m.user.id,
                  name: 'suggestion_click',
                  createdAt: addMinutes(placedAt, -5),
                },
              ]
            : []),
        ]);
      }
      // Some visits browse and leave without ordering — that is what the funnel is for.
      if (rand() < 0.35) {
        await db.insert(s.events).values([
          {
            branchId: b.id,
            anonId: `anon-${d}-${minutes}`,
            name: 'menu_view',
            createdAt: addMinutes(placedAt, -20),
          },
          {
            branchId: b.id,
            anonId: `anon-${d}-${minutes}`,
            name: 'item_view',
            createdAt: addMinutes(placedAt, -19),
          },
        ]);
      }

      let order;
      try {
        order = await placeOrder(
          ctx,
          auth,
          {
            lines: keys.map((k) => ({ itemId: itemId[k]!, quantity: 1, optionIds: [] })),
            useCredits: true,
            type: spot ? 'dine_in' : 'pickup',
            tableCode: spot,
            scheduledFor: scheduledFor?.toISOString() ?? null,
            paymentMethod,
            cardToCard:
              paymentMethod === 'card_to_card'
                ? {
                    trackingCode: String(between(100000, 999999)),
                    cardLast4: String(between(1000, 9999)),
                  }
                : undefined,
            promoCode: rand() < 0.08 ? 'POSTWORKOUT' : undefined,
          },
          { returnBase: '' },
        );
      } catch (err) {
        if (err instanceof AppError) continue;
        throw err;
      }

      if (paymentMethod === 'card_to_card') {
        clock.now = addMinutes(placedAt, between(1, 4));
        const [p] = await db
          .select()
          .from(s.payments)
          .where(
            and(eq(s.payments.orderId, order.orderId), eq(s.payments.status, 'awaiting_review')),
          );
        if (p) await reviewPayment(ctx, as('cashier'), p.id, true);
      }

      clock.now = addMinutes(placedAt, between(1, 6));
      if (rand() < 0.03) {
        await rejectOrder(ctx, as('kitchen'), order.orderId, 'مواد اولیه این آیتم تمام شده بود');
      } else {
        try {
          await acceptOrder(ctx, { kind: 'staff', staff: staffBy('kitchen') }, b, order.orderId);
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          await rejectOrder(ctx, as('kitchen'), order.orderId, 'موجودی کافی نبود');
        }
        const [accepted] = await db.select().from(s.orders).where(eq(s.orders.id, order.orderId));
        if (accepted?.status === 'accepted') {
          if (scheduledFor) {
            clock.now = addMinutes(scheduledFor, -20);
            await releaseDueTickets(ctx);
          }
          const tickets = await db
            .select()
            .from(s.stationTickets)
            .where(
              and(
                eq(s.stationTickets.orderId, order.orderId),
                inArray(s.stationTickets.status, ['queued', 'scheduled']),
              ),
            );
          const base = clock.now;
          for (const t of tickets) {
            const isCafe = t.stationId === cafe!.id;
            clock.now = addMinutes(base, isCafe ? between(1, 5) : between(1, 8));
            await updateTicket(ctx, as(isCafe ? 'barista' : 'kitchen'), t.id, 'start');
            clock.now = addMinutes(clock.now, isCafe ? between(2, 5) : between(8, 18));
            await updateTicket(ctx, as(isCafe ? 'barista' : 'kitchen'), t.id, 'ready');
          }
          clock.now = addMinutes(clock.now, between(1, 8));
          await handoverOrder(ctx, as('cashier'), order.orderId, { collect: true });
          if (rand() < 0.45) {
            const low = rand() < 0.12;
            await db
              .update(s.orders)
              .set({
                rating: low ? between(2, 3) : between(4, 5),
                ratingComment: low ? pick(lowComments) : pick(goodComments),
                ratedAt: addMinutes(clock.now, 40),
              })
              .where(eq(s.orders.id, order.orderId));
          }
        }
      }
      await backdateOrder(order.orderId, placedAt);
      simulated++;
    }
  }

  // Settle part of the VIP tab at the end of the second week, as the member would at reception.
  // (Left partly open so the panel shows an outstanding balance.)

  // ─── Live state for the boards right now ─────────────────────────────────
  clock.now = new Date();
  const live = async (
    phone: string,
    keys: string[],
    method: CheckoutInput['paymentMethod'],
    extra: Partial<CheckoutInput> = {},
  ) => {
    const m = members.find((x) => x.phone === phone)!;
    return placeOrder(
      ctx,
      await reload(m),
      {
        lines: keys.map((k) => ({ itemId: itemId[k]!, quantity: 1, optionIds: [] })),
        useCredits: true,
        type: 'pickup',
        paymentMethod: method,
        ...extra,
      },
      { returnBase: '' },
    );
  };
  await live('09122222222', ['troutBowl', 'chiaPudding'], 'counter');
  await live('09126666666', ['chickenWrap', 'latte'], 'card_to_card', {
    cardToCard: { trackingCode: '482913', cardLast4: '5021' },
  });
  const preparing = await live('09127777777', ['beefBowl', 'bananaShake'], 'counter');
  await acceptOrder(ctx, { kind: 'staff', staff: staffBy('kitchen') }, b, preparing.orderId);
  const [prepTicket] = await db
    .select()
    .from(s.stationTickets)
    .where(
      and(
        eq(s.stationTickets.orderId, preparing.orderId),
        eq(s.stationTickets.stationId, restaurant!.id),
      ),
    );
  await updateTicket(ctx, as('kitchen'), prepTicket!.id, 'start');
  const ready = await live('09121111111', ['chickenSalad', 'americano'], 'postpaid');
  await acceptOrder(ctx, { kind: 'staff', staff: staffBy('kitchen') }, b, ready.orderId);
  for (const t of await db
    .select()
    .from(s.stationTickets)
    .where(eq(s.stationTickets.orderId, ready.orderId))) {
    await updateTicket(ctx, as(t.stationId === cafe!.id ? 'barista' : 'kitchen'), t.id, 'start');
    await updateTicket(ctx, as(t.stationId === cafe!.id ? 'barista' : 'kitchen'), t.id, 'ready');
  }
  await live('09125555555', ['chickenBowl'], 'counter', {
    scheduledFor: addMinutes(new Date(), 90).toISOString(),
  });

  // Seeded SMS are history, not messages to send when the API starts.
  await db
    .update(s.smsOutbox)
    .set({ status: 'sent', provider: 'seed', sentAt: sql`${s.smsOutbox.createdAt}` })
    .where(eq(s.smsOutbox.status, 'queued'));
  // History happened in the past; keep the inventory/production log in the same timeline.
  await db.execute(sql`
    update ${s.stockMovements} set created_at = coalesce(
      (select o.accepted_at from ${s.orders} o where o.id = ${s.stockMovements.refId} and ${s.stockMovements.refType} = 'order'),
      ${s.stockMovements.createdAt})
  `);

  console.log(
    `\nSeeded branch "${b.slug}" with ${ITEMS.length} menu items, ${INGREDIENTS.length} ingredients and ${simulated} historical orders.`,
  );
  console.log(
    `Staff logins (password: ${PASSWORD}): owner, manager, kitchen, barista, storage, cashier`,
  );
  console.log(
    'Member logins: 09121111111 (VIP, cut plan), 09122222222, 09123333333 … — OTP code is printed by the API',
  );
}

/** Services stamp rows with the real time; move this order's rows to when it happened. */
async function backdateOrder(orderId: string, placedAt: Date) {
  await db.execute(sql`
    update ${s.orders} set created_at = ${placedAt}, updated_at = coalesce(completed_at, cancelled_at, ready_at, accepted_at, ${placedAt})
    where id = ${orderId}
  `);
  await db.execute(sql`
    update ${s.orderEvents} e set created_at = case e.type
      when 'placed' then o.created_at
      when 'accepted' then coalesce(o.accepted_at, o.created_at)
      when 'ready' then coalesce(o.ready_at, o.created_at)
      when 'completed' then coalesce(o.completed_at, o.created_at)
      when 'rejected' then coalesce(o.cancelled_at, o.created_at)
      when 'cancelled' then coalesce(o.cancelled_at, o.created_at)
      when 'preparing' then coalesce(o.accepted_at, o.created_at) + interval '3 minutes'
      else coalesce(o.accepted_at, o.created_at) end
    from ${s.orders} o where o.id = e.order_id and o.id = ${orderId}
  `);
  await db.execute(
    sql`update ${s.stationTickets} set created_at = ${placedAt} where order_id = ${orderId}`,
  );
  await db.execute(sql`
    update ${s.payments} p set created_at = ${placedAt}, paid_at = case when p.paid_at is null then null else coalesce(o.completed_at, o.accepted_at, ${placedAt}) end
    from ${s.orders} o where o.id = p.order_id and p.order_id = ${orderId}
  `);
  await db.execute(
    sql`update ${s.walletEntries} set created_at = ${placedAt} where order_id = ${orderId}`,
  );
  await db.execute(
    sql`update ${s.creditRedemptions} set created_at = ${placedAt} where order_id = ${orderId}`,
  );
  await db.execute(
    sql`update ${s.promotionRedemptions} set created_at = ${placedAt} where order_id = ${orderId}`,
  );
  await db.execute(
    sql`update ${s.smsOutbox} set created_at = ${placedAt}, status = 'sent', provider = 'seed', sent_at = ${placedAt} where status = 'queued'`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
