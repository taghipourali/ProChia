import { and, desc, eq, gte, inArray, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { CartInput, CheckoutInput, OrderStatus } from '@prochia/shared';
import { formatToman, tehranIsoDate, toFaDigits } from '@prochia/shared';
import type { AppContext } from '../../context';
import { gather, type Executor, type Tx } from '../../db/client';
import {
  branches,
  creditRedemptions,
  memberships,
  orderCounters,
  orderEvents,
  orderLines,
  orders,
  payments,
  promotionRedemptions,
  promotions,
  spots,
  stationTickets,
  stations,
  stockMovements,
  tiers,
  users,
} from '../../db/schema';
import { AfterCommit } from '../../lib/after-commit';
import type { Branch, MemberAuth, Membership, StaffAuth, StaffMember } from '../../lib/auth';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { isOpenAt } from '../branch/hours';
import {
  effectiveMemberDiscountPct,
  memberGoal,
  memberTier,
  recordRedemption,
  refreshTier,
  resolvePromotion,
  reverseRedemption,
} from '../club/service';
import { applyMovements, availableStock } from '../inventory/ledger';
import { lineRequirements, loadCatalog, type Catalog, type Requirements } from '../menu/catalog';
import { queueSms, smsText } from '../notifications/sms';
import { createPayment, startGateway } from '../payments/service';
import { consumeCredits, creditSources, reverseCredits } from '../plans/service';
import { walletCredit, walletDebit } from '../wallet/service';
import { priceCart, type PricedLine, type PricingResult } from './pricing';

type Order = typeof orders.$inferSelect;
type ActiveMember = MemberAuth & { membership: Membership };
export type Actor =
  { kind: 'member'; id: string } | { kind: 'staff'; id: string } | { kind: 'system' };

const actorFields = (actor: Actor) => ({
  actorKind: actor.kind,
  actorId: actor.kind === 'system' ? null : actor.id,
});

// ─── Pricing & quotes ────────────────────────────────────────────────────────

async function priceForMember(
  ctx: AppContext,
  db: Executor,
  auth: ActiveMember,
  cart: CartInput,
  catalog: Catalog,
): Promise<{ pricing: PricingResult; promoError: string | null }> {
  const now = ctx.now();
  const [tier, goal, credits] = await gather(db, [
    () => memberTier(db, auth.membership),
    () => memberGoal(db, auth.user.id),
    () => creditSources(db, auth.membership.id, tehranIsoDate(now)),
  ] as const);
  const base = {
    memberDiscountPct: effectiveMemberDiscountPct(auth.membership, tier),
    credits,
    useCredits: cart.useCredits,
  };
  const resolved = await resolvePromotion(
    db,
    { branchId: auth.branch.id, membership: auth.membership, goal, now },
    cart.promoCode || undefined,
  );

  if (cart.promoCode) {
    const pricing = priceCart(catalog, cart.lines, { ...base, promotion: resolved.promotion });
    return { pricing, promoError: resolved.error ?? pricing.promoError };
  }
  // No code typed: apply whichever automatic promotion saves the member the most.
  let best = priceCart(catalog, cart.lines, { ...base, promotion: null });
  for (const candidate of resolved.candidates) {
    const priced = priceCart(catalog, cart.lines, { ...base, promotion: candidate });
    if (priced.promoDiscount > best.promoDiscount) best = priced;
  }
  return { pricing: best, promoError: null };
}

function linesRequirements(
  catalog: Catalog,
  lines: Pick<PricedLine, 'menuItemId' | 'optionIds' | 'quantity'>[],
) {
  const req: Requirements = new Map();
  for (const l of lines) lineRequirements(catalog, l, req);
  return req;
}

/** Names of cart items that cannot be made from free stock. */
function stockIssues(
  catalog: Catalog,
  lines: PricedLine[],
  available: Map<string, number>,
): string[] {
  const total = linesRequirements(catalog, lines);
  const short = new Set(
    [...total].filter(([id, qty]) => qty > (available.get(id) ?? 0) + 1e-6).map(([id]) => id),
  );
  if (!short.size) return [];
  return lines
    .filter((l) => [...linesRequirements(catalog, [l]).keys()].some((id) => short.has(id)))
    .map((l) => l.name);
}

export async function postpaidOutstanding(db: Executor, membershipId: string) {
  const [row] = await db
    .select({ owed: sql<number>`coalesce(sum(${orders.total} - ${orders.paidAmount}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.membershipId, membershipId),
        eq(orders.paymentState, 'postpaid'),
        notInArray(orders.status, ['rejected', 'cancelled']),
      ),
    );
  return row?.owed ?? 0;
}

export async function quoteCart(ctx: AppContext, auth: ActiveMember, cart: CartInput) {
  const catalog = await loadCatalog(ctx.db, auth.branch.id);
  const [{ pricing, promoError }, stock, owed] = await Promise.all([
    priceForMember(ctx, ctx.db, auth, cart, catalog),
    availableStock(ctx.db, auth.branch.id, catalog),
    postpaidOutstanding(ctx.db, auth.membership.id),
  ]);
  const unavailable = auth.branch.settings.enforceStock
    ? stockIssues(catalog, pricing.lines, stock.available)
    : [];
  return {
    ...pricing,
    promoError,
    unavailable,
    wallet: { balance: auth.membership.walletBalance },
    postpaid: auth.membership.isVip
      ? {
          allowed: true,
          limit: auth.membership.creditLimit,
          owed,
          available: Math.max(auth.membership.creditLimit - owed, 0),
        }
      : { allowed: false, limit: 0, owed: 0, available: 0 },
  };
}

// ─── Placing orders ──────────────────────────────────────────────────────────

async function nextOrderNumber(tx: Tx, branchId: string, businessDate: string) {
  const [row] = await tx
    .insert(orderCounters)
    .values({ branchId, businessDate, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [orderCounters.branchId, orderCounters.businessDate],
      set: { lastNumber: sql`${orderCounters.lastNumber} + 1` },
    })
    .returning({ number: orderCounters.lastNumber });
  return row!.number;
}

function validateTiming(branch: Branch, now: Date, scheduledFor: Date | null) {
  const s = branch.settings;
  if (!scheduledFor) {
    if (!isOpenAt(branch.openingHours, now)) {
      throw conflict(
        'closed',
        'الان خارج از ساعت کاری هستیم؛ می‌توانید برای بعد پیش‌سفارش ثبت کنید',
      );
    }
    return;
  }
  const minutesAhead = (scheduledFor.getTime() - now.getTime()) / 60_000;
  if (minutesAhead < s.preorderMinLeadMinutes) {
    throw badRequest(
      'too_soon',
      `پیش‌سفارش باید حداقل ${toFaDigits(s.preorderMinLeadMinutes)} دقیقه بعد باشد`,
    );
  }
  if (minutesAhead > s.preorderMaxDays * 1440) {
    throw badRequest(
      'too_far',
      `پیش‌سفارش حداکثر تا ${toFaDigits(s.preorderMaxDays)} روز آینده ممکن است`,
    );
  }
  if (!isOpenAt(branch.openingHours, scheduledFor)) {
    throw badRequest('closed_at_time', 'در ساعت انتخاب‌شده باز نیستیم');
  }
}

export interface PlaceOrderOptions {
  returnBase: string;
  source?: 'app' | 'qr' | 'subscription';
  subscriptionId?: string;
}

export async function placeOrder(
  ctx: AppContext,
  auth: ActiveMember,
  input: CheckoutInput,
  opts: PlaceOrderOptions,
) {
  const now = ctx.now();
  const branch = auth.branch;
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  validateTiming(branch, now, scheduledFor);

  if (input.paymentMethod === 'card_to_card' && !input.cardToCard) {
    throw badRequest('card_details_required', 'کد پیگیری و ۴ رقم آخر کارت را وارد کنید');
  }
  if (input.paymentMethod === 'postpaid' && !auth.membership.isVip) {
    throw forbidden('پرداخت اعتباری فقط برای اعضای VIP فعال است');
  }

  const after = new AfterCommit();
  const result = await ctx.db.transaction(async (tx) => {
    let spot: typeof spots.$inferSelect | undefined;
    if (input.tableCode) {
      [spot] = await tx
        .select()
        .from(spots)
        .where(
          and(
            eq(spots.code, input.tableCode.toUpperCase()),
            eq(spots.branchId, branch.id),
            eq(spots.isActive, true),
          ),
        );
      if (!spot) throw badRequest('invalid_table', 'کد میز معتبر نیست؛ QR را دوباره اسکن کنید');
    }
    if (input.type === 'dine_in' && !spot)
      throw badRequest('table_required', 'برای سفارش سر میز، QR میز را اسکن کنید');

    const catalog = await loadCatalog(tx, branch.id);
    const { pricing, promoError } = await priceForMember(ctx, tx, auth, input, catalog);
    if (input.promoCode && promoError) throw badRequest('invalid_promo', promoError);

    if (branch.settings.enforceStock) {
      const { available } = await availableStock(tx, branch.id, catalog);
      const unavailable = stockIssues(catalog, pricing.lines, available);
      if (unavailable.length) {
        throw conflict(
          'out_of_stock',
          `این آیتم‌ها الان قابل تهیه نیستند: ${unavailable.join('، ')}`,
          { items: unavailable },
        );
      }
    }

    const total = pricing.total;
    const method = input.paymentMethod;
    if (method === 'postpaid' && total > 0) {
      const owed = await postpaidOutstanding(tx, auth.membership.id);
      if (owed + total > auth.membership.creditLimit) {
        throw conflict(
          'credit_limit',
          `سقف اعتبار شما ${formatToman(auth.membership.creditLimit)} است و ${formatToman(owed)} تسویه‌نشده دارید`,
        );
      }
    }

    const awaitingGateway = method === 'gateway' && total > 0;
    const businessDate = tehranIsoDate(now);
    const [order] = await tx
      .insert(orders)
      .values({
        branchId: branch.id,
        number: await nextOrderNumber(tx, branch.id, businessDate),
        businessDate,
        membershipId: auth.membership.id,
        userId: auth.user.id,
        type: input.type,
        spotId: spot?.id ?? null,
        scheduledFor,
        status: awaitingGateway ? 'awaiting_payment' : 'placed',
        paymentState: total === 0 ? 'paid' : method === 'postpaid' ? 'postpaid' : 'unpaid',
        paymentMethod: method,
        subtotal: pricing.subtotal,
        creditsValue: pricing.creditsValue,
        memberDiscountPct: pricing.memberDiscountPct,
        memberDiscount: pricing.memberDiscount,
        promoDiscount: pricing.promoDiscount,
        promotionId: pricing.promotion?.id ?? null,
        total,
        nutrition: pricing.nutrition,
        note: input.note ?? null,
        source: opts.source ?? (spot ? 'qr' : 'app'),
        subscriptionId: opts.subscriptionId ?? null,
      })
      .returning();

    const lineRows = await tx
      .insert(orderLines)
      .values(
        pricing.lines.map((l) => ({
          orderId: order!.id,
          menuItemId: l.menuItemId,
          stationId: l.stationId,
          name: l.name,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          options: l.options,
          lineTotal: l.lineTotal,
          creditsUsed: l.creditsUsed,
          nutrition: l.nutrition,
          note: l.note,
        })),
      )
      .returning({ id: orderLines.id });

    for (const a of pricing.allocations) {
      await consumeCredits(tx, a.subscriptionId, a.credits);
      await tx.insert(creditRedemptions).values({
        orderId: order!.id,
        orderLineId: lineRows[a.lineIndex]!.id,
        subscriptionId: a.subscriptionId,
        credits: a.credits,
        value: a.value,
      });
    }
    if (pricing.promotion && pricing.promoDiscount > 0) {
      await recordRedemption(tx, {
        promotion: pricing.promotion,
        membershipId: auth.membership.id,
        orderId: order!.id,
        amount: pricing.promoDiscount,
        now,
      });
    }

    const stationIds = [...new Set(pricing.lines.map((l) => l.stationId))];
    await tx.insert(stationTickets).values(
      stationIds.map((stationId) => ({
        orderId: order!.id,
        branchId: branch.id,
        stationId,
        status: 'held' as const,
      })),
    );

    let payment: typeof payments.$inferSelect | null = null;
    if (total > 0 && method !== 'postpaid' && method !== 'counter') {
      payment = await createPayment(tx, {
        branchId: branch.id,
        membershipId: auth.membership.id,
        purpose: 'order',
        method,
        amount: total,
        orderId: order!.id,
        cardToCard: input.cardToCard,
      });
      if (method === 'wallet') {
        await walletDebit(tx, auth.membership.id, total, 'order', {
          orderId: order!.id,
          paymentId: payment.id,
          note: `سفارش ${toFaDigits(order!.number)}`,
        });
        await tx
          .update(orders)
          .set({ paymentState: 'paid', paidAmount: total })
          .where(eq(orders.id, order!.id));
      }
      if (method === 'card_to_card')
        after.publish(branch.id, { type: 'payment.review', paymentId: payment.id });
    }

    await tx.insert(orderEvents).values({
      orderId: order!.id,
      type: 'placed',
      actorKind: opts.source === 'subscription' ? 'system' : 'member',
      actorId: opts.source === 'subscription' ? null : auth.user.id,
      data: { total, method, scheduledFor: scheduledFor?.toISOString() ?? null },
    });

    if (!awaitingGateway) {
      after.publish(branch.id, {
        type: 'order.updated',
        orderId: order!.id,
        status: 'placed',
        number: order!.number,
      });
      after.run(() => maybeAutoAccept(ctx, order!.id));
    }
    return { order: order!, payment, awaitingGateway };
  });

  await after.flush(ctx);

  let redirectUrl: string | null = null;
  if (result.awaitingGateway && result.payment) {
    redirectUrl = await startGateway(ctx, result.payment, {
      returnBase: opts.returnBase,
      mobile: auth.user.phone,
      description: `سفارش ${result.order.number} — پروچیا ${branch.gymName}`,
    });
  }
  return {
    orderId: result.order.id,
    number: result.order.number,
    status: result.order.status,
    redirectUrl,
  };
}

// ─── Closing (cancel / reject) ───────────────────────────────────────────────

/**
 * Ends an order that will not be made: returns stock if it was already deducted, refunds what
 * was paid to the wallet, gives back meal credits and discount codes. Caller holds the row lock.
 */
export async function closeOrder(
  ctx: AppContext,
  tx: Tx,
  order: Order,
  opts: { status: 'cancelled' | 'rejected'; reason: string; actor: Actor; after: AfterCommit },
) {
  const now = ctx.now();

  if (order.status === 'accepted' || order.status === 'preparing') {
    const consumed = await tx
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.refType, 'order'),
          eq(stockMovements.refId, order.id),
          eq(stockMovements.reason, 'sale'),
        ),
      );
    const ids = await applyMovements(
      tx,
      order.branchId,
      consumed.map((m) => ({
        ingredientId: m.ingredientId,
        delta: -m.delta,
        reason: 'sale_reversal' as const,
        unitCost: m.unitCost ?? undefined,
        refType: 'order',
        refId: order.id,
      })),
      { allowNegative: true },
    );
    if (ids.length)
      opts.after.publish(order.branchId, { type: 'stock.changed', ingredientIds: ids });
  }

  const refunded = order.paidAmount;
  if (refunded > 0) {
    await walletCredit(tx, order.membershipId, refunded, 'refund', {
      orderId: order.id,
      note: `بازگشت وجه سفارش ${toFaDigits(order.number)}`,
    });
  }
  await tx
    .update(payments)
    .set({ status: 'cancelled' })
    .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')));

  await reverseCredits(tx, order.id, now);
  await reverseRedemption(tx, order.id, now);
  await tx
    .update(stationTickets)
    .set({ status: 'cancelled' })
    .where(eq(stationTickets.orderId, order.id));
  await tx
    .update(orders)
    .set({
      status: opts.status,
      rejectReason: opts.reason,
      cancelledAt: now,
      paidAmount: 0,
      paymentState: refunded > 0 ? 'refunded' : 'unpaid',
      updatedAt: now,
    })
    .where(eq(orders.id, order.id));
  await tx.insert(orderEvents).values({
    orderId: order.id,
    type: opts.status,
    ...actorFields(opts.actor),
    data: { reason: opts.reason, refunded },
  });

  opts.after.publish(order.branchId, {
    type: 'order.updated',
    orderId: order.id,
    status: opts.status,
    number: order.number,
  });
  if (opts.status === 'rejected') {
    const [u] = await tx
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, order.userId));
    if (u) {
      await queueSms(tx, {
        branchId: order.branchId,
        phone: u.phone,
        template: 'order_rejected',
        body: smsText.orderRejected(order.number, opts.reason, refunded > 0),
      });
    }
  }
}

async function lockOrder(tx: Tx, branchId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.branchId, branchId)))
    .for('update');
  if (!order) throw notFound('سفارش پیدا نشد');
  return order;
}

export async function cancelOrderByMember(ctx: AppContext, auth: ActiveMember, orderId: string) {
  const after = new AfterCommit();
  await ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth.branch.id, orderId);
    if (order.membershipId !== auth.membership.id) throw notFound('سفارش پیدا نشد');
    if (order.status !== 'placed' && order.status !== 'awaiting_payment') {
      throw conflict(
        'too_late',
        'سفارش تأیید شده و در حال آماده‌سازی است؛ برای لغو با صندوق هماهنگ کنید',
      );
    }
    await closeOrder(ctx, tx, order, {
      status: 'cancelled',
      reason: 'لغو توسط مشتری',
      actor: { kind: 'member', id: auth.user.id },
      after,
    });
  });
  await after.flush(ctx);
}

export async function rejectOrder(
  ctx: AppContext,
  auth: StaffAuth,
  orderId: string,
  reason: string,
) {
  const after = new AfterCommit();
  await ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth.branch.id, orderId);
    if (!['placed', 'accepted'].includes(order.status)) {
      throw conflict(
        'cannot_reject',
        'فقط سفارش‌هایی که هنوز آماده‌سازی‌شان شروع نشده قابل رد هستند',
      );
    }
    await closeOrder(ctx, tx, order, {
      status: 'rejected',
      reason,
      actor: { kind: 'staff', id: auth.staff.id },
      after,
    });
  });
  await after.flush(ctx);
}

// ─── Acceptance ──────────────────────────────────────────────────────────────

/** Recomputes totals after the restaurant strikes lines, refunding any overpayment to the wallet. */
async function applyLineRemoval(ctx: AppContext, tx: Tx, order: Order, removedIds: string[]) {
  const now = ctx.now();
  await tx
    .update(orderLines)
    .set({ removed: true })
    .where(and(eq(orderLines.orderId, order.id), inArray(orderLines.id, removedIds)));
  await reverseCredits(tx, order.id, now, removedIds);

  const remaining = await tx
    .select()
    .from(orderLines)
    .where(and(eq(orderLines.orderId, order.id), eq(orderLines.removed, false)));
  const [credit] = await tx
    .select({ value: sql<number>`coalesce(sum(${creditRedemptions.value}), 0)` })
    .from(creditRedemptions)
    .where(
      and(eq(creditRedemptions.orderId, order.id), sql`${creditRedemptions.reversedAt} is null`),
    );

  const subtotal = remaining.reduce((s, l) => s + l.lineTotal, 0);
  const creditsValue = credit?.value ?? 0;
  const payable = subtotal - creditsValue;
  const memberDiscount = Math.floor((payable * order.memberDiscountPct) / 100);
  const afterMember = payable - memberDiscount;

  let promoDiscount = 0;
  if (order.promotionId) {
    const [promo] = await tx.select().from(promotions).where(eq(promotions.id, order.promotionId));
    if (promo && afterMember >= promo.minOrder) {
      promoDiscount =
        promo.kind === 'percent'
          ? Math.floor((afterMember * promo.value) / 100)
          : Math.min(Math.round(promo.value), afterMember);
      if (promo.maxDiscount !== null) promoDiscount = Math.min(promoDiscount, promo.maxDiscount);
    }
    await tx
      .update(promotionRedemptions)
      .set({ amount: promoDiscount })
      .where(
        and(
          eq(promotionRedemptions.orderId, order.id),
          sql`${promotionRedemptions.reversedAt} is null`,
        ),
      );
  }
  const total = afterMember - promoDiscount;

  const refund = Math.max(order.paidAmount - total, 0);
  if (refund > 0) {
    await walletCredit(tx, order.membershipId, refund, 'refund', {
      orderId: order.id,
      note: `بازگشت وجه اقلام حذف‌شده سفارش ${toFaDigits(order.number)}`,
    });
  }

  const nutrition = remaining.reduce(
    (acc, l) => {
      for (const k of Object.keys(acc) as (keyof typeof acc)[])
        acc[k] += l.nutrition[k] * l.quantity;
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
  );

  const updated = {
    subtotal,
    creditsValue,
    memberDiscount,
    promoDiscount,
    total,
    paidAmount: order.paidAmount - refund,
    nutrition,
  };
  await tx
    .update(orders)
    .set({ ...updated, updatedAt: now })
    .where(eq(orders.id, order.id));
  return { remaining, refund, order: { ...order, ...updated } };
}

export interface AcceptOptions {
  removeLineIds?: string[];
  /** Accept even if the books say an ingredient is short (the kitchen knows better). */
  force?: boolean;
}

/**
 * The acceptance step: the restaurant confirms it can make the whole order. Ingredients are
 * deducted from stock now, and every station's ticket is released (or scheduled, for pre-orders).
 * This is what lets the café start drinks only for orders the kitchen has committed to.
 */
export async function acceptOrder(
  ctx: AppContext,
  actor: { kind: 'staff'; staff: StaffMember } | { kind: 'system' },
  branch: Branch,
  orderId: string,
  opts: AcceptOptions = {},
) {
  const now = ctx.now();
  const after = new AfterCommit();
  const eventActor: Actor =
    actor.kind === 'staff' ? { kind: 'staff', id: actor.staff.id } : { kind: 'system' };

  const outcome = await ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, branch.id, orderId);
    if (order.status !== 'placed') throw conflict('not_pending', 'این سفارش قبلاً بررسی شده است');

    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    const tickets = await tx
      .select()
      .from(stationTickets)
      .where(eq(stationTickets.orderId, order.id));
    const stationRows = await tx.select().from(stations).where(eq(stations.branchId, branch.id));

    if (actor.kind === 'staff' && actor.staff.role === 'cafe') {
      const acceptanceIds = new Set(stationRows.filter((s) => s.isAcceptance).map((s) => s.id));
      if (lines.some((l) => acceptanceIds.has(l.stationId))) {
        throw forbidden('این سفارش آیتم رستوران دارد و باید توسط رستوران تأیید شود');
      }
    }

    const removeIds = opts.removeLineIds ?? [];
    if (removeIds.some((id) => !lines.some((l) => l.id === id)))
      throw badRequest('invalid_line', 'آیتم انتخاب‌شده متعلق به این سفارش نیست');

    let current = order;
    let activeLines = lines;
    let refund = 0;
    if (removeIds.length) {
      if (removeIds.length === lines.length) {
        await closeOrder(ctx, tx, order, {
          status: 'rejected',
          reason: 'اقلام سفارش موجود نبود',
          actor: eventActor,
          after,
        });
        return { accepted: false as const };
      }
      const r = await applyLineRemoval(ctx, tx, order, removeIds);
      current = r.order;
      activeLines = r.remaining;
      refund = r.refund;
    }

    const catalog = await loadCatalog(tx, branch.id);
    const req = linesRequirements(
      catalog,
      activeLines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        optionIds: l.options.map((o) => o.id),
      })),
    );
    const changed = await applyMovements(
      tx,
      branch.id,
      [...req].map(([ingredientId, qty]) => ({
        ingredientId,
        delta: -qty,
        reason: 'sale' as const,
        refType: 'order',
        refId: order.id,
        staffId: actor.kind === 'staff' ? actor.staff.id : null,
      })),
      { allowNegative: Boolean(opts.force) || !branch.settings.enforceStock },
    );
    if (changed.length) after.publish(branch.id, { type: 'stock.changed', ingredientIds: changed });

    await tx
      .update(orders)
      .set({
        status: 'accepted',
        acceptedAt: now,
        acceptedBy: actor.kind === 'staff' ? actor.staff.id : null,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));

    const stationById = new Map(stationRows.map((s) => [s.id, s]));
    for (const ticket of tickets) {
      const stationLines = activeLines.filter((l) => l.stationId === ticket.stationId);
      if (!stationLines.length) {
        await tx
          .update(stationTickets)
          .set({ status: 'cancelled' })
          .where(eq(stationTickets.id, ticket.id));
        continue;
      }
      const prep = Math.max(
        stationById.get(ticket.stationId)?.defaultPrepMinutes ?? 10,
        ...stationLines.map((l) => catalog.items.get(l.menuItemId)?.prepMinutes ?? 0),
      );
      const dueAt = current.scheduledFor
        ? new Date(current.scheduledFor.getTime() - prep * 60_000)
        : null;
      const scheduled = dueAt !== null && dueAt.getTime() > now.getTime() + 60_000;
      await tx
        .update(stationTickets)
        .set({
          status: scheduled ? 'scheduled' : 'queued',
          dueAt,
          releasedAt: scheduled ? null : now,
        })
        .where(eq(stationTickets.id, ticket.id));
      after.publish(branch.id, {
        type: 'ticket.updated',
        orderId: order.id,
        ticketId: ticket.id,
        stationId: ticket.stationId,
        status: scheduled ? 'scheduled' : 'queued',
      });
    }

    await tx.insert(orderEvents).values({
      orderId: order.id,
      type: 'accepted',
      ...actorFields(eventActor),
      data: { removedLineIds: removeIds, refund, forced: Boolean(opts.force) },
    });
    after.publish(branch.id, {
      type: 'order.updated',
      orderId: order.id,
      status: 'accepted',
      number: order.number,
    });

    if (current.scheduledFor) {
      const [u] = await tx
        .select({ phone: users.phone })
        .from(users)
        .where(eq(users.id, order.userId));
      if (u) {
        await queueSms(tx, {
          branchId: branch.id,
          phone: u.phone,
          template: 'order_accepted',
          body: smsText.orderAccepted(order.number, current.scheduledFor),
        });
      }
    }
    return { accepted: true as const, refund };
  });
  await after.flush(ctx);
  return outcome;
}

/** Accepts automatically when the branch allows it and stock covers the order; otherwise leaves it for staff. */
export async function maybeAutoAccept(ctx: AppContext, orderId: string) {
  const [row] = await ctx.db
    .select({ order: orders, branch: branches })
    .from(orders)
    .innerJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.id, orderId));
  if (!row || row.order.status !== 'placed' || !row.branch.settings.autoAccept) return;
  try {
    await acceptOrder(ctx, { kind: 'system' }, row.branch, orderId);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    await ctx.db.insert(orderEvents).values({
      orderId,
      type: 'auto_accept_skipped',
      actorKind: 'system',
      data: { code: err.code, message: err.message },
    });
  }
}

// ─── Station work ────────────────────────────────────────────────────────────

export type TicketAction = 'start' | 'ready' | 'reopen';

export async function updateTicket(
  ctx: AppContext,
  auth: StaffAuth,
  ticketId: string,
  action: TicketAction,
) {
  const now = ctx.now();
  const after = new AfterCommit();
  await ctx.db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(stationTickets)
      .where(and(eq(stationTickets.id, ticketId), eq(stationTickets.branchId, auth.branch.id)))
      .for('update');
    if (!ticket) throw notFound('تیکت پیدا نشد');
    const order = await lockOrder(tx, auth.branch.id, ticket.orderId);
    if (['completed', 'rejected', 'cancelled'].includes(order.status))
      throw conflict('order_closed', 'این سفارش بسته شده است');

    let next: typeof ticket.status;
    const patch: Partial<typeof stationTickets.$inferInsert> = {};
    if (action === 'start') {
      if (!['queued', 'scheduled'].includes(ticket.status))
        throw conflict('invalid_transition', 'این تیکت قابل شروع نیست');
      next = 'preparing';
      patch.startedAt = now;
      patch.releasedAt = ticket.releasedAt ?? now;
    } else if (action === 'ready') {
      if (!['preparing', 'queued'].includes(ticket.status))
        throw conflict('invalid_transition', 'این تیکت هنوز شروع نشده است');
      next = 'ready';
      patch.readyAt = now;
      patch.startedAt = ticket.startedAt ?? now;
    } else {
      if (ticket.status !== 'ready')
        throw conflict('invalid_transition', 'فقط تیکت آماده را می‌توان برگرداند');
      next = 'preparing';
      patch.readyAt = null;
    }
    await tx
      .update(stationTickets)
      .set({ status: next, ...patch })
      .where(eq(stationTickets.id, ticket.id));
    after.publish(auth.branch.id, {
      type: 'ticket.updated',
      orderId: order.id,
      ticketId: ticket.id,
      stationId: ticket.stationId,
      status: next,
    });

    const all = await tx.select().from(stationTickets).where(eq(stationTickets.orderId, order.id));
    const active = all.filter((t) => t.status !== 'cancelled');
    let orderStatus: OrderStatus = order.status;
    if (active.every((t) => t.status === 'ready' || t.status === 'served')) orderStatus = 'ready';
    else if (active.some((t) => ['preparing', 'ready'].includes(t.status)))
      orderStatus = 'preparing';

    if (orderStatus !== order.status) {
      await tx
        .update(orders)
        .set({ status: orderStatus, readyAt: orderStatus === 'ready' ? now : null, updatedAt: now })
        .where(eq(orders.id, order.id));
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: orderStatus,
        actorKind: 'staff',
        actorId: auth.staff.id,
      });
      after.publish(auth.branch.id, {
        type: 'order.updated',
        orderId: order.id,
        status: orderStatus,
        number: order.number,
      });

      if (orderStatus === 'ready') {
        const stationRows = await tx
          .select()
          .from(stations)
          .where(
            inArray(
              stations.id,
              active.map((t) => t.stationId),
            ),
          );
        const where = stationRows
          .map((s) => (s.floorLabel ? `${s.name} (${s.floorLabel})` : s.name))
          .join(' و ');
        const [u] = await tx
          .select({ phone: users.phone })
          .from(users)
          .where(eq(users.id, order.userId));
        if (u) {
          await queueSms(tx, {
            branchId: auth.branch.id,
            phone: u.phone,
            template: 'order_ready',
            body: smsText.orderReady(
              order.number,
              order.type === 'dine_in' ? 'سر میز شما می‌آوریم' : `تحویل از ${where}`,
            ),
          });
        }
      }
    }
  });
  await after.flush(ctx);
}

async function collectAtCounter(tx: Tx, order: Order, staffId: string) {
  const due = order.total - order.paidAmount;
  if (due <= 0) return;
  const [payment] = await tx
    .insert(payments)
    .values({
      branchId: order.branchId,
      membershipId: order.membershipId,
      purpose: 'order',
      method: 'counter',
      amount: due,
      status: 'succeeded',
      orderId: order.id,
      paidAt: sql`now()`,
      reviewedBy: staffId,
    })
    .returning();
  // A card-to-card receipt still waiting for review is superseded by the counter payment.
  await tx
    .update(payments)
    .set({ status: 'cancelled', reviewNote: 'پرداخت در صندوق' })
    .where(and(eq(payments.orderId, order.id), eq(payments.status, 'awaiting_review')));
  await tx
    .update(orders)
    .set({ paidAmount: order.total, paymentState: 'paid' })
    .where(eq(orders.id, order.id));
  await tx.insert(orderEvents).values({
    orderId: order.id,
    type: 'payment_succeeded',
    actorKind: 'staff',
    actorId: staffId,
    data: { paymentId: payment!.id, method: 'counter', amount: due },
  });
}

export async function collectPayment(ctx: AppContext, auth: StaffAuth, orderId: string) {
  const after = new AfterCommit();
  await ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth.branch.id, orderId);
    if (order.paymentState !== 'unpaid') throw conflict('already_paid', 'این سفارش پرداخت شده است');
    if (['rejected', 'cancelled', 'awaiting_payment'].includes(order.status))
      throw conflict('order_closed', 'این سفارش باز نیست');
    await collectAtCounter(tx, order, auth.staff.id);
    after.publish(auth.branch.id, {
      type: 'order.updated',
      orderId: order.id,
      status: order.status,
      number: order.number,
    });
  });
  await after.flush(ctx);
}

/** Hands the order to the member. Unpaid orders must be paid at the counter first (or in the same step). */
export async function handoverOrder(
  ctx: AppContext,
  auth: StaffAuth,
  orderId: string,
  opts: { collect?: boolean } = {},
) {
  const now = ctx.now();
  const after = new AfterCommit();
  const order = await ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, auth.branch.id, orderId);
    if (order.status !== 'ready') throw conflict('not_ready', 'سفارش هنوز آماده نیست');
    if (order.paymentState === 'unpaid' && order.total > order.paidAmount) {
      if (!opts.collect) {
        throw conflict(
          'payment_required',
          `مبلغ ${formatToman(order.total - order.paidAmount)} هنوز پرداخت نشده است`,
        );
      }
      await collectAtCounter(tx, order, auth.staff.id);
    }
    await tx
      .update(orders)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(orders.id, order.id));
    await tx
      .update(stationTickets)
      .set({ status: 'served', servedAt: now })
      .where(and(eq(stationTickets.orderId, order.id), ne(stationTickets.status, 'cancelled')));
    await tx
      .insert(orderEvents)
      .values({ orderId: order.id, type: 'completed', actorKind: 'staff', actorId: auth.staff.id });
    after.publish(auth.branch.id, {
      type: 'order.updated',
      orderId: order.id,
      status: 'completed',
      number: order.number,
    });
    return order;
  });
  await after.flush(ctx);
  await refreshTier(ctx.db, auth.branch, order.membershipId, now);
}

/** Scheduler: pre-order tickets whose start time has come move into the station queue. */
export async function releaseDueTickets(ctx: AppContext) {
  const now = ctx.now();
  const released = await ctx.db
    .update(stationTickets)
    .set({ status: 'queued', releasedAt: now })
    .where(and(eq(stationTickets.status, 'scheduled'), lte(stationTickets.dueAt, now)))
    .returning();
  for (const t of released) {
    ctx.bus.publish(t.branchId, {
      type: 'ticket.updated',
      orderId: t.orderId,
      ticketId: t.id,
      stationId: t.stationId,
      status: 'queued',
    });
  }
  return released.length;
}

export async function rateOrder(
  ctx: AppContext,
  auth: ActiveMember,
  orderId: string,
  rating: number,
  comment?: string,
) {
  const [row] = await ctx.db
    .update(orders)
    .set({ rating, ratingComment: comment ?? null, ratedAt: ctx.now() })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.membershipId, auth.membership.id),
        eq(orders.status, 'completed'),
      ),
    )
    .returning({ id: orders.id });
  if (!row) throw conflict('cannot_rate', 'فقط سفارش تحویل‌شده را می‌توان امتیاز داد');
}

// ─── Read models ─────────────────────────────────────────────────────────────

export async function orderViews(
  db: Executor,
  orderRows: Order[],
  opts: { withMember?: boolean } = {},
) {
  if (!orderRows.length) return [];
  const ids = orderRows.map((o) => o.id);
  const [lineRows, ticketRows, stationRows, paymentRows, spotRows, memberRows] = await Promise.all([
    db.select().from(orderLines).where(inArray(orderLines.orderId, ids)),
    db.select().from(stationTickets).where(inArray(stationTickets.orderId, ids)),
    db.select().from(stations).where(eq(stations.branchId, orderRows[0]!.branchId)),
    db
      .select()
      .from(payments)
      .where(
        and(
          inArray(payments.orderId, ids),
          inArray(payments.status, ['pending', 'awaiting_review']),
        ),
      )
      .orderBy(desc(payments.createdAt)),
    db
      .select()
      .from(spots)
      .where(
        inArray(
          spots.id,
          orderRows
            .map((o) => o.spotId)
            .filter((v): v is string => v !== null)
            .concat(['00000000-0000-0000-0000-000000000000']),
        ),
      ),
    opts.withMember
      ? db
          .select({
            membershipId: memberships.id,
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            isVip: memberships.isVip,
            tierName: tiers.name,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(tiers, eq(tiers.id, memberships.tierId))
          .where(
            inArray(
              memberships.id,
              orderRows.map((o) => o.membershipId),
            ),
          )
      : Promise.resolve([]),
  ]);
  const stationById = new Map(stationRows.map((s) => [s.id, s]));
  const spotById = new Map(spotRows.map((s) => [s.id, s]));
  const memberById = new Map(memberRows.map((m) => [m.membershipId, m]));

  return orderRows.map((o) => {
    const pending = paymentRows.find((p) => p.orderId === o.id);
    const member = memberById.get(o.membershipId);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      type: o.type,
      source: o.source,
      scheduledFor: o.scheduledFor,
      createdAt: o.createdAt,
      acceptedAt: o.acceptedAt,
      readyAt: o.readyAt,
      completedAt: o.completedAt,
      paymentState: o.paymentState,
      paymentMethod: o.paymentMethod,
      subtotal: o.subtotal,
      creditsValue: o.creditsValue,
      memberDiscount: o.memberDiscount,
      promoDiscount: o.promoDiscount,
      total: o.total,
      paidAmount: o.paidAmount,
      nutrition: o.nutrition,
      note: o.note,
      rejectReason: o.rejectReason,
      rating: o.rating,
      ratingComment: o.ratingComment,
      spot: o.spotId ? { label: spotById.get(o.spotId)?.label ?? '' } : null,
      lines: lineRows
        .filter((l) => l.orderId === o.id)
        .map((l) => ({
          id: l.id,
          menuItemId: l.menuItemId,
          stationId: l.stationId,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          options: l.options,
          lineTotal: l.lineTotal,
          creditsUsed: l.creditsUsed,
          nutrition: l.nutrition,
          note: l.note,
          removed: l.removed,
        })),
      tickets: ticketRows
        .filter((t) => t.orderId === o.id)
        .map((t) => {
          const s = stationById.get(t.stationId);
          return {
            id: t.id,
            stationId: t.stationId,
            stationName: s?.name ?? '',
            floorLabel: s?.floorLabel ?? null,
            isAcceptance: s?.isAcceptance ?? false,
            status: t.status,
            dueAt: t.dueAt,
            startedAt: t.startedAt,
            readyAt: t.readyAt,
          };
        })
        .sort((a, b) => Number(b.isAcceptance) - Number(a.isAcceptance)),
      pendingPayment: pending
        ? {
            id: pending.id,
            method: pending.method,
            status: pending.status,
            amount: pending.amount,
            trackingCode: pending.trackingCode,
            cardLast4: pending.cardLast4,
          }
        : null,
      member: member
        ? {
            name: [member.firstName, member.lastName].filter(Boolean).join(' ') || null,
            phone: member.phone,
            isVip: member.isVip,
            tierName: member.tierName,
          }
        : undefined,
    };
  });
}

export type OrderView = Awaited<ReturnType<typeof orderViews>>[number];

export async function memberOrders(ctx: AppContext, membershipId: string, limit = 30) {
  const rows = await ctx.db
    .select()
    .from(orders)
    .where(eq(orders.membershipId, membershipId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return orderViews(ctx.db, rows);
}

export async function memberOrder(ctx: AppContext, membershipId: string, orderId: string) {
  const rows = await ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.membershipId, membershipId)));
  const [view] = await orderViews(ctx.db, rows);
  if (!view) throw notFound('سفارش پیدا نشد');
  return view;
}

/** Everything the station boards show: open orders plus the last few hours of closed ones. */
export async function staffBoard(ctx: AppContext, branchId: string) {
  const since = new Date(ctx.now().getTime() - 3 * 3_600_000);
  const rows = await ctx.db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.branchId, branchId),
        or(
          inArray(orders.status, ['placed', 'accepted', 'preparing', 'ready']),
          and(
            inArray(orders.status, ['completed', 'rejected', 'cancelled']),
            gte(orders.updatedAt, since),
          ),
        ),
      ),
    )
    .orderBy(orders.createdAt);
  return orderViews(ctx.db, rows, { withMember: true });
}

export async function staffOrder(ctx: AppContext, branchId: string, orderId: string) {
  const rows = await ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.branchId, branchId)));
  const [view] = await orderViews(ctx.db, rows, { withMember: true });
  if (!view) throw notFound('سفارش پیدا نشد');
  const events = await ctx.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.createdAt);
  return { ...view, events };
}
