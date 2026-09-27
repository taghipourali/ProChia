import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { ANALYTICS_EVENTS } from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  events,
  ingredients,
  memberships,
  orderEvents,
  orderLines,
  orders,
  payments,
  stationTickets,
  stations,
  stockMovements,
  subscriptions,
  users,
  walletEntries,
} from '../../db/schema';

const KNOWN_EVENTS = new Set<string>(ANALYTICS_EVENTS);

export async function recordEvents(
  ctx: AppContext,
  branchId: string,
  userId: string | null,
  anonId: string | undefined,
  batch: { name: string; props?: Record<string, string | number | boolean | null>; at?: string }[],
) {
  const now = ctx.now().getTime();
  const rows = batch
    .filter((e) => KNOWN_EVENTS.has(e.name))
    .map((e) => {
      // Client clocks drift; accept their timestamp only if it is within the last day.
      const at = e.at ? new Date(e.at) : null;
      const createdAt = at && Math.abs(now - at.getTime()) < 86_400_000 ? at : new Date(now);
      return {
        branchId,
        userId,
        anonId: anonId ?? null,
        name: e.name,
        props: e.props ?? null,
        createdAt,
      };
    });
  if (rows.length) await ctx.db.insert(events).values(rows);
  return rows.length;
}

const REVENUE_STATUSES = ['completed'] as const;

/**
 * One call for the manager dashboard. Everything is computed in SQL over the range and returned
 * ready to chart: money, demand, speed of service, what members think, and how they use the app.
 */
export async function overview(ctx: AppContext, branchId: string, from: Date, to: Date) {
  const inRange = and(
    eq(orders.branchId, branchId),
    gte(orders.createdAt, from),
    lt(orders.createdAt, to),
  );
  const completed = and(inRange, inArray(orders.status, [...REVENUE_STATUSES]));

  const [
    kpi,
    daily,
    topItems,
    heat,
    paymentMix,
    serviceTimes,
    acceptance,
    ratings,
    lowRated,
    funnel,
    suggestion,
    members,
    wallet,
    planSales,
    stock,
    waste,
    consumed,
  ] = await Promise.all([
    ctx.db
      .select({
        revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
        orders: sql<number>`count(*)`,
        creditsValue: sql<number>`coalesce(sum(${orders.creditsValue}), 0)`,
        discounts: sql<number>`coalesce(sum(${orders.memberDiscount} + ${orders.promoDiscount}), 0)`,
        preorders: sql<number>`count(*) filter (where ${orders.scheduledFor} is not null)`,
        protein: sql<number>`coalesce(sum((${orders.nutrition}->>'protein')::numeric), 0)`,
      })
      .from(orders)
      .where(completed),
    ctx.db
      .select({
        day: orders.businessDate,
        revenue: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'completed'), 0)`,
        orders: sql<number>`count(*) filter (where ${orders.status} = 'completed')`,
        rejected: sql<number>`count(*) filter (where ${orders.status} in ('rejected', 'cancelled'))`,
      })
      .from(orders)
      .where(inRange)
      .groupBy(orders.businessDate)
      .orderBy(orders.businessDate),
    ctx.db
      .select({
        menuItemId: orderLines.menuItemId,
        name: orderLines.name,
        quantity: sql<number>`sum(${orderLines.quantity})`,
        revenue: sql<number>`sum(${orderLines.lineTotal})`,
      })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(and(completed, eq(orderLines.removed, false)))
      .groupBy(orderLines.menuItemId, orderLines.name)
      .orderBy(desc(sql`sum(${orderLines.quantity})`))
      .limit(10),
    ctx.db
      .select({
        weekday: sql<number>`extract(dow from ${orders.createdAt} at time zone 'Asia/Tehran')::int`,
        hour: sql<number>`extract(hour from ${orders.createdAt} at time zone 'Asia/Tehran')::int`,
        orders: sql<number>`count(*)`,
      })
      .from(orders)
      .where(completed)
      .groupBy(sql`1`, sql`2`),
    ctx.db
      .select({
        method: payments.method,
        amount: sql<number>`sum(${payments.amount})`,
        count: sql<number>`count(*)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.branchId, branchId),
          eq(payments.status, 'succeeded'),
          gte(payments.createdAt, from),
          lt(payments.createdAt, to),
        ),
      )
      .groupBy(payments.method),
    ctx.db
      .select({
        stationId: stationTickets.stationId,
        stationName: stations.name,
        tickets: sql<number>`count(*)`,
        medianPrepMinutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${stationTickets.readyAt} - ${stationTickets.startedAt}) / 60)`,
        medianWaitMinutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${stationTickets.startedAt} - ${stationTickets.releasedAt}) / 60)`,
      })
      .from(stationTickets)
      .innerJoin(stations, eq(stations.id, stationTickets.stationId))
      .where(
        and(
          eq(stationTickets.branchId, branchId),
          isNotNull(stationTickets.readyAt),
          isNotNull(stationTickets.startedAt),
          gte(stationTickets.createdAt, from),
          lt(stationTickets.createdAt, to),
        ),
      )
      .groupBy(stationTickets.stationId, stations.name),
    ctx.db
      .select({
        medianAcceptMinutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${orders.acceptedAt} - ${orders.createdAt}) / 60)`,
        medianTotalMinutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${orders.readyAt} - ${orders.createdAt}) / 60) filter (where ${orders.scheduledFor} is null)`,
      })
      .from(orders)
      .where(and(inRange, isNotNull(orders.acceptedAt))),
    ctx.db
      .select({ rating: orders.rating, count: sql<number>`count(*)` })
      .from(orders)
      .where(and(inRange, isNotNull(orders.rating)))
      .groupBy(orders.rating),
    ctx.db
      .select({
        orderId: orders.id,
        number: orders.number,
        rating: orders.rating,
        comment: orders.ratingComment,
        ratedAt: orders.ratedAt,
        firstName: users.firstName,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(and(inRange, sql`${orders.rating} <= 3`))
      .orderBy(desc(orders.ratedAt))
      .limit(8),
    ctx.db
      .select({
        name: events.name,
        visitors: sql<number>`count(distinct coalesce(${events.userId}::text, ${events.anonId}) || ':' || (${events.createdAt} at time zone 'Asia/Tehran')::date)`,
      })
      .from(events)
      .where(
        and(
          eq(events.branchId, branchId),
          gte(events.createdAt, from),
          lt(events.createdAt, to),
          inArray(events.name, [
            'menu_view',
            'item_view',
            'add_to_cart',
            'checkout_start',
            'order_placed',
          ]),
        ),
      )
      .groupBy(events.name),
    ctx.db
      .select({ name: events.name, count: sql<number>`count(*)` })
      .from(events)
      .where(
        and(
          eq(events.branchId, branchId),
          gte(events.createdAt, from),
          lt(events.createdAt, to),
          inArray(events.name, ['suggestion_shown', 'suggestion_click']),
        ),
      )
      .groupBy(events.name),
    ctx.db
      .select({
        total: sql<number>`count(*) filter (where ${memberships.status} = 'active')`,
        pending: sql<number>`count(*) filter (where ${memberships.status} = 'pending')`,
        joined: sql<number>`count(*) filter (where ${memberships.createdAt} >= ${from} and ${memberships.createdAt} < ${to})`,
        vip: sql<number>`count(*) filter (where ${memberships.isVip})`,
        walletFloat: sql<number>`coalesce(sum(${memberships.walletBalance}), 0)`,
      })
      .from(memberships)
      .where(eq(memberships.branchId, branchId)),
    ctx.db
      .select({ kind: walletEntries.kind, amount: sql<number>`sum(${walletEntries.amount})` })
      .from(walletEntries)
      .innerJoin(memberships, eq(memberships.id, walletEntries.membershipId))
      .where(
        and(
          eq(memberships.branchId, branchId),
          gte(walletEntries.createdAt, from),
          lt(walletEntries.createdAt, to),
        ),
      )
      .groupBy(walletEntries.kind),
    ctx.db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${subscriptions.pricePaid}), 0)`,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.branchId, branchId),
          inArray(subscriptions.status, ['active', 'expired']),
          gte(subscriptions.createdAt, from),
          lt(subscriptions.createdAt, to),
        ),
      ),
    ctx.db
      .select({
        value: sql<number>`coalesce(sum(greatest(${ingredients.onHand}, 0) * ${ingredients.avgCost}), 0)`,
        low: sql<number>`count(*) filter (where ${ingredients.onHand} <= ${ingredients.lowStockThreshold} and ${ingredients.isActive})`,
      })
      .from(ingredients)
      .where(eq(ingredients.branchId, branchId)),
    ctx.db
      .select({
        cost: sql<number>`coalesce(sum(-${stockMovements.delta} * coalesce(${stockMovements.unitCost}, 0)), 0)`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.branchId, branchId),
          eq(stockMovements.reason, 'waste'),
          gte(stockMovements.createdAt, from),
          lt(stockMovements.createdAt, to),
        ),
      ),
    ctx.db
      .select({
        cogs: sql<number>`coalesce(sum(-${stockMovements.delta} * coalesce(${stockMovements.unitCost}, 0)), 0)`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.branchId, branchId),
          inArray(stockMovements.reason, ['sale', 'sale_reversal']),
          gte(stockMovements.createdAt, from),
          lt(stockMovements.createdAt, to),
        ),
      ),
  ]);

  const k = kpi[0]!;
  const funnelMap = Object.fromEntries(funnel.map((f) => [f.name, f.visitors]));
  const sugMap = Object.fromEntries(suggestion.map((s) => [s.name, s.count]));
  const walletMap = Object.fromEntries(wallet.map((w) => [w.kind, w.amount]));
  const cogs = Math.round(consumed[0]?.cogs ?? 0);
  const repeat = await repeatRate(ctx, branchId, from, to);

  return {
    range: { from, to },
    kpi: {
      revenue: k.revenue,
      orders: k.orders,
      averageOrder: k.orders ? Math.round(k.revenue / k.orders) : 0,
      creditsValue: k.creditsValue,
      discounts: k.discounts,
      preorderShare: k.orders ? k.preorders / k.orders : 0,
      proteinServedKg: Math.round(k.protein / 100) / 10,
      foodCost: cogs,
      foodCostPct: k.revenue + k.creditsValue > 0 ? cogs / (k.revenue + k.creditsValue) : 0,
      repeatRate: repeat,
    },
    daily,
    topItems,
    heatmap: heat,
    paymentMix,
    service: {
      medianAcceptMinutes: round1(acceptance[0]?.medianAcceptMinutes),
      medianTotalMinutes: round1(acceptance[0]?.medianTotalMinutes),
      stations: serviceTimes.map((s) => ({
        ...s,
        medianPrepMinutes: round1(s.medianPrepMinutes),
        medianWaitMinutes: round1(s.medianWaitMinutes),
      })),
    },
    ratings: {
      distribution: ratings,
      average: averageRating(ratings),
      recentLow: lowRated,
    },
    funnel: ['menu_view', 'item_view', 'add_to_cart', 'checkout_start', 'order_placed'].map(
      (name) => ({
        name,
        visitors: funnelMap[name] ?? 0,
      }),
    ),
    suggestions: {
      shown: sugMap.suggestion_shown ?? 0,
      clicked: sugMap.suggestion_click ?? 0,
    },
    members: members[0]!,
    wallet: {
      topups: walletMap.topup ?? 0,
      bonuses: walletMap.bonus ?? 0,
      refunds: walletMap.refund ?? 0,
    },
    plans: planSales[0]!,
    inventory: {
      value: Math.round(stock[0]?.value ?? 0),
      lowCount: stock[0]?.low ?? 0,
      wasteCost: Math.round(waste[0]?.cost ?? 0),
    },
  };
}

const round1 = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 10) / 10;

function averageRating(rows: { rating: number | null; count: number }[]) {
  const n = rows.reduce((s, r) => s + r.count, 0);
  return n
    ? Math.round((rows.reduce((s, r) => s + (r.rating ?? 0) * r.count, 0) / n) * 10) / 10
    : null;
}

/** Share of members who ordered in the range and had ordered at least once before it. */
async function repeatRate(ctx: AppContext, branchId: string, from: Date, to: Date) {
  const [row] = await ctx.db
    .execute<{ active: number; returning: number }>(
      sql`
    with active as (
      select distinct membership_id from ${orders}
      where branch_id = ${branchId} and status = 'completed' and created_at >= ${from} and created_at < ${to}
    )
    select
      (select count(*) from active)::int as active,
      (select count(*) from active a where exists (
        select 1 from ${orders} o where o.membership_id = a.membership_id and o.status = 'completed' and o.created_at < ${from}
      ))::int as returning
  `,
    )
    .then((r) => r.rows);
  return row && row.active ? row.returning / row.active : 0;
}

/** Recent order timeline across the branch — the manager's "what just happened" feed. */
export async function recentActivity(ctx: AppContext, branchId: string, limit = 30) {
  return ctx.db
    .select({
      id: orderEvents.id,
      orderId: orderEvents.orderId,
      number: orders.number,
      type: orderEvents.type,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .innerJoin(orders, eq(orders.id, orderEvents.orderId))
    .where(eq(orders.branchId, branchId))
    .orderBy(desc(orderEvents.createdAt))
    .limit(limit);
}
