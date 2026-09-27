import { and, avg, eq, gte, inArray, sql } from 'drizzle-orm';
import type { MealSlot } from '@prochia/shared';
import { mealTarget, tehranIsoDate } from '@prochia/shared';
import type { AppContext } from '../../context';
import { events, healthProfiles, orderLines, orders } from '../../db/schema';
import type { MemberAuth } from '../../lib/auth';
import { publicMenu } from '../menu/service';
import { recommend, slotFor, type CandidateItem } from './engine';

export async function recommendationsFor(
  ctx: AppContext,
  auth: MemberAuth & { membership: { id: string } },
  requestedSlot?: MealSlot,
) {
  const [profile] = await ctx.db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, auth.user.id));
  if (!profile) return { needsProfile: true as const };

  const now = ctx.now();
  const slot = requestedSlot ?? slotFor(profile.trainingTime, now);
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const [menu, eaten, history, ratings] = await Promise.all([
    publicMenu(ctx, auth.branch),
    ctx.db
      .select({
        kcal: sql<number>`coalesce(sum((${orders.nutrition}->>'kcal')::numeric), 0)`,
        protein: sql<number>`coalesce(sum((${orders.nutrition}->>'protein')::numeric), 0)`,
        carbs: sql<number>`coalesce(sum((${orders.nutrition}->>'carbs')::numeric), 0)`,
        fat: sql<number>`coalesce(sum((${orders.nutrition}->>'fat')::numeric), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.membershipId, auth.membership.id),
          eq(orders.businessDate, tehranIsoDate(now)),
          inArray(orders.status, ['placed', 'accepted', 'preparing', 'ready', 'completed']),
        ),
      ),
    ctx.db
      .select({ id: orderLines.menuItemId, n: sql<number>`sum(${orderLines.quantity})` })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orders.membershipId, auth.membership.id),
          eq(orders.status, 'completed'),
          gte(orders.createdAt, since),
        ),
      )
      .groupBy(orderLines.menuItemId),
    ctx.db
      .select({ id: orderLines.menuItemId, rating: avg(orders.rating).mapWith(Number) })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(and(eq(orders.membershipId, auth.membership.id), sql`${orders.rating} is not null`))
      .groupBy(orderLines.menuItemId),
  ]);

  const items: CandidateItem[] = menu.categories.flatMap((c) => c.items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const eatenToday = eaten[0] ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const suggestions = recommend(
    items,
    {
      goal: profile.goal,
      targets: profile.targets,
      mealsPerDay: profile.mealsPerDay,
      allergens: profile.allergens,
      dietPreferences: profile.dietPreferences,
    },
    slot,
    {
      eatenToday,
      orderCounts: new Map(history.map((h) => [h.id, h.n])),
      ratings: new Map(ratings.map((r) => [r.id, r.rating])),
    },
  );

  if (suggestions.length) {
    await ctx.db.insert(events).values({
      branchId: auth.branch.id,
      userId: auth.user.id,
      name: 'suggestion_shown',
      props: { slot, items: suggestions.map((s) => s.itemId).join(',') },
    });
  }

  return {
    needsProfile: false as const,
    slot,
    target: mealTarget(profile.targets, slot, profile.mealsPerDay),
    daily: profile.targets,
    eatenToday: {
      kcal: Math.round(eatenToday.kcal),
      protein: Math.round(eatenToday.protein),
      carbs: Math.round(eatenToday.carbs),
      fat: Math.round(eatenToday.fat),
    },
    items: suggestions.map((s) => ({ ...s, item: byId.get(s.itemId)! })),
  };
}
