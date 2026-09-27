import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { CardToCardInput, PaymentMethod, PaymentPurpose } from '@prochia/shared';
import { formatToman } from '@prochia/shared';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import {
  branches,
  memberships,
  orderEvents,
  orders,
  payments,
  subscriptions,
  users,
} from '../../db/schema';
import { AfterCommit } from '../../lib/after-commit';
import type { Branch, StaffAuth } from '../../lib/auth';
import { AppError, conflict, notFound } from '../../lib/errors';
import { refreshTier } from '../club/service';
import { queueSms, smsText } from '../notifications/sms';
import { closeOrder, maybeAutoAccept } from '../orders/service';
import { activeCashbackRules, cashbackFor, walletCredit } from '../wallet/service';

type Payment = typeof payments.$inferSelect;

export async function createPayment(
  tx: Tx,
  input: {
    branchId: string;
    membershipId: string;
    purpose: PaymentPurpose;
    method: Exclude<PaymentMethod, 'postpaid'>;
    amount: number;
    orderId?: string;
    subscriptionId?: string;
    cardToCard?: CardToCardInput;
  },
): Promise<Payment> {
  const settled = input.method === 'wallet' || input.method === 'counter';
  const [row] = await tx
    .insert(payments)
    .values({
      branchId: input.branchId,
      membershipId: input.membershipId,
      purpose: input.purpose,
      method: input.method,
      amount: input.amount,
      status: settled
        ? 'succeeded'
        : input.method === 'card_to_card'
          ? 'awaiting_review'
          : 'pending',
      paidAt: settled ? sql`now()` : null,
      orderId: input.orderId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      trackingCode: input.cardToCard?.trackingCode ?? null,
      cardLast4: input.cardToCard?.cardLast4 ?? null,
    })
    .returning();
  return row!;
}

/**
 * Sends the member to the bank. The callback returns to the same host the member came from, so
 * the session cookie and subdomain (gym) are preserved.
 */
export async function startGateway(
  ctx: AppContext,
  payment: Payment,
  opts: { returnBase: string; mobile: string; description: string },
): Promise<string> {
  try {
    const { authority, redirectUrl } = await ctx.gateway.request({
      amount: payment.amount,
      description: opts.description,
      callbackUrl: `${opts.returnBase}/api/v1/payments/${payment.id}/callback`,
      mobile: opts.mobile,
    });
    await ctx.db
      .update(payments)
      .set({ gateway: ctx.gateway.name, authority, meta: { returnBase: opts.returnBase } })
      .where(eq(payments.id, payment.id));
    return redirectUrl;
  } catch (err) {
    const after = new AfterCommit();
    await ctx.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, payment.id))
        .for('update');
      if (locked?.status === 'pending')
        await failPayment(ctx, tx, locked, after, 'gateway_unreachable');
    });
    await after.flush(ctx);
    throw new AppError(
      502,
      'gateway_unavailable',
      'درگاه پرداخت در دسترس نیست؛ کمی بعد یا با روش دیگری پرداخت کنید',
      {
        cause: String(err),
      },
    );
  }
}

/** Applies a successful payment to whatever it was for. Caller holds the payment row lock. */
export async function settlePayment(
  ctx: AppContext,
  tx: Tx,
  payment: Payment,
  after: AfterCommit,
  details: { refId?: string | null; cardPan?: string | null; reviewedBy?: string | null } = {},
) {
  const now = ctx.now();
  await tx
    .update(payments)
    .set({
      status: 'succeeded',
      paidAt: now,
      refId: details.refId ?? payment.refId,
      cardPan: details.cardPan ?? payment.cardPan,
      reviewedBy: details.reviewedBy ?? payment.reviewedBy,
      reviewedAt: details.reviewedBy ? now : payment.reviewedAt,
    })
    .where(eq(payments.id, payment.id));

  switch (payment.purpose) {
    case 'order': {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, payment.orderId!))
        .for('update');
      if (!order) break;
      if (order.status === 'cancelled' || order.status === 'rejected') {
        // Money arrived for an order that no longer exists (e.g. a late card-to-card review).
        await walletCredit(tx, payment.membershipId, payment.amount, 'refund', {
          paymentId: payment.id,
          orderId: order.id,
          note: 'بازگشت وجه سفارش لغوشده',
        });
        break;
      }
      const paidAmount = order.paidAmount + payment.amount;
      const wasAwaiting = order.status === 'awaiting_payment';
      await tx
        .update(orders)
        .set({
          paidAmount,
          paymentState: paidAmount >= order.total ? 'paid' : order.paymentState,
          status: wasAwaiting ? 'placed' : order.status,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'payment_succeeded',
        actorKind: details.reviewedBy ? 'staff' : 'system',
        actorId: details.reviewedBy ?? null,
        data: { paymentId: payment.id, method: payment.method, amount: payment.amount },
      });
      after.publish(order.branchId, {
        type: 'order.updated',
        orderId: order.id,
        status: wasAwaiting ? 'placed' : order.status,
        number: order.number,
      });
      if (wasAwaiting) after.run(() => maybeAutoAccept(ctx, order.id));
      break;
    }
    case 'wallet_topup': {
      await walletCredit(tx, payment.membershipId, payment.amount, 'topup', {
        paymentId: payment.id,
      });
      const rules = await activeCashbackRules(tx, payment.branchId, now);
      const bonus = cashbackFor(rules, payment.amount);
      if (bonus > 0) {
        await walletCredit(tx, payment.membershipId, bonus, 'bonus', {
          paymentId: payment.id,
          note: `پاداش شارژ ${formatToman(payment.amount)}`,
        });
      }
      break;
    }
    case 'plan_purchase': {
      await tx
        .update(subscriptions)
        .set({ status: 'active' })
        .where(eq(subscriptions.id, payment.subscriptionId!));
      after.run(async () => {
        const branch = await branchOf(ctx, payment.branchId);
        await refreshTier(ctx.db, branch, payment.membershipId, ctx.now());
      });
      break;
    }
    case 'postpaid_settlement': {
      await allocatePostpaid(tx, payment, now);
      break;
    }
  }
}

async function branchOf(ctx: AppContext, branchId: string): Promise<Branch> {
  const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
  return row!;
}

/** Pays off VIP orders oldest-first. */
async function allocatePostpaid(tx: Tx, payment: Payment, now: Date) {
  let left = payment.amount;
  const owed = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.membershipId, payment.membershipId), eq(orders.paymentState, 'postpaid')))
    .orderBy(asc(orders.createdAt))
    .for('update');
  for (const order of owed) {
    if (left <= 0) break;
    const due = order.total - order.paidAmount;
    const pay = Math.min(due, left);
    left -= pay;
    await tx
      .update(orders)
      .set({
        paidAmount: order.paidAmount + pay,
        paymentState: pay >= due ? 'paid' : 'postpaid',
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      type: 'postpaid_settled',
      actorKind: 'system',
      data: { paymentId: payment.id, amount: pay },
    });
  }
  // Paying more than owed is not possible through the app; anything left goes to the wallet.
  if (left > 0)
    await walletCredit(tx, payment.membershipId, left, 'postpaid_settlement', {
      paymentId: payment.id,
    });
}

export async function failPayment(
  ctx: AppContext,
  tx: Tx,
  payment: Payment,
  after: AfterCommit,
  reason: string,
) {
  await tx
    .update(payments)
    .set({ status: reason === 'cancelled_by_member' ? 'cancelled' : 'failed', reviewNote: reason })
    .where(eq(payments.id, payment.id));

  if (payment.purpose === 'order' && payment.orderId) {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .for('update');
    if (order?.status === 'awaiting_payment') {
      await closeOrder(ctx, tx, order, {
        status: 'cancelled',
        reason: 'پرداخت انجام نشد',
        actor: { kind: 'system' },
        after,
      });
    }
  }
  if (payment.purpose === 'plan_purchase' && payment.subscriptionId) {
    await tx
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(subscriptions.id, payment.subscriptionId),
          eq(subscriptions.status, 'pending_payment'),
        ),
      );
  }
}

const RETURN_PATHS: Record<PaymentPurpose, (p: Payment, ok: boolean) => string> = {
  order: (p, ok) => `/orders/${p.orderId}?payment=${ok ? 'ok' : 'failed'}`,
  wallet_topup: (_p, ok) => `/wallet?topup=${ok ? 'ok' : 'failed'}`,
  plan_purchase: (_p, ok) => `/plans?purchase=${ok ? 'ok' : 'failed'}`,
  postpaid_settlement: (_p, ok) => `/wallet?settle=${ok ? 'ok' : 'failed'}`,
};

/** The bank redirects the member here. Verifies with the gateway and returns where to send them. */
export async function handleGatewayCallback(
  ctx: AppContext,
  paymentId: string,
  authority: string,
  status: string,
) {
  const after = new AfterCommit();
  const outcome = await ctx.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');
    if (!payment || payment.authority !== authority) throw notFound('تراکنش پیدا نشد');
    if (payment.status === 'succeeded') return { payment, ok: true };
    if (payment.status !== 'pending') return { payment, ok: false };

    if (status !== 'OK') {
      await failPayment(ctx, tx, payment, after, 'cancelled_by_member');
      return { payment, ok: false };
    }
    const verification = await ctx.gateway.verify({ authority, amount: payment.amount });
    if (!verification.ok) {
      await failPayment(ctx, tx, payment, after, verification.message ?? 'verify_failed');
      return { payment, ok: false };
    }
    await settlePayment(ctx, tx, payment, after, {
      refId: verification.refId,
      cardPan: verification.cardPan,
    });
    return { payment, ok: true };
  });
  await after.flush(ctx);
  return RETURN_PATHS[outcome.payment.purpose](outcome.payment, outcome.ok);
}

/** Staff decision on a card-to-card receipt. */
export async function reviewPayment(
  ctx: AppContext,
  auth: StaffAuth,
  paymentId: string,
  approve: boolean,
  note?: string,
) {
  const after = new AfterCommit();
  const payment = await ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.branchId, auth.branch.id)))
      .for('update');
    if (!p) throw notFound('پرداخت پیدا نشد');
    if (p.status !== 'awaiting_review')
      throw conflict('already_reviewed', 'این پرداخت قبلاً بررسی شده است');

    if (approve) {
      await settlePayment(ctx, tx, p, after, { reviewedBy: auth.staff.id });
    } else {
      await tx
        .update(payments)
        .set({
          status: 'failed',
          reviewedBy: auth.staff.id,
          reviewedAt: ctx.now(),
          reviewNote: note ?? null,
        })
        .where(eq(payments.id, p.id));
      if (p.purpose === 'plan_purchase' && p.subscriptionId) {
        await tx
          .update(subscriptions)
          .set({ status: 'cancelled' })
          .where(eq(subscriptions.id, p.subscriptionId));
      }
      if (p.purpose === 'order' && p.orderId) {
        // The order stays in the kitchen flow; it now has to be paid at the counter before handover.
        await tx.insert(orderEvents).values({
          orderId: p.orderId,
          type: 'payment_rejected',
          actorKind: 'staff',
          actorId: auth.staff.id,
          data: { paymentId: p.id, note: note ?? null },
        });
      }
    }
    await tx
      .update(payments)
      .set({ reviewNote: note ?? null })
      .where(eq(payments.id, p.id));
    return p;
  });

  const [member] = await ctx.db
    .select({ phone: users.phone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, payment.membershipId));
  if (member) {
    await queueSms(ctx.db, {
      branchId: payment.branchId,
      phone: member.phone,
      template: 'payment_reviewed',
      body: smsText.paymentReviewed(approve, formatToman(payment.amount)),
    });
  }
  await after.flush(ctx);
}

/** Gateway payments abandoned at the bank are closed after 30 minutes, releasing held stock and credits. */
export async function expireStalePayments(ctx: AppContext) {
  const cutoff = new Date(ctx.now().getTime() - 30 * 60_000);
  const stale = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'pending'),
        eq(payments.method, 'gateway'),
        lt(payments.createdAt, cutoff),
      ),
    )
    .limit(50);
  for (const { id } of stale) {
    const after = new AfterCommit();
    await ctx.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, id))
        .for('update', { skipLocked: true });
      if (p?.status === 'pending') await failPayment(ctx, tx, p, after, 'expired');
    });
    await after.flush(ctx);
  }
  return stale.length;
}
