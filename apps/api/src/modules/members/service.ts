import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { HealthProfileInput, ProfileInput } from '@prochia/shared';
import {
  addDaysIso,
  ageOn,
  bmi,
  bmiBand,
  computeDailyTargets,
  tehranIsoDate,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import { healthProfiles, orderLines, orders, users, weightLogs } from '../../db/schema';
import type { MemberAuth } from '../../lib/auth';
import { clubStatus } from '../club/service';
import { postpaidOutstanding } from '../orders/service';

export async function healthProfileView(ctx: AppContext, userId: string) {
  const [profile] = await ctx.db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, userId));
  if (!profile) return null;
  const value = bmi(profile.heightCm, profile.weightKg);
  return { ...profile, bmi: Math.round(value * 10) / 10, bmiBand: bmiBand(value) };
}

export async function me(ctx: AppContext, auth: MemberAuth) {
  const health = await healthProfileView(ctx, auth.user.id);
  const m = auth.membership;
  const club =
    m && m.status === 'active' ? await clubStatus(ctx.db, auth.branch, m, ctx.now()) : null;
  return {
    user: {
      id: auth.user.id,
      phone: auth.user.phone,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      birthDate: auth.user.birthDate,
      sex: auth.user.sex,
    },
    membership: m
      ? {
          id: m.id,
          status: m.status,
          isVip: m.isVip,
          creditLimit: m.creditLimit,
          postpaidOwed: m.isVip ? await postpaidOutstanding(ctx.db, m.id) : 0,
          walletBalance: m.walletBalance,
          personalDiscountPct: m.personalDiscountPct,
          tier: club?.tier
            ? { id: club.tier.id, name: club.tier.name, discountPct: club.tier.discountPct }
            : null,
        }
      : null,
    health,
    needsOnboarding: !auth.user.firstName || !health,
  };
}

export async function updateProfile(ctx: AppContext, userId: string, input: ProfileInput) {
  await ctx.db.update(users).set(input).where(eq(users.id, userId));
}

export async function saveHealthProfile(
  ctx: AppContext,
  userId: string,
  input: HealthProfileInput,
) {
  const now = ctx.now();
  const targets = computeDailyTargets({
    sex: input.sex,
    age: ageOn(input.birthDate, now),
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    bodyFatPct: input.bodyFatPct,
    activity: input.activity,
    goal: input.goal,
  });
  const values = {
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    bodyFatPct: input.bodyFatPct,
    activity: input.activity,
    goal: input.goal,
    trainingTime: input.trainingTime,
    trainingDaysPerWeek: input.trainingDaysPerWeek,
    mealsPerDay: input.mealsPerDay,
    allergens: input.allergens,
    dietPreferences: input.dietPreferences,
    targets,
    updatedAt: now,
  };
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ sex: input.sex, birthDate: input.birthDate })
      .where(eq(users.id, userId));
    await tx
      .insert(healthProfiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: healthProfiles.userId, set: values });
    await tx
      .insert(weightLogs)
      .values({ userId, weightKg: input.weightKg, loggedOn: tehranIsoDate(now) })
      .onConflictDoUpdate({
        target: [weightLogs.userId, weightLogs.loggedOn],
        set: { weightKg: input.weightKg },
      });
  });
  return healthProfileView(ctx, userId);
}

/** Logging a new weight also refreshes the targets, since they depend on it. */
export async function logWeight(ctx: AppContext, userId: string, weightKg: number) {
  const [profile] = await ctx.db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, userId));
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (profile && user?.sex && user.birthDate) {
    return saveHealthProfile(ctx, userId, {
      sex: user.sex,
      birthDate: user.birthDate,
      heightCm: profile.heightCm,
      weightKg,
      bodyFatPct: profile.bodyFatPct,
      activity: profile.activity,
      goal: profile.goal,
      trainingTime: profile.trainingTime,
      trainingDaysPerWeek: profile.trainingDaysPerWeek,
      mealsPerDay: profile.mealsPerDay,
      allergens: profile.allergens,
      dietPreferences: profile.dietPreferences,
    });
  }
  await ctx.db
    .insert(weightLogs)
    .values({ userId, weightKg, loggedOn: tehranIsoDate(ctx.now()) })
    .onConflictDoUpdate({ target: [weightLogs.userId, weightLogs.loggedOn], set: { weightKg } });
  return null;
}

const COUNTED = ['accepted', 'preparing', 'ready', 'completed'] as const;

/**
 * The member's own dashboard: what they ate through ProChia each day this week against their
 * targets, favourite items, and their weight trend.
 */
export async function insights(ctx: AppContext, auth: MemberAuth & { membership: { id: string } }) {
  const now = ctx.now();
  const today = tehranIsoDate(now);
  const from = addDaysIso(today, -6);

  const [daily, favourites, weights, totals, health] = await Promise.all([
    ctx.db
      .select({
        day: orders.businessDate,
        kcal: sql<number>`sum((${orders.nutrition}->>'kcal')::numeric)`,
        protein: sql<number>`sum((${orders.nutrition}->>'protein')::numeric)`,
        carbs: sql<number>`sum((${orders.nutrition}->>'carbs')::numeric)`,
        fat: sql<number>`sum((${orders.nutrition}->>'fat')::numeric)`,
        orders: sql<number>`count(*)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.membershipId, auth.membership.id),
          inArray(orders.status, [...COUNTED]),
          gte(orders.businessDate, from),
        ),
      )
      .groupBy(orders.businessDate),
    ctx.db
      .select({
        menuItemId: orderLines.menuItemId,
        name: orderLines.name,
        count: sql<number>`sum(${orderLines.quantity})`,
      })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orders.membershipId, auth.membership.id),
          inArray(orders.status, [...COUNTED]),
          eq(orderLines.removed, false),
        ),
      )
      .groupBy(orderLines.menuItemId, orderLines.name)
      .orderBy(desc(sql`sum(${orderLines.quantity})`))
      .limit(5),
    ctx.db
      .select({ date: weightLogs.loggedOn, weightKg: weightLogs.weightKg })
      .from(weightLogs)
      .where(eq(weightLogs.userId, auth.user.id))
      .orderBy(desc(weightLogs.loggedOn))
      .limit(30),
    ctx.db
      .select({
        orders: sql<number>`count(*)`,
        protein: sql<number>`coalesce(sum((${orders.nutrition}->>'protein')::numeric), 0)`,
        spent: sql<number>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.membershipId, auth.membership.id), eq(orders.status, 'completed'))),
    healthProfileView(ctx, auth.user.id),
  ]);

  const byDay = new Map(daily.map((d) => [d.day, d]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysIso(from, i);
    const d = byDay.get(day);
    return {
      date: day,
      kcal: Math.round(d?.kcal ?? 0),
      protein: Math.round(d?.protein ?? 0),
      carbs: Math.round(d?.carbs ?? 0),
      fat: Math.round(d?.fat ?? 0),
      orders: d?.orders ?? 0,
    };
  });

  return {
    targets: health?.targets ?? null,
    week,
    favourites,
    weights: weights.reverse(),
    lifetime: {
      orders: totals[0]?.orders ?? 0,
      protein: Math.round(totals[0]?.protein ?? 0),
      spent: totals[0]?.spent ?? 0,
    },
  };
}
