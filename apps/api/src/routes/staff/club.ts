import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cashbackRuleInput, planInput, promotionInput, tierInput } from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  cashbackRules,
  memberships,
  plans,
  promotionRedemptions,
  promotions,
  subscriptions,
  tiers,
  users,
} from '../../db/schema';
import { requireStaff } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { listPlans } from '../../modules/plans/service';

const idParam = z.object({ id: z.uuid() });

export function staffClubRoutes(app: FastifyInstance, ctx: AppContext) {
  // ─── Tiers ─────────────────────────────────────────────────────────────────
  app.get('/api/v1/staff/tiers', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    const rows = await ctx.db
      .select()
      .from(tiers)
      .where(eq(tiers.branchId, branch.id))
      .orderBy(asc(tiers.minSpend));
    const counts = await ctx.db
      .select({ tierId: memberships.tierId, n: sql<number>`count(*)` })
      .from(memberships)
      .where(eq(memberships.branchId, branch.id))
      .groupBy(memberships.tierId);
    return rows.map((t) => ({ ...t, members: counts.find((c) => c.tierId === t.id)?.n ?? 0 }));
  });

  app.post('/api/v1/staff/tiers', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .insert(tiers)
      .values({ ...parse(tierInput, req.body), branchId: branch.id })
      .returning();
    return row;
  });

  app.put('/api/v1/staff/tiers/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .update(tiers)
      .set(parse(tierInput, req.body))
      .where(and(eq(tiers.id, parse(idParam, req.params).id), eq(tiers.branchId, branch.id)))
      .returning();
    if (!row) throw notFound('سطح پیدا نشد');
    return row;
  });

  // ─── Promotions ────────────────────────────────────────────────────────────
  app.get('/api/v1/staff/promotions', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    const usage = sql<number>`(select count(*) from ${promotionRedemptions} r where r.promotion_id = ${promotions.id} and r.reversed_at is null)`;
    const given = sql<number>`(select coalesce(sum(amount), 0) from ${promotionRedemptions} r where r.promotion_id = ${promotions.id} and r.reversed_at is null)`;
    return ctx.db
      .select({ promotion: promotions, used: usage, discountGiven: given })
      .from(promotions)
      .where(eq(promotions.branchId, branch.id))
      .orderBy(desc(promotions.createdAt));
  });

  const promoValues = (body: unknown) => {
    const p = parse(promotionInput, body);
    return {
      ...p,
      startsAt: p.startsAt ? new Date(p.startsAt) : null,
      endsAt: p.endsAt ? new Date(p.endsAt) : null,
      // Personal promotions are only reachable through issued member codes.
      code: p.audience === 'personal' ? null : p.code,
    };
  };

  app.post('/api/v1/staff/promotions', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .insert(promotions)
      .values({ ...promoValues(req.body), branchId: branch.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('duplicate_code', 'این کد تخفیف قبلاً استفاده شده است');
    return row;
  });

  app.put('/api/v1/staff/promotions/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .update(promotions)
      .set(promoValues(req.body))
      .where(
        and(eq(promotions.id, parse(idParam, req.params).id), eq(promotions.branchId, branch.id)),
      )
      .returning();
    if (!row) throw notFound('تخفیف پیدا نشد');
    return row;
  });

  // ─── Top-up cashback ───────────────────────────────────────────────────────
  app.get('/api/v1/staff/cashback', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    return ctx.db
      .select()
      .from(cashbackRules)
      .where(eq(cashbackRules.branchId, branch.id))
      .orderBy(asc(cashbackRules.minAmount));
  });

  const cashbackValues = (body: unknown) => {
    const c = parse(cashbackRuleInput, body);
    return {
      ...c,
      startsAt: c.startsAt ? new Date(c.startsAt) : null,
      endsAt: c.endsAt ? new Date(c.endsAt) : null,
    };
  };

  app.post('/api/v1/staff/cashback', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .insert(cashbackRules)
      .values({ ...cashbackValues(req.body), branchId: branch.id })
      .returning();
    return row;
  });

  app.put('/api/v1/staff/cashback/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'club.edit');
    const [row] = await ctx.db
      .update(cashbackRules)
      .set(cashbackValues(req.body))
      .where(
        and(
          eq(cashbackRules.id, parse(idParam, req.params).id),
          eq(cashbackRules.branchId, branch.id),
        ),
      )
      .returning();
    if (!row) throw notFound('قانون پیدا نشد');
    return row;
  });

  // ─── Plans & packages ──────────────────────────────────────────────────────
  app.get('/api/v1/staff/plans', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    const rows = await listPlans(ctx.db, branch.id, { includeInactive: true });
    const stats = await ctx.db
      .select({
        planId: subscriptions.planId,
        active: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')`,
        sold: sql<number>`count(*) filter (where ${subscriptions.status} in ('active', 'expired'))`,
        revenue: sql<number>`coalesce(sum(${subscriptions.pricePaid}) filter (where ${subscriptions.status} in ('active', 'expired')), 0)`,
      })
      .from(subscriptions)
      .where(eq(subscriptions.branchId, branch.id))
      .groupBy(subscriptions.planId);
    return rows.map((p) => ({
      ...p,
      stats: stats.find((s) => s.planId === p.id) ?? { active: 0, sold: 0, revenue: 0 },
    }));
  });

  app.post('/api/v1/staff/plans', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'plans.edit');
    const [row] = await ctx.db
      .insert(plans)
      .values({ ...parse(planInput, req.body), branchId: branch.id })
      .returning();
    return row;
  });

  app.put('/api/v1/staff/plans/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'plans.edit');
    const [row] = await ctx.db
      .update(plans)
      .set(parse(planInput, req.body))
      .where(and(eq(plans.id, parse(idParam, req.params).id), eq(plans.branchId, branch.id)))
      .returning();
    if (!row) throw notFound('بسته پیدا نشد');
    return row;
  });

  app.get('/api/v1/staff/subscriptions', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    return ctx.db
      .select({
        subscription: subscriptions,
        planName: plans.name,
        member: {
          firstName: users.firstName,
          lastName: users.lastName,
          phone: users.phone,
          membershipId: memberships.id,
        },
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(memberships, eq(memberships.id, subscriptions.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(subscriptions.branchId, branch.id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(300);
  });
}
