import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { MembershipStatus } from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  healthProfiles,
  memberships,
  memberWhitelist,
  orders,
  tiers,
  users,
} from '../../db/schema';
import { AfterCommit } from '../../lib/after-commit';
import type { StaffAuth } from '../../lib/auth';
import { badRequest, notFound } from '../../lib/errors';
import { memberSubscriptions } from '../plans/service';
import { memberOrders, postpaidOutstanding } from '../orders/service';
import {
  activeCashbackRules,
  cashbackFor,
  walletCredit,
  walletDebit,
  walletHistory,
} from '../wallet/service';
import { settlePostpaidAtCounter } from './counter';

export async function listMembers(
  ctx: AppContext,
  branchId: string,
  filter: { q?: string; status?: MembershipStatus; vip?: boolean; limit?: number; offset?: number },
) {
  const conditions: SQL[] = [eq(memberships.branchId, branchId)];
  if (filter.status) conditions.push(eq(memberships.status, filter.status));
  if (filter.vip) conditions.push(eq(memberships.isVip, true));
  if (filter.q) {
    const q = `%${filter.q.trim()}%`;
    conditions.push(
      or(
        ilike(users.phone, q),
        ilike(users.firstName, q),
        ilike(users.lastName, q),
        ilike(memberships.gymMemberCode, q),
      )!,
    );
  }
  const lastOrder = sql<Date | null>`(select max(${orders.createdAt}) from ${orders} where ${orders.membershipId} = ${memberships.id})`;
  return ctx.db
    .select({
      id: memberships.id,
      status: memberships.status,
      isVip: memberships.isVip,
      creditLimit: memberships.creditLimit,
      personalDiscountPct: memberships.personalDiscountPct,
      walletBalance: memberships.walletBalance,
      gymMemberCode: memberships.gymMemberCode,
      tierName: tiers.name,
      createdAt: memberships.createdAt,
      userId: users.id,
      phone: users.phone,
      firstName: users.firstName,
      lastName: users.lastName,
      goal: healthProfiles.goal,
      lastOrderAt: lastOrder,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(tiers, eq(tiers.id, memberships.tierId))
    .leftJoin(healthProfiles, eq(healthProfiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(sql`${memberships.status} = 'pending' desc`, desc(memberships.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0);
}

export async function memberDetail(ctx: AppContext, branchId: string, membershipId: string) {
  const [row] = await ctx.db
    .select({ membership: memberships, user: users, tierName: tiers.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(tiers, eq(tiers.id, memberships.tierId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.branchId, branchId)));
  if (!row) throw notFound('عضو پیدا نشد');
  const [health] = await ctx.db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, row.user.id));
  const [wallet, orderList, subs, owed] = await Promise.all([
    walletHistory(ctx.db, membershipId, 30),
    memberOrders(ctx, membershipId, 20),
    memberSubscriptions(ctx.db, membershipId),
    postpaidOutstanding(ctx.db, membershipId),
  ]);
  return {
    ...row,
    health: health ?? null,
    wallet,
    orders: orderList,
    subscriptions: subs,
    postpaidOwed: owed,
  };
}

export async function updateMember(
  ctx: AppContext,
  auth: StaffAuth,
  membershipId: string,
  patch: Partial<
    Pick<
      typeof memberships.$inferInsert,
      'status' | 'isVip' | 'creditLimit' | 'personalDiscountPct' | 'gymMemberCode' | 'note'
    >
  >,
) {
  const [current] = await ctx.db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.branchId, auth.branch.id)));
  if (!current) throw notFound('عضو پیدا نشد');
  const approving = patch.status === 'active' && current.status === 'pending';
  const [row] = await ctx.db
    .update(memberships)
    .set({
      ...patch,
      ...(approving ? { approvedAt: ctx.now(), approvedBy: auth.staff.id } : {}),
    })
    .where(eq(memberships.id, membershipId))
    .returning();
  return row!;
}

/**
 * Staff-side wallet operations. A counter top-up (cash or card reader at the desk) earns the same
 * bonus as an online top-up; an adjustment is a plain correction and needs a reason.
 */
export async function adjustWallet(
  ctx: AppContext,
  auth: StaffAuth,
  membershipId: string,
  input: { kind: 'topup' | 'adjustment'; amount: number; note: string },
) {
  const after = new AfterCommit();
  await ctx.db.transaction(async (tx) => {
    const [m] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.branchId, auth.branch.id)));
    if (!m) throw notFound('عضو پیدا نشد');
    const refs = { staffId: auth.staff.id, note: input.note };
    if (input.kind === 'topup') {
      if (input.amount <= 0) throw badRequest('invalid_amount', 'مبلغ شارژ باید مثبت باشد');
      await walletCredit(tx, membershipId, input.amount, 'topup', refs);
      const bonus = cashbackFor(
        await activeCashbackRules(tx, auth.branch.id, ctx.now()),
        input.amount,
      );
      if (bonus > 0)
        await walletCredit(tx, membershipId, bonus, 'bonus', { ...refs, note: 'پاداش شارژ حضوری' });
    } else if (input.amount > 0) {
      await walletCredit(tx, membershipId, input.amount, 'adjustment', refs);
    } else {
      await walletDebit(tx, membershipId, -input.amount, 'adjustment', refs);
    }
  });
  await after.flush(ctx);
}

export async function importWhitelist(
  ctx: AppContext,
  branchId: string,
  entries: { phone: string; gymMemberCode: string | null; note: string | null }[],
) {
  let added = 0;
  await ctx.db.transaction(async (tx) => {
    for (const e of entries) {
      const res = await tx
        .insert(memberWhitelist)
        .values({ branchId, phone: e.phone, gymMemberCode: e.gymMemberCode, note: e.note })
        .onConflictDoUpdate({
          target: [memberWhitelist.branchId, memberWhitelist.phone],
          set: { gymMemberCode: e.gymMemberCode, note: e.note },
        })
        .returning({ id: memberWhitelist.id });
      added += res.length;
      // Anyone already waiting with a listed number is approved right away.
      await tx.execute(sql`
        update ${memberships} m set status = 'active', approved_at = now(), gym_member_code = coalesce(${e.gymMemberCode}, m.gym_member_code)
        from ${users} u
        where u.id = m.user_id and m.branch_id = ${branchId} and m.status = 'pending' and u.phone = ${e.phone}
      `);
    }
  });
  return { added };
}

export { settlePostpaidAtCounter };
