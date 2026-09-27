import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { PlanPurchaseInput, SubscriptionScheduleInput } from '@prochia/shared';
import { addDaysIso, tehranIsoDate } from '@prochia/shared';
import type { AppContext } from '../../context';
import type { Executor, Tx } from '../../db/client';
import { creditRedemptions, plans, subscriptions } from '../../db/schema';
import { AfterCommit } from '../../lib/after-commit';
import type { MemberAuth } from '../../lib/auth';
import type { Membership } from '../../lib/auth';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { CreditSource } from '../orders/pricing';
import { createPayment, startGateway } from '../payments/service';
import { walletDebit } from '../wallet/service';

export async function listPlans(db: Executor, branchId: string, { includeInactive = false } = {}) {
  const rows = await db
    .select()
    .from(plans)
    .where(
      includeInactive
        ? eq(plans.branchId, branchId)
        : and(eq(plans.branchId, branchId), eq(plans.isActive, true)),
    )
    .orderBy(asc(plans.sort), asc(plans.price));
  return rows.map((p) => ({
    ...p,
    pricePerMeal: Math.round(p.price / p.meals),
    savingPct:
      p.compareAtPrice && p.compareAtPrice > p.price
        ? Math.round((1 - p.price / p.compareAtPrice) * 100)
        : 0,
  }));
}

/** Credits usable on `onDate` (Tehran date), soonest-expiring first. */
export async function creditSources(
  db: Executor,
  membershipId: string,
  onDate: string,
): Promise<CreditSource[]> {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.membershipId, membershipId),
        eq(subscriptions.status, 'active'),
        lte(subscriptions.startsOn, onDate),
        gte(subscriptions.expiresOn, onDate),
        sql`${subscriptions.creditsUsed} < ${subscriptions.credits}`,
      ),
    )
    .orderBy(asc(subscriptions.expiresOn));
  return rows.map(({ sub, plan }) => ({
    subscriptionId: sub.id,
    planName: plan.name,
    remaining: sub.credits - sub.creditsUsed,
    expiresOn: sub.expiresOn,
    eligibleCategoryIds: plan.eligibleCategoryIds,
    maxItemPrice: plan.maxItemPrice,
  }));
}

export async function memberSubscriptions(db: Executor, membershipId: string) {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.membershipId, membershipId))
    .orderBy(desc(subscriptions.createdAt));
  return rows.map(({ sub, plan }) => ({
    id: sub.id,
    status: sub.status,
    credits: sub.credits,
    creditsUsed: sub.creditsUsed,
    remaining: sub.credits - sub.creditsUsed,
    startsOn: sub.startsOn,
    expiresOn: sub.expiresOn,
    pricePaid: sub.pricePaid,
    schedule: sub.schedule,
    plan: {
      id: plan.id,
      name: plan.name,
      kind: plan.kind,
      goal: plan.goal,
      mealsPerDay: plan.mealsPerDay,
    },
    createdAt: sub.createdAt,
  }));
}

export async function purchasePlan(
  ctx: AppContext,
  auth: MemberAuth & { membership: Membership },
  planId: string,
  input: PlanPurchaseInput,
  returnBase: string,
) {
  const now = ctx.now();
  const today = tehranIsoDate(now);
  const startsOn = input.startsOn ?? today;
  if (startsOn < today || startsOn > addDaysIso(today, 30)) {
    throw badRequest('invalid_start', 'تاریخ شروع باید از امروز تا ۳۰ روز آینده باشد');
  }
  if (input.method === 'card_to_card' && !input.cardToCard) {
    throw badRequest('card_details_required', 'کد پیگیری و ۴ رقم آخر کارت را وارد کنید');
  }

  const after = new AfterCommit();
  const result = await ctx.db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(plans)
      .where(
        and(eq(plans.id, planId), eq(plans.branchId, auth.branch.id), eq(plans.isActive, true)),
      );
    if (!plan) throw notFound('این بسته فعال نیست');

    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        branchId: auth.branch.id,
        membershipId: auth.membership.id,
        planId: plan.id,
        status: 'pending_payment',
        credits: plan.meals,
        startsOn,
        expiresOn: addDaysIso(startsOn, plan.validityDays - 1),
        pricePaid: plan.price,
      })
      .returning();

    const payment = await createPayment(tx, {
      branchId: auth.branch.id,
      membershipId: auth.membership.id,
      purpose: 'plan_purchase',
      method: input.method,
      amount: plan.price,
      subscriptionId: subscription!.id,
      cardToCard: input.cardToCard,
    });

    if (input.method === 'wallet') {
      await walletDebit(tx, auth.membership.id, plan.price, 'plan_purchase', {
        paymentId: payment.id,
        note: plan.name,
      });
      await tx
        .update(subscriptions)
        .set({ status: 'active' })
        .where(eq(subscriptions.id, subscription!.id));
    } else if (input.method === 'card_to_card') {
      after.publish(auth.branch.id, { type: 'payment.review', paymentId: payment.id });
    }
    return { plan, subscription: subscription!, payment };
  });
  await after.flush(ctx);

  let redirectUrl: string | null = null;
  if (input.method === 'gateway') {
    redirectUrl = await startGateway(ctx, result.payment, {
      returnBase,
      mobile: auth.user.phone,
      description: `خرید ${result.plan.name} — پروچیا`,
    });
  }
  return { subscriptionId: result.subscription.id, paymentId: result.payment.id, redirectUrl };
}

export async function setSchedule(
  ctx: AppContext,
  membershipId: string,
  subscriptionId: string,
  schedule: SubscriptionScheduleInput,
) {
  if (schedule.enabled && !schedule.days.length)
    throw badRequest('days_required', 'روزهای تحویل را انتخاب کنید');
  if (schedule.enabled && schedule.mode === 'fixed' && !schedule.itemIds.length) {
    throw badRequest('items_required', 'حداقل یک غذا برای برنامه ثابت انتخاب کنید');
  }
  const [row] = await ctx.db
    .update(subscriptions)
    .set({ schedule })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.membershipId, membershipId)))
    .returning();
  if (!row) throw notFound('اشتراک پیدا نشد');
  return row;
}

/** Takes credits from a subscription; fails if another order used them first. */
export async function consumeCredits(tx: Tx, subscriptionId: string, credits: number) {
  const [row] = await tx
    .update(subscriptions)
    .set({ creditsUsed: sql`${subscriptions.creditsUsed} + ${credits}` })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        sql`${subscriptions.creditsUsed} + ${credits} <= ${subscriptions.credits}`,
      ),
    )
    .returning({ id: subscriptions.id });
  if (!row) throw conflict('credits_exhausted', 'اعتبار بسته شما کافی نیست؛ دوباره تلاش کنید');
}

/** Returns credits to their subscriptions, for the whole order or specific lines. */
export async function reverseCredits(tx: Tx, orderId: string, now: Date, lineIds?: string[]) {
  const rows = await tx
    .select()
    .from(creditRedemptions)
    .where(
      and(eq(creditRedemptions.orderId, orderId), sql`${creditRedemptions.reversedAt} is null`),
    );
  const target = lineIds ? rows.filter((r) => lineIds.includes(r.orderLineId)) : rows;
  for (const r of target) {
    await tx
      .update(creditRedemptions)
      .set({ reversedAt: now })
      .where(eq(creditRedemptions.id, r.id));
    await tx
      .update(subscriptions)
      .set({ creditsUsed: sql`greatest(${subscriptions.creditsUsed} - ${r.credits}, 0)` })
      .where(eq(subscriptions.id, r.subscriptionId));
  }
  return target;
}
