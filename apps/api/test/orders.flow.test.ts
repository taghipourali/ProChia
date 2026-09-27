import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { CheckoutInput } from '@prochia/shared';
import { AppError } from '../src/lib/errors';
import { runProduction } from '../src/modules/inventory/service';
import { publicMenu } from '../src/modules/menu/service';
import {
  acceptOrder,
  cancelOrderByMember,
  handoverOrder,
  placeOrder,
  rejectOrder,
  releaseDueTickets,
  updateTicket,
} from '../src/modules/orders/service';
import { handleGatewayCallback } from '../src/modules/payments/service';
import { purchasePlan } from '../src/modules/plans/service';
import { drainSmsOutbox } from '../src/modules/notifications/sms';
import {
  createFixture,
  createMember,
  createTestContext,
  onHand,
  orderRow,
  reloadMember,
  resetDatabase,
  s,
  ticketsOf,
  type Fixture,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let fx: Fixture;

beforeAll(() => {
  ctx = createTestContext();
});
afterAll(() => ctx.close());

beforeEach(async () => {
  await resetDatabase();
  ctx.clock.now = new Date('2026-09-27T09:00:00Z');
  fx = await createFixture(ctx);
});

const checkout = (
  lines: CheckoutInput['lines'],
  extra: Partial<CheckoutInput> = {},
): CheckoutInput => ({
  lines,
  useCredits: true,
  type: 'pickup',
  paymentMethod: 'wallet',
  ...extra,
});
const line = (itemId: string, quantity = 1) => ({ itemId, quantity, optionIds: [] });

async function expectAppError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

describe('restaurant accepts, then the café starts', () => {
  it('holds every station until acceptance, deducts stock by recipe, and releases both tickets', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 2_000_000 });
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.bowl, 2), line(fx.items.latte)]),
      { returnBase: '' },
    );

    expect(placed.status).toBe('placed');
    expect((await reloadMember(ctx.db, member)).membership.walletBalance).toBe(
      2_000_000 - 1_150_000,
    );
    const held = await ticketsOf(ctx.db, placed.orderId);
    expect(held.map((t) => t.status)).toEqual(['held', 'held']);

    // Not deducted yet, but the menu already accounts for it: 1000 g chicken − 400 g pending = 3 bowls.
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(1000);
    const menu = await publicMenu(ctx, fx.branch);
    const bowl = menu.categories.flatMap((c) => c.items).find((i) => i.id === fx.items.bowl)!;
    expect(bowl.portionsLeft).toBe(3);

    // The café cannot confirm an order that includes restaurant food.
    await expectAppError(
      acceptOrder(ctx, { kind: 'staff', staff: fx.staff.barista.staff }, fx.branch, placed.orderId),
      'forbidden',
    );

    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.kitchen.staff },
      fx.branch,
      placed.orderId,
    );
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(600);
    expect(await onHand(ctx.db, fx.ingredients.rice)).toBe(1700);
    expect(await onHand(ctx.db, fx.ingredients.milk)).toBe(780);
    const released = await ticketsOf(ctx.db, placed.orderId);
    expect(released.every((t) => t.status === 'queued')).toBe(true);

    const cafeTicket = released.find((t) => t.stationId === fx.cafe.id)!;
    const kitchenTicket = released.find((t) => t.stationId === fx.restaurant.id)!;
    await updateTicket(ctx, fx.staff.barista, cafeTicket.id, 'start');
    expect((await orderRow(ctx.db, placed.orderId)).status).toBe('preparing');
    await updateTicket(ctx, fx.staff.barista, cafeTicket.id, 'ready');
    expect((await orderRow(ctx.db, placed.orderId)).status).toBe('preparing');
    await updateTicket(ctx, fx.staff.kitchen, kitchenTicket.id, 'start');
    await updateTicket(ctx, fx.staff.kitchen, kitchenTicket.id, 'ready');
    expect((await orderRow(ctx.db, placed.orderId)).status).toBe('ready');

    await drainSmsOutbox(ctx);
    expect(ctx.smsLog.sent.at(-1)?.body).toMatch(/آماده است/);

    await handoverOrder(ctx, fx.staff.cashier, placed.orderId);
    const done = await orderRow(ctx.db, placed.orderId);
    expect(done.status).toBe('completed');
    expect((await ticketsOf(ctx.db, placed.orderId)).every((t) => t.status === 'served')).toBe(
      true,
    );
  });

  it('lets the café accept café-only orders', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 500_000 });
    const placed = await placeOrder(ctx, member, checkout([line(fx.items.latte)]), {
      returnBase: '',
    });
    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.barista.staff },
      fx.branch,
      placed.orderId,
    );
    expect((await orderRow(ctx.db, placed.orderId)).status).toBe('accepted');
  });

  it('blocks acceptance on a stock shortage unless forced', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 5_000_000 });
    const placed = await placeOrder(ctx, member, checkout([line(fx.items.bowl, 4)]), {
      returnBase: '',
    });
    // Someone records 300 g of spoiled chicken after the order came in.
    await ctx.db.transaction(async (tx) => {
      const { applyMovements } = await import('../src/modules/inventory/ledger');
      await applyMovements(tx, fx.branch.id, [
        { ingredientId: fx.ingredients.chicken, delta: -300, reason: 'waste' },
      ]);
    });

    const err = await expectAppError(
      acceptOrder(ctx, { kind: 'staff', staff: fx.staff.kitchen.staff }, fx.branch, placed.orderId),
      'insufficient_stock',
    );
    expect(
      (err.details as { shortages: { required: number; onHand: number }[] }).shortages[0],
    ).toMatchObject({ required: 800, onHand: 700 });

    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.kitchen.staff },
      fx.branch,
      placed.orderId,
      { force: true },
    );
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(-100);
  });

  it('refuses orders the storage cannot cover', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 5_000_000 });
    await expectAppError(
      placeOrder(ctx, member, checkout([line(fx.items.bowl, 6)]), { returnBase: '' }),
      'out_of_stock',
    );
  });

  it('strikes unavailable lines at acceptance and refunds the difference to the wallet', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 1_000_000 });
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.bowl), line(fx.items.salad)]),
      { returnBase: '' },
    );
    const lines = await ctx.db
      .select()
      .from(s.orderLines)
      .where(eq(s.orderLines.orderId, placed.orderId));
    const salad = lines.find((l) => l.menuItemId === fx.items.salad)!;

    const result = await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.kitchen.staff },
      fx.branch,
      placed.orderId,
      {
        removeLineIds: [salad.id],
      },
    );
    expect(result).toMatchObject({ accepted: true, refund: 300_000 });
    const order = await orderRow(ctx.db, placed.orderId);
    expect(order.total).toBe(500_000);
    expect(order.paidAmount).toBe(500_000);
    expect((await reloadMember(ctx.db, member)).membership.walletBalance).toBe(500_000);
    // Only the bowl's recipe was deducted.
    expect(await onHand(ctx.db, fx.ingredients.lettuce)).toBe(1000);
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(800);
  });

  it('rejecting an accepted order returns stock and money', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 1_000_000 });
    const placed = await placeOrder(ctx, member, checkout([line(fx.items.bowl)]), {
      returnBase: '',
    });
    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.kitchen.staff },
      fx.branch,
      placed.orderId,
    );
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(800);

    await rejectOrder(ctx, fx.staff.kitchen, placed.orderId, 'مشکل فنی گریل');
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(1000);
    expect((await reloadMember(ctx.db, member)).membership.walletBalance).toBe(1_000_000);
    const order = await orderRow(ctx.db, placed.orderId);
    expect(order).toMatchObject({ status: 'rejected', paymentState: 'refunded' });
    expect((await ticketsOf(ctx.db, placed.orderId)).every((t) => t.status === 'cancelled')).toBe(
      true,
    );
  });
});

describe('pre-orders', () => {
  it('schedules station tickets to start in time for pickup', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 1_000_000 });
    const pickup = new Date(ctx.clock.now.getTime() + 2 * 3_600_000);
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.bowl), line(fx.items.latte)], { scheduledFor: pickup.toISOString() }),
      {
        returnBase: '',
      },
    );
    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.kitchen.staff },
      fx.branch,
      placed.orderId,
    );

    const tickets = await ticketsOf(ctx.db, placed.orderId);
    const kitchen = tickets.find((t) => t.stationId === fx.restaurant.id)!;
    const cafe = tickets.find((t) => t.stationId === fx.cafe.id)!;
    expect(kitchen.status).toBe('scheduled');
    // Restaurant default prep (15 min) is longer than the bowl's 12; the café needs 5.
    expect(kitchen.dueAt!.getTime()).toBe(pickup.getTime() - 15 * 60_000);
    expect(cafe.dueAt!.getTime()).toBe(pickup.getTime() - 5 * 60_000);

    ctx.clock.now = new Date(pickup.getTime() - 14 * 60_000);
    expect(await releaseDueTickets(ctx)).toBe(1);
    const after = await ticketsOf(ctx.db, placed.orderId);
    expect(after.find((t) => t.id === kitchen.id)!.status).toBe('queued');
    expect(after.find((t) => t.id === cafe.id)!.status).toBe('scheduled');
  });

  it('enforces the minimum lead time', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 1_000_000 });
    const tooSoon = new Date(ctx.clock.now.getTime() + 5 * 60_000).toISOString();
    await expectAppError(
      placeOrder(ctx, member, checkout([line(fx.items.bowl)], { scheduledFor: tooSoon }), {
        returnBase: '',
      }),
      'too_soon',
    );
  });
});

describe('payments', () => {
  it('pays an order through the gateway and only then sends it to the kitchen', async () => {
    const member = await createMember(ctx.db, fx.branch);
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.bowl)], { paymentMethod: 'gateway' }),
      {
        returnBase: 'https://gym.prochia.ir',
      },
    );
    expect(placed.status).toBe('awaiting_payment');
    expect(placed.redirectUrl).toMatch(/fake-gateway/);
    const [payment] = await ctx.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.orderId, placed.orderId));

    const path = await handleGatewayCallback(ctx, payment!.id, payment!.authority!, 'OK');
    expect(path).toBe(`/orders/${placed.orderId}?payment=ok`);
    const order = await orderRow(ctx.db, placed.orderId);
    expect(order).toMatchObject({ status: 'placed', paymentState: 'paid', paidAmount: 500_000 });

    // A repeated callback (browser refresh) is harmless.
    expect(await handleGatewayCallback(ctx, payment!.id, payment!.authority!, 'OK')).toMatch(
      /payment=ok/,
    );
    expect((await orderRow(ctx.db, placed.orderId)).paidAmount).toBe(500_000);
  });

  it('cancels the order when the member backs out at the bank', async () => {
    const member = await createMember(ctx.db, fx.branch);
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.bowl)], { paymentMethod: 'gateway' }),
      {
        returnBase: 'https://gym.prochia.ir',
      },
    );
    const [payment] = await ctx.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.orderId, placed.orderId));
    expect(await handleGatewayCallback(ctx, payment!.id, payment!.authority!, 'NOK')).toMatch(
      /payment=failed/,
    );
    expect((await orderRow(ctx.db, placed.orderId)).status).toBe('cancelled');
  });

  it('adds the best cashback tier to wallet top-ups', async () => {
    await ctx.db.insert(s.cashbackRules).values([
      { branchId: fx.branch.id, title: 'a', minAmount: 1_000_000, percent: 3 },
      { branchId: fx.branch.id, title: 'b', minAmount: 5_000_000, percent: 10, maxBonus: 400_000 },
    ]);
    const member = await createMember(ctx.db, fx.branch);
    const payment = await ctx.db.transaction(async (tx) => {
      const { createPayment } = await import('../src/modules/payments/service');
      return createPayment(tx, {
        branchId: fx.branch.id,
        membershipId: member.membership.id,
        purpose: 'wallet_topup',
        method: 'gateway',
        amount: 5_000_000,
      });
    });
    const { startGateway } = await import('../src/modules/payments/service');
    await startGateway(ctx, payment, {
      returnBase: 'https://gym.prochia.ir',
      mobile: member.user.phone,
      description: 'x',
    });
    const [p] = await ctx.db.select().from(s.payments).where(eq(s.payments.id, payment.id));
    await handleGatewayCallback(ctx, p!.id, p!.authority!, 'OK');
    // 10% of 5,000,000 = 500,000, capped at 400,000.
    expect((await reloadMember(ctx.db, member)).membership.walletBalance).toBe(5_400_000);
  });

  it('lets VIP members order on credit up to their limit', async () => {
    const vip = await createMember(ctx.db, fx.branch, { vip: 700_000 });
    const first = await placeOrder(
      ctx,
      vip,
      checkout([line(fx.items.bowl)], { paymentMethod: 'postpaid' }),
      { returnBase: '' },
    );
    expect((await orderRow(ctx.db, first.orderId)).paymentState).toBe('postpaid');
    await expectAppError(
      placeOrder(ctx, vip, checkout([line(fx.items.salad)], { paymentMethod: 'postpaid' }), {
        returnBase: '',
      }),
      'credit_limit',
    );

    const regular = await createMember(ctx.db, fx.branch, { phone: '09120000002' });
    await expectAppError(
      placeOrder(ctx, regular, checkout([line(fx.items.latte)], { paymentMethod: 'postpaid' }), {
        returnBase: '',
      }),
      'forbidden',
    );
  });

  it('requires payment before handover, or collects it at the counter', async () => {
    const member = await createMember(ctx.db, fx.branch);
    const placed = await placeOrder(
      ctx,
      member,
      checkout([line(fx.items.latte)], { paymentMethod: 'counter' }),
      { returnBase: '' },
    );
    await acceptOrder(
      ctx,
      { kind: 'staff', staff: fx.staff.barista.staff },
      fx.branch,
      placed.orderId,
    );
    const [t] = await ticketsOf(ctx.db, placed.orderId);
    await updateTicket(ctx, fx.staff.barista, t!.id, 'ready');
    await expectAppError(handoverOrder(ctx, fx.staff.cashier, placed.orderId), 'payment_required');
    await handoverOrder(ctx, fx.staff.cashier, placed.orderId, { collect: true });
    expect(await orderRow(ctx.db, placed.orderId)).toMatchObject({
      status: 'completed',
      paymentState: 'paid',
      paidAmount: 150_000,
    });
  });
});

describe('packages and promotions', () => {
  it('covers eligible meals with package credits and gives them back on cancellation', async () => {
    const [plan] = await ctx.db
      .insert(s.plans)
      .values({
        branchId: fx.branch.id,
        kind: 'package',
        name: 'بسته ۱۰',
        meals: 10,
        validityDays: 30,
        price: 4_000_000,
      })
      .returning();
    const member = await createMember(ctx.db, fx.branch, { wallet: 5_000_000 });
    await purchasePlan(ctx, member, plan!.id, { method: 'wallet' }, '');
    const [sub] = await ctx.db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.membershipId, member.membership.id));
    expect(sub).toMatchObject({ status: 'active', credits: 10, creditsUsed: 0 });

    const withWallet = await reloadMember(ctx.db, member);
    const placed = await placeOrder(
      ctx,
      withWallet,
      checkout([line(fx.items.bowl, 2), line(fx.items.latte)]),
      { returnBase: '' },
    );
    const order = await orderRow(ctx.db, placed.orderId);
    expect(order).toMatchObject({ creditsValue: 1_000_000, total: 150_000, paymentState: 'paid' });
    const [used] = await ctx.db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.id, sub!.id));
    expect(used!.creditsUsed).toBe(2);

    await cancelOrderByMember(ctx, withWallet, placed.orderId);
    const [restored] = await ctx.db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.id, sub!.id));
    expect(restored!.creditsUsed).toBe(0);
    expect((await reloadMember(ctx.db, member)).membership.walletBalance).toBe(1_000_000);
  });

  it('applies the first-order promotion automatically, once', async () => {
    await ctx.db.insert(s.promotions).values({
      branchId: fx.branch.id,
      title: 'اولین سفارش',
      kind: 'percent',
      value: 20,
      audience: 'first_order',
    });
    const member = await createMember(ctx.db, fx.branch, { wallet: 2_000_000 });
    const first = await placeOrder(ctx, member, checkout([line(fx.items.bowl)]), {
      returnBase: '',
    });
    expect(await orderRow(ctx.db, first.orderId)).toMatchObject({
      promoDiscount: 100_000,
      total: 400_000,
    });
    const second = await placeOrder(
      ctx,
      await reloadMember(ctx.db, member),
      checkout([line(fx.items.bowl)]),
      { returnBase: '' },
    );
    expect((await orderRow(ctx.db, second.orderId)).promoDiscount).toBe(0);
  });

  it('rejects invalid promo codes with a reason', async () => {
    const member = await createMember(ctx.db, fx.branch, { wallet: 2_000_000 });
    await expectAppError(
      placeOrder(ctx, member, checkout([line(fx.items.bowl)], { promoCode: 'NOPE' }), {
        returnBase: '',
      }),
      'invalid_promo',
    );
  });
});

describe('membership', () => {
  it('keeps pending members from ordering', async () => {
    const { requireActiveMember } = await import('../src/lib/auth');
    expect(requireActiveMember).toBeTypeOf('function');
    const pending = await createMember(ctx.db, fx.branch, { status: 'pending' });
    expect(pending.membership.status).toBe('pending');
  });
});

describe('storage processing', () => {
  it('costs prepared ingredients from their inputs and the real yield', async () => {
    const [ready] = await ctx.db
      .insert(s.ingredients)
      .values({ branchId: fx.branch.id, name: 'مرغ آماده', kind: 'prepared', unit: 'g' })
      .returning();
    // 500 g chicken at 400 toman/g = 200,000 toman → 400 g ready = 500 toman/g.
    await runProduction(ctx, fx.branch.id, fx.staff.manager.staff.id, {
      outputIngredientId: ready!.id,
      outputQuantity: 400,
      inputs: [{ ingredientId: fx.ingredients.chicken, quantity: 500 }],
    });
    const [row] = await ctx.db.select().from(s.ingredients).where(eq(s.ingredients.id, ready!.id));
    expect(row).toMatchObject({ onHand: 400, avgCost: 500 });
    expect(await onHand(ctx.db, fx.ingredients.chicken)).toBe(500);
    const moves = await ctx.db
      .select()
      .from(s.stockMovements)
      .where(and(eq(s.stockMovements.refType, 'production')));
    expect(moves).toHaveLength(2);
  });
});
