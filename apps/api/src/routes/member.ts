import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  MEAL_SLOTS,
  analyticsEventsInput,
  cartInput,
  checkoutInput,
  healthProfileInput,
  orderRatingInput,
  planPurchaseInput,
  postpaidSettleInput,
  profileInput,
  subscriptionScheduleInput,
  walletTopupInput,
  weightLogInput,
} from '@prochia/shared';
import type { AppContext } from '../context';
import { AfterCommit } from '../lib/after-commit';
import { getMember, requireActiveMember, requireBranch, requireMember } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { openEventStream, requestOrigin } from '../lib/http';
import { parse } from '../lib/validate';
import { recordEvents } from '../modules/analytics/service';
import { clubStatus, memberGoal, memberOffers } from '../modules/club/service';
import {
  healthProfileView,
  insights,
  logWeight,
  me,
  saveHealthProfile,
  updateProfile,
} from '../modules/members/service';
import {
  cancelOrderByMember,
  memberOrder,
  memberOrders,
  placeOrder,
  postpaidOutstanding,
  quoteCart,
  rateOrder,
} from '../modules/orders/service';
import { createPayment, settlePayment, startGateway } from '../modules/payments/service';
import { memberSubscriptions, purchasePlan, setSchedule } from '../modules/plans/service';
import { recommendationsFor } from '../modules/recommendations/service';
import {
  activeCashbackRules,
  cashbackFor,
  walletDebit,
  walletHistory,
} from '../modules/wallet/service';

const idParam = z.object({ id: z.uuid() });

export function memberRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/me', async (req) => {
    const auth = await getMember(ctx, req);
    if (!auth) return { user: null };
    return me(ctx, auth);
  });

  app.put('/api/v1/me/profile', async (req) => {
    const auth = await requireMember(ctx, req);
    await updateProfile(ctx, auth.user.id, parse(profileInput, req.body));
    return me(ctx, auth);
  });

  app.get('/api/v1/me/health', async (req) => {
    const auth = await requireMember(ctx, req);
    return healthProfileView(ctx, auth.user.id);
  });

  app.put('/api/v1/me/health', async (req) => {
    const auth = await requireMember(ctx, req);
    return saveHealthProfile(ctx, auth.user.id, parse(healthProfileInput, req.body));
  });

  app.post('/api/v1/me/weight', async (req) => {
    const auth = await requireMember(ctx, req);
    const { weightKg } = parse(weightLogInput, req.body);
    return { health: await logWeight(ctx, auth.user.id, weightKg) };
  });

  app.get<{ Querystring: { slot?: string } }>('/api/v1/me/recommendations', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const slot = z
      .enum(MEAL_SLOTS)
      .optional()
      .parse(req.query.slot || undefined);
    return recommendationsFor(ctx, auth, slot);
  });

  app.get('/api/v1/me/insights', async (req) => insights(ctx, await requireActiveMember(ctx, req)));

  // ─── Ordering ──────────────────────────────────────────────────────────────

  app.post('/api/v1/cart/quote', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    return quoteCart(ctx, auth, parse(cartInput, req.body));
  });

  app.post(
    '/api/v1/orders',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req) => {
      const auth = await requireActiveMember(ctx, req);
      return placeOrder(ctx, auth, parse(checkoutInput, req.body), {
        returnBase: requestOrigin(req),
      });
    },
  );

  app.get('/api/v1/orders', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    return memberOrders(ctx, auth.membership.id);
  });

  app.get('/api/v1/orders/:id', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    return memberOrder(ctx, auth.membership.id, parse(idParam, req.params).id);
  });

  app.get('/api/v1/orders/:id/stream', async (req, reply) => {
    const auth = await requireActiveMember(ctx, req);
    const { id } = parse(idParam, req.params);
    await memberOrder(ctx, auth.membership.id, id);
    openEventStream(req, reply, (send) => ctx.bus.subscribeOrder(id, send));
  });

  app.post('/api/v1/orders/:id/cancel', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const { id } = parse(idParam, req.params);
    await cancelOrderByMember(ctx, auth, id);
    return memberOrder(ctx, auth.membership.id, id);
  });

  app.post('/api/v1/orders/:id/rating', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const { rating, comment } = parse(orderRatingInput, req.body);
    await rateOrder(ctx, auth, parse(idParam, req.params).id, rating, comment);
    return { ok: true };
  });

  // ─── Wallet & VIP credit ───────────────────────────────────────────────────

  app.get('/api/v1/wallet', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const [entries, rules, owed] = await Promise.all([
      walletHistory(ctx.db, auth.membership.id),
      activeCashbackRules(ctx.db, auth.branch.id, ctx.now()),
      postpaidOutstanding(ctx.db, auth.membership.id),
    ]);
    return {
      balance: auth.membership.walletBalance,
      entries,
      cashback: rules.map((r) => ({
        title: r.title,
        minAmount: r.minAmount,
        percent: r.percent,
        maxBonus: r.maxBonus,
      })),
      postpaid: auth.membership.isVip ? { limit: auth.membership.creditLimit, owed } : null,
    };
  });

  app.get<{ Querystring: { amount?: string } }>('/api/v1/wallet/bonus', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const amount = z.coerce
      .number()
      .int()
      .min(0)
      .parse(req.query.amount ?? 0);
    const rules = await activeCashbackRules(ctx.db, auth.branch.id, ctx.now());
    return { amount, bonus: cashbackFor(rules, amount) };
  });

  app.post('/api/v1/wallet/topup', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const input = parse(walletTopupInput, req.body);
    if (input.method === 'card_to_card' && !input.cardToCard) {
      throw badRequest('card_details_required', 'کد پیگیری و ۴ رقم آخر کارت را وارد کنید');
    }
    const after = new AfterCommit();
    const payment = await ctx.db.transaction(async (tx) => {
      const p = await createPayment(tx, {
        branchId: auth.branch.id,
        membershipId: auth.membership.id,
        purpose: 'wallet_topup',
        method: input.method,
        amount: input.amount,
        cardToCard: input.cardToCard,
      });
      if (input.method === 'card_to_card')
        after.publish(auth.branch.id, { type: 'payment.review', paymentId: p.id });
      return p;
    });
    await after.flush(ctx);
    if (input.method === 'gateway') {
      const redirectUrl = await startGateway(ctx, payment, {
        returnBase: requestOrigin(req),
        mobile: auth.user.phone,
        description: 'شارژ کیف پول پروچیا',
      });
      return { paymentId: payment.id, redirectUrl };
    }
    return { paymentId: payment.id, redirectUrl: null, status: payment.status };
  });

  app.post('/api/v1/postpaid/settle', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const input = parse(postpaidSettleInput, req.body);
    const owed = await postpaidOutstanding(ctx.db, auth.membership.id);
    if (owed <= 0) throw badRequest('nothing_owed', 'بدهی تسویه‌نشده‌ای ندارید');
    if (input.method === 'card_to_card' && !input.cardToCard) {
      throw badRequest('card_details_required', 'کد پیگیری و ۴ رقم آخر کارت را وارد کنید');
    }

    const after = new AfterCommit();
    const payment = await ctx.db.transaction(async (tx) => {
      const p = await createPayment(tx, {
        branchId: auth.branch.id,
        membershipId: auth.membership.id,
        purpose: 'postpaid_settlement',
        method: input.method,
        amount: owed,
        cardToCard: input.cardToCard,
      });
      if (input.method === 'wallet') {
        await walletDebit(tx, auth.membership.id, owed, 'postpaid_settlement', { paymentId: p.id });
        await settlePayment(ctx, tx, p, after);
      }
      if (input.method === 'card_to_card')
        after.publish(auth.branch.id, { type: 'payment.review', paymentId: p.id });
      return p;
    });
    await after.flush(ctx);
    if (input.method === 'gateway') {
      const redirectUrl = await startGateway(ctx, payment, {
        returnBase: requestOrigin(req),
        mobile: auth.user.phone,
        description: 'تسویه حساب اعتباری پروچیا',
      });
      return { paymentId: payment.id, redirectUrl };
    }
    return { paymentId: payment.id, redirectUrl: null };
  });

  // ─── Plans & packages ──────────────────────────────────────────────────────

  app.post('/api/v1/plans/:id/purchase', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    return purchasePlan(
      ctx,
      auth,
      parse(idParam, req.params).id,
      parse(planPurchaseInput, req.body),
      requestOrigin(req),
    );
  });

  app.get('/api/v1/subscriptions', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    return memberSubscriptions(ctx.db, auth.membership.id);
  });

  app.put('/api/v1/subscriptions/:id/schedule', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const row = await setSchedule(
      ctx,
      auth.membership.id,
      parse(idParam, req.params).id,
      parse(subscriptionScheduleInput, req.body),
    );
    return { id: row.id, schedule: row.schedule };
  });

  // ─── Club ──────────────────────────────────────────────────────────────────

  app.get('/api/v1/club', async (req) => {
    const auth = await requireActiveMember(ctx, req);
    const now = ctx.now();
    const [status, goal] = await Promise.all([
      clubStatus(ctx.db, auth.branch, auth.membership, now),
      memberGoal(ctx.db, auth.user.id),
    ]);
    const offers = await memberOffers(ctx.db, {
      branchId: auth.branch.id,
      membership: auth.membership,
      goal,
      now,
    });
    return { ...status, offers };
  });

  // ─── Analytics ─────────────────────────────────────────────────────────────

  app.post(
    '/api/v1/events',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const branch = await requireBranch(ctx, req);
      const auth = await getMember(ctx, req);
      const input = parse(analyticsEventsInput, req.body);
      const accepted = await recordEvents(
        ctx,
        branch.id,
        auth?.user.id ?? null,
        input.anonId,
        input.events,
      );
      return { accepted };
    },
  );
}
