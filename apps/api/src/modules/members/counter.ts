import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { memberships } from '../../db/schema';
import { AfterCommit } from '../../lib/after-commit';
import type { StaffAuth } from '../../lib/auth';
import { badRequest, notFound } from '../../lib/errors';
import { postpaidOutstanding } from '../orders/service';
import { createPayment, settlePayment } from '../payments/service';

/** A VIP member pays their tab at the counter. */
export async function settlePostpaidAtCounter(
  ctx: AppContext,
  auth: StaffAuth,
  membershipId: string,
) {
  const after = new AfterCommit();
  const amount = await ctx.db.transaction(async (tx) => {
    const [m] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.branchId, auth.branch.id)));
    if (!m) throw notFound('عضو پیدا نشد');
    const owed = await postpaidOutstanding(tx, membershipId);
    if (owed <= 0) throw badRequest('nothing_owed', 'بدهی تسویه‌نشده‌ای وجود ندارد');
    const payment = await createPayment(tx, {
      branchId: auth.branch.id,
      membershipId,
      purpose: 'postpaid_settlement',
      method: 'counter',
      amount: owed,
    });
    await settlePayment(ctx, tx, payment, after, { reviewedBy: auth.staff.id });
    return owed;
  });
  await after.flush(ctx);
  return { settled: amount };
}
