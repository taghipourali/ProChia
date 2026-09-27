import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { WalletEntryKind } from '@prochia/shared';
import { formatToman } from '@prochia/shared';
import type { Executor, Tx } from '../../db/client';
import { cashbackRules, memberships, walletEntries } from '../../db/schema';
import { badRequest, conflict } from '../../lib/errors';

interface EntryRefs {
  paymentId?: string | null;
  orderId?: string | null;
  staffId?: string | null;
  note?: string | null;
}

async function lockBalance(tx: Tx, membershipId: string) {
  const [row] = await tx
    .select({ balance: memberships.walletBalance })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .for('update');
  if (!row) throw badRequest('membership_not_found', 'عضویت پیدا نشد');
  return row.balance;
}

export async function walletCredit(
  tx: Tx,
  membershipId: string,
  amount: number,
  kind: WalletEntryKind,
  refs: EntryRefs = {},
) {
  if (amount <= 0) return null;
  const balance = (await lockBalance(tx, membershipId)) + amount;
  await tx
    .update(memberships)
    .set({ walletBalance: balance })
    .where(eq(memberships.id, membershipId));
  const [entry] = await tx
    .insert(walletEntries)
    .values({ membershipId, amount, balanceAfter: balance, kind, ...refs })
    .returning();
  return entry!;
}

export async function walletDebit(
  tx: Tx,
  membershipId: string,
  amount: number,
  kind: WalletEntryKind,
  refs: EntryRefs = {},
) {
  if (amount <= 0) return null;
  const current = await lockBalance(tx, membershipId);
  if (current < amount) {
    throw conflict(
      'insufficient_wallet',
      `موجودی کیف پول کافی نیست (موجودی: ${formatToman(current)})`,
      {
        balance: current,
        required: amount,
      },
    );
  }
  const balance = current - amount;
  await tx
    .update(memberships)
    .set({ walletBalance: balance })
    .where(eq(memberships.id, membershipId));
  const [entry] = await tx
    .insert(walletEntries)
    .values({ membershipId, amount: -amount, balanceAfter: balance, kind, ...refs })
    .returning();
  return entry!;
}

/** Active top-up bonus tiers, lowest threshold first — shown on the top-up screen. */
export async function activeCashbackRules(db: Executor, branchId: string, now: Date) {
  return db
    .select()
    .from(cashbackRules)
    .where(
      and(
        eq(cashbackRules.branchId, branchId),
        eq(cashbackRules.isActive, true),
        or(isNull(cashbackRules.startsAt), lte(cashbackRules.startsAt, now)),
        or(isNull(cashbackRules.endsAt), gt(cashbackRules.endsAt, now)),
      ),
    )
    .orderBy(asc(cashbackRules.minAmount));
}

export function cashbackFor(
  rules: { minAmount: number; percent: number; maxBonus: number | null }[],
  amount: number,
) {
  let best = 0;
  for (const rule of rules) {
    if (amount < rule.minAmount) continue;
    const bonus = Math.min(
      Math.floor((amount * rule.percent) / 100),
      rule.maxBonus ?? Number.POSITIVE_INFINITY,
    );
    best = Math.max(best, bonus);
  }
  return best;
}

export async function walletHistory(db: Executor, membershipId: string, limit = 50) {
  return db
    .select()
    .from(walletEntries)
    .where(eq(walletEntries.membershipId, membershipId))
    .orderBy(desc(walletEntries.createdAt))
    .limit(limit);
}

/** Sum of a member's wallet movements by kind in a period — for the staff member view. */
export async function walletTotals(db: Executor, membershipId: string) {
  return db
    .select({ kind: walletEntries.kind, total: sql<number>`sum(${walletEntries.amount})` })
    .from(walletEntries)
    .where(eq(walletEntries.membershipId, membershipId))
    .groupBy(walletEntries.kind);
}
