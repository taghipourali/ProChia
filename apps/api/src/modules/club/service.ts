import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Goal } from '@prochia/shared';
import { addDaysIso, tehranIsoDate } from '@prochia/shared';
import type { Executor, Tx } from '../../db/client';
import { gather } from '../../db/gather';
import {
  healthProfiles,
  memberCodes,
  memberships,
  orders,
  promotionRedemptions,
  promotions,
  subscriptions,
  tiers,
} from '../../db/schema';
import type { Branch, Membership } from '../../lib/auth';
import { shortCode } from '../../lib/crypto';
import type { PricingPromotion } from '../orders/pricing';

type Promotion = typeof promotions.$inferSelect;
type Tier = typeof tiers.$inferSelect;

/** Spend that counts toward the club tier: completed orders plus package purchases in the window. */
export async function memberSpend(
  db: Executor,
  membershipId: string,
  windowDays: number,
  now: Date,
) {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const [orderSpend] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.membershipId, membershipId),
        eq(orders.status, 'completed'),
        gte(orders.completedAt, since),
      ),
    );
  const [planSpend] = await db
    .select({ total: sql<number>`coalesce(sum(${subscriptions.pricePaid}), 0)` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.membershipId, membershipId),
        inArray(subscriptions.status, ['active', 'expired']),
        gte(subscriptions.createdAt, since),
      ),
    );
  return (orderSpend?.total ?? 0) + (planSpend?.total ?? 0);
}

export async function branchTiers(db: Executor, branchId: string) {
  return db.select().from(tiers).where(eq(tiers.branchId, branchId)).orderBy(asc(tiers.minSpend));
}

export function tierForSpend(sorted: Tier[], spend: number): Tier | null {
  let current: Tier | null = null;
  for (const t of sorted) if (spend >= t.minSpend) current = t;
  return current;
}

/** Recomputes and stores a member's tier. Tiers can go down as old spend leaves the window. */
export async function refreshTier(db: Executor, branch: Branch, membershipId: string, now: Date) {
  const [sorted, spend] = await gather(db, [
    () => branchTiers(db, branch.id),
    () => memberSpend(db, membershipId, branch.settings.tierWindowDays, now),
  ] as const);
  const tier = tierForSpend(sorted, spend);
  await db
    .update(memberships)
    .set({ tierId: tier?.id ?? null })
    .where(eq(memberships.id, membershipId));
  return { tier, spend, tiers: sorted };
}

export async function clubStatus(db: Executor, branch: Branch, membership: Membership, now: Date) {
  const { tier, spend, tiers: sorted } = await refreshTier(db, branch, membership.id, now);
  const next = sorted.find((t) => t.minSpend > spend) ?? null;
  return {
    tier,
    next,
    spend,
    windowDays: branch.settings.tierWindowDays,
    toNext: next ? next.minSpend - spend : 0,
    tiers: sorted,
    discountPct: effectiveMemberDiscountPct(membership, tier),
  };
}

export function effectiveMemberDiscountPct(
  membership: Pick<Membership, 'personalDiscountPct'>,
  tier: Pick<Tier, 'discountPct'> | null,
) {
  return Math.max(membership.personalDiscountPct, tier?.discountPct ?? 0);
}

export async function memberTier(db: Executor, membership: Membership) {
  if (!membership.tierId) return null;
  const [tier] = await db.select().from(tiers).where(eq(tiers.id, membership.tierId));
  return tier ?? null;
}

// ─── Promotions ──────────────────────────────────────────────────────────────

interface PromotionContext {
  branchId: string;
  membership: Membership;
  goal: Goal | null;
  now: Date;
}

async function isFirstOrder(db: Executor, membershipId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(
      and(
        eq(orders.membershipId, membershipId),
        notInArray(orders.status, ['rejected', 'cancelled', 'awaiting_payment']),
      ),
    );
  return (row?.n ?? 0) === 0;
}

async function usageOk(db: Executor, promo: Promotion, membershipId: string) {
  const conditions = [
    eq(promotionRedemptions.promotionId, promo.id),
    isNull(promotionRedemptions.reversedAt),
  ];
  const [total] = await db
    .select({ n: sql<number>`count(*)` })
    .from(promotionRedemptions)
    .where(and(...conditions));
  if (promo.usageLimit !== null && (total?.n ?? 0) >= promo.usageLimit) return false;
  const [mine] = await db
    .select({ n: sql<number>`count(*)` })
    .from(promotionRedemptions)
    .where(and(...conditions, eq(promotionRedemptions.membershipId, membershipId)));
  return (mine?.n ?? 0) < promo.perMemberLimit;
}

async function audienceOk(db: Executor, promo: Promotion, pc: PromotionContext) {
  switch (promo.audience) {
    case 'all':
    case 'personal':
      return true;
    case 'tier':
      return promo.tierId !== null && pc.membership.tierId === promo.tierId;
    case 'goal':
      return promo.goal !== null && pc.goal === promo.goal;
    case 'first_order':
      return isFirstOrder(db, pc.membership.id);
  }
}

function isLive(promo: Promotion, now: Date) {
  return (
    promo.isActive &&
    (!promo.startsAt || promo.startsAt <= now) &&
    (!promo.endsAt || promo.endsAt > now)
  );
}

const toPricing = (p: Promotion, memberCodeId: string | null = null): PricingPromotion => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  value: p.value,
  maxDiscount: p.maxDiscount,
  minOrder: p.minOrder,
  memberCodeId,
});

export async function memberGoal(db: Executor, userId: string): Promise<Goal | null> {
  const [row] = await db
    .select({ goal: healthProfiles.goal })
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, userId));
  return row?.goal ?? null;
}

/**
 * Finds the promotion for a checkout. A typed code must be valid for this member (otherwise the
 * reason is returned for display). Without a code, the best automatic promotion is picked by the
 * caller comparing discounts — here we return every eligible one.
 */
export async function resolvePromotion(
  db: Executor,
  pc: PromotionContext,
  code: string | undefined,
): Promise<{
  promotion: PricingPromotion | null;
  candidates: PricingPromotion[];
  error: string | null;
}> {
  if (code) {
    const normalized = code.trim().toUpperCase();
    const [personal] = await db
      .select({ code: memberCodes, promo: promotions })
      .from(memberCodes)
      .innerJoin(promotions, eq(promotions.id, memberCodes.promotionId))
      .where(and(eq(memberCodes.code, normalized), eq(promotions.branchId, pc.branchId)));
    if (personal) {
      if (personal.code.membershipId !== pc.membership.id)
        return { promotion: null, candidates: [], error: 'این کد متعلق به حساب دیگری است' };
      if (personal.code.usedAt)
        return { promotion: null, candidates: [], error: 'این کد قبلاً استفاده شده است' };
      if (personal.code.expiresAt <= pc.now)
        return { promotion: null, candidates: [], error: 'مهلت این کد تمام شده است' };
      if (!personal.promo.isActive)
        return { promotion: null, candidates: [], error: 'این کد فعال نیست' };
      return {
        promotion: toPricing(personal.promo, personal.code.id),
        candidates: [],
        error: null,
      };
    }

    const [promo] = await db
      .select()
      .from(promotions)
      .where(
        and(eq(promotions.branchId, pc.branchId), eq(sql`upper(${promotions.code})`, normalized)),
      );
    if (!promo || promo.audience === 'personal' || !isLive(promo, pc.now)) {
      return { promotion: null, candidates: [], error: 'کد تخفیف معتبر نیست' };
    }
    if (!(await audienceOk(db, promo, pc)))
      return { promotion: null, candidates: [], error: 'این کد شامل حساب شما نمی‌شود' };
    if (!(await usageOk(db, promo, pc.membership.id))) {
      return { promotion: null, candidates: [], error: 'سقف استفاده از این کد پر شده است' };
    }
    return { promotion: toPricing(promo), candidates: [], error: null };
  }

  const automatic = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.branchId, pc.branchId),
        isNull(promotions.code),
        eq(promotions.isActive, true),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, pc.now)),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, pc.now)),
      ),
    );
  const candidates: PricingPromotion[] = [];
  for (const promo of automatic) {
    if (promo.audience === 'personal') continue;
    if ((await audienceOk(db, promo, pc)) && (await usageOk(db, promo, pc.membership.id)))
      candidates.push(toPricing(promo));
  }
  return { promotion: null, candidates, error: null };
}

export async function recordRedemption(
  tx: Tx,
  input: {
    promotion: PricingPromotion;
    membershipId: string;
    orderId: string;
    amount: number;
    now: Date;
  },
) {
  await tx.insert(promotionRedemptions).values({
    promotionId: input.promotion.id,
    membershipId: input.membershipId,
    orderId: input.orderId,
    memberCodeId: input.promotion.memberCodeId,
    amount: input.amount,
  });
  if (input.promotion.memberCodeId) {
    await tx
      .update(memberCodes)
      .set({ usedAt: input.now })
      .where(eq(memberCodes.id, input.promotion.memberCodeId));
  }
}

/** Gives the discount back when an order is cancelled or rejected. */
export async function reverseRedemption(tx: Tx, orderId: string, now: Date) {
  const rows = await tx
    .update(promotionRedemptions)
    .set({ reversedAt: now })
    .where(and(eq(promotionRedemptions.orderId, orderId), isNull(promotionRedemptions.reversedAt)))
    .returning();
  for (const r of rows) {
    if (r.memberCodeId)
      await tx.update(memberCodes).set({ usedAt: null }).where(eq(memberCodes.id, r.memberCodeId));
  }
}

export async function issueMemberCode(
  tx: Executor,
  input: { promotion: Promotion; membershipId: string; reason: string; now: Date; prefix?: string },
) {
  const expiresAt = new Date(
    `${addDaysIso(tehranIsoDate(input.now), input.promotion.personalCodeDays)}T23:59:59+03:30`,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${input.prefix ?? 'PC'}-${shortCode(5)}`;
    const [row] = await tx
      .insert(memberCodes)
      .values({
        promotionId: input.promotion.id,
        membershipId: input.membershipId,
        code,
        reason: input.reason,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
  }
  throw new Error('could not allocate a unique member code');
}

/** Promotions a member can see on the club page: automatic ones they qualify for and their own codes. */
export async function memberOffers(db: Executor, pc: PromotionContext) {
  const { candidates } = await resolvePromotion(db, pc, undefined);
  const codes = await db
    .select({
      code: memberCodes.code,
      expiresAt: memberCodes.expiresAt,
      reason: memberCodes.reason,
      promo: promotions,
    })
    .from(memberCodes)
    .innerJoin(promotions, eq(promotions.id, memberCodes.promotionId))
    .where(
      and(
        eq(memberCodes.membershipId, pc.membership.id),
        isNull(memberCodes.usedAt),
        gt(memberCodes.expiresAt, pc.now),
      ),
    )
    .orderBy(desc(memberCodes.createdAt));
  const publicCodes = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.branchId, pc.branchId),
        eq(promotions.isActive, true),
        sql`${promotions.code} is not null`,
        inArray(promotions.audience, ['all', 'tier', 'goal', 'first_order']),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, pc.now)),
      ),
    );
  const visibleCodes = [];
  for (const p of publicCodes) {
    if ((await audienceOk(db, p, pc)) && (await usageOk(db, p, pc.membership.id)))
      visibleCodes.push(p);
  }
  return {
    automatic: candidates,
    personalCodes: codes.map((c) => ({
      code: c.code,
      expiresAt: c.expiresAt,
      reason: c.reason,
      title: c.promo.title,
      kind: c.promo.kind,
      value: c.promo.value,
    })),
    publicCodes: visibleCodes.map((p) => ({
      code: p.code!,
      title: p.title,
      description: p.description,
      kind: p.kind,
      value: p.value,
      minOrder: p.minOrder,
      endsAt: p.endsAt,
    })),
  };
}
