import { and, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { CheckoutInput } from '@prochia/shared';
import {
  addDaysIso,
  isoDateToJalali,
  tehranDateTime,
  tehranIsoDate,
  tehranParts,
  toJalali,
} from '@prochia/shared';
import type { AppContext } from '../context';
import {
  branches,
  healthProfiles,
  memberCodes,
  memberships,
  plans,
  promotions,
  subscriptions,
  users,
} from '../db/schema';
import { AppError } from '../lib/errors';
import { issueMemberCode, refreshTier } from '../modules/club/service';
import { queueSms, smsText } from '../modules/notifications/sms';
import { placeOrder } from '../modules/orders/service';
import { publicMenu } from '../modules/menu/service';
import { recommend } from '../modules/recommendations/engine';

/** Auto-orders are created this long before pickup so the restaurant has time to accept them. */
const AUTO_ORDER_LEAD_HOURS = 4;

/**
 * Meal plans with a schedule get their order placed automatically on each scheduled day. `fixed`
 * rotates through the member's chosen items; `auto` picks the best goal-matched item that the
 * plan's credits fully cover.
 */
export async function createScheduledOrders(ctx: AppContext) {
  const now = ctx.now();
  const today = tehranIsoDate(now);
  const weekday = tehranParts(now).weekday;

  const due = await ctx.db
    .select({
      sub: subscriptions,
      plan: plans,
      membership: memberships,
      user: users,
      branch: branches,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(memberships, eq(memberships.id, subscriptions.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(branches, eq(branches.id, subscriptions.branchId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        eq(memberships.status, 'active'),
        sql`(${subscriptions.schedule}->>'enabled')::boolean`,
        lte(subscriptions.startsOn, today),
        gte(subscriptions.expiresOn, today),
        sql`${subscriptions.creditsUsed} < ${subscriptions.credits}`,
        or(isNull(subscriptions.lastAutoOrderOn), lt(subscriptions.lastAutoOrderOn, today)),
      ),
    );

  let created = 0;
  for (const row of due) {
    const schedule = row.sub.schedule!;
    if (!schedule.days.includes(weekday)) continue;
    const pickupAt = tehranDateTime(today, schedule.time);
    const minutesToPickup = (pickupAt.getTime() - now.getTime()) / 60_000;
    if (minutesToPickup > AUTO_ORDER_LEAD_HOURS * 60) continue;

    // Mark first: a failure should not be retried every few minutes all day.
    await ctx.db
      .update(subscriptions)
      .set({ lastAutoOrderOn: today })
      .where(eq(subscriptions.id, row.sub.id));
    if (minutesToPickup < row.branch.settings.preorderMinLeadMinutes) continue;

    try {
      const itemId = await pickScheduledItem(ctx, row, today);
      if (!itemId) throw new AppError(409, 'no_item', 'هیچ غذای مناسبی برای امروز موجود نیست');
      const input: CheckoutInput = {
        lines: [{ itemId, quantity: 1, optionIds: [] }],
        useCredits: true,
        type: 'pickup',
        scheduledFor: pickupAt.toISOString(),
        paymentMethod: 'wallet',
      };
      await placeOrder(
        ctx,
        { sessionId: 'scheduler', user: row.user, branch: row.branch, membership: row.membership },
        input,
        { returnBase: '', source: 'subscription', subscriptionId: row.sub.id },
      );
      created++;
    } catch (err) {
      const reason = err instanceof AppError ? err.message : 'خطای سیستمی';
      await queueSms(ctx.db, {
        branchId: row.branch.id,
        phone: row.user.phone,
        template: 'campaign',
        body: `سفارش خودکار امروزِ «${row.plan.name}» ثبت نشد: ${reason}. می‌توانید از اپ سفارش دهید.\nپروچیا`,
      });
    }
  }
  return created;
}

async function pickScheduledItem(
  ctx: AppContext,
  row: {
    sub: typeof subscriptions.$inferSelect;
    plan: typeof plans.$inferSelect;
    user: typeof users.$inferSelect;
    branch: typeof branches.$inferSelect;
  },
  today: string,
): Promise<string | null> {
  const menu = await publicMenu(ctx, row.branch);
  const eligible = menu.categories
    .filter(
      (c) =>
        row.plan.eligibleCategoryIds.length === 0 || row.plan.eligibleCategoryIds.includes(c.id),
    )
    .flatMap((c) => c.items)
    .filter(
      (i) =>
        i.available &&
        i.creditEligible &&
        (row.plan.maxItemPrice === null || i.price <= row.plan.maxItemPrice) &&
        i.groups.every(
          (g) => g.minSelect === 0 || g.options.some((o) => o.isDefault && o.priceDelta === 0),
        ),
    );
  if (!eligible.length) return null;

  const schedule = row.sub.schedule!;
  if (schedule.mode === 'fixed') {
    const choices = schedule.itemIds.filter((id) => eligible.some((i) => i.id === id));
    if (!choices.length) return null;
    const dayIndex = Math.round((Date.parse(today) - Date.parse(row.sub.startsOn)) / 86_400_000);
    return choices[dayIndex % choices.length]!;
  }

  const [profile] = await ctx.db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, row.user.id));
  if (!profile) return eligible[0]!.id;
  const [best] = recommend(
    eligible,
    {
      goal: row.plan.goal ?? profile.goal,
      targets: profile.targets,
      mealsPerDay: profile.mealsPerDay,
      allergens: profile.allergens,
      dietPreferences: profile.dietPreferences,
    },
    'post_workout',
    {
      eatenToday: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      orderCounts: new Map(),
      ratings: new Map(),
    },
    1,
  );
  return best?.itemId ?? eligible[0]!.id;
}

/** Expires finished subscriptions and sends "running out" reminders once each. */
export async function subscriptionMaintenance(ctx: AppContext) {
  const now = ctx.now();
  const today = tehranIsoDate(now);
  await ctx.db
    .update(subscriptions)
    .set({ status: 'expired' })
    .where(and(eq(subscriptions.status, 'active'), lt(subscriptions.expiresOn, today)));

  const rows = await ctx.db
    .select({ sub: subscriptions, plan: plans, phone: users.phone, branch: branches })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(memberships, eq(memberships.id, subscriptions.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(branches, eq(branches.id, subscriptions.branchId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.creditsUsed} < ${subscriptions.credits}`,
      ),
    );

  for (const { sub, plan, phone, branch } of rows) {
    const remaining = sub.credits - sub.creditsUsed;
    if (!sub.expiryRemindedAt && sub.expiresOn <= addDaysIso(today, 3)) {
      await queueSms(ctx.db, {
        branchId: branch.id,
        phone,
        template: 'plan_expiring',
        body: smsText.planExpiring(
          plan.name,
          remaining,
          new Date(`${sub.expiresOn}T12:00:00+03:30`),
        ),
      });
      await ctx.db
        .update(subscriptions)
        .set({ expiryRemindedAt: now })
        .where(eq(subscriptions.id, sub.id));
    } else if (!sub.lowCreditsRemindedAt && remaining <= branch.settings.lowCreditsThreshold) {
      await queueSms(ctx.db, {
        branchId: branch.id,
        phone,
        template: 'low_credits',
        body: smsText.lowCredits(plan.name, remaining),
      });
      await ctx.db
        .update(subscriptions)
        .set({ lowCreditsRemindedAt: now })
        .where(eq(subscriptions.id, sub.id));
    }
  }
}

/** Birthday gifts, matched on the Jalali calendar the members actually celebrate by. */
export async function birthdayGifts(ctx: AppContext) {
  const now = ctx.now();
  const todayJ = toJalali(now);
  const branchRows = await ctx.db.select().from(branches).where(eq(branches.isActive, true));
  let issued = 0;

  for (const branch of branchRows) {
    const promotionId = branch.settings.birthdayPromotionId;
    if (!promotionId) continue;
    const [promotion] = await ctx.db
      .select()
      .from(promotions)
      .where(eq(promotions.id, promotionId));
    if (!promotion?.isActive) continue;

    const members = await ctx.db
      .select({
        membershipId: memberships.id,
        firstName: users.firstName,
        phone: users.phone,
        birthDate: users.birthDate,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.branchId, branch.id),
          eq(memberships.status, 'active'),
          sql`${users.birthDate} is not null`,
        ),
      );

    for (const m of members) {
      const b = isoDateToJalali(m.birthDate!);
      // Esfand 30 birthdays fall on Esfand 29 in common years.
      const matches =
        b.jm === todayJ.jm &&
        (b.jd === todayJ.jd || (b.jm === 12 && b.jd === 30 && todayJ.jd === 29));
      if (!matches) continue;
      const [already] = await ctx.db
        .select({ id: memberCodes.id })
        .from(memberCodes)
        .where(
          and(
            eq(memberCodes.membershipId, m.membershipId),
            eq(memberCodes.reason, 'birthday'),
            gte(memberCodes.createdAt, new Date(now.getTime() - 300 * 86_400_000)),
          ),
        );
      if (already) continue;
      const code = await issueMemberCode(ctx.db, {
        promotion,
        membershipId: m.membershipId,
        reason: 'birthday',
        now,
        prefix: 'BD',
      });
      await queueSms(ctx.db, {
        branchId: branch.id,
        phone: m.phone,
        template: 'birthday',
        body: smsText.birthday(m.firstName ?? 'دوست', code.code, promotion.title, code.expiresAt),
      });
      issued++;
    }
  }
  return issued;
}

/** Tiers are based on a rolling window, so they need recomputing even for members who stopped ordering. */
export async function refreshAllTiers(ctx: AppContext) {
  const branchRows = await ctx.db.select().from(branches).where(eq(branches.isActive, true));
  for (const branch of branchRows) {
    const rows = await ctx.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.branchId, branch.id), eq(memberships.status, 'active')));
    for (const r of rows) await refreshTier(ctx.db, branch, r.id, ctx.now());
  }
}
