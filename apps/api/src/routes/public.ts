import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import { spots, stations } from '../db/schema';
import { requireBranch } from '../lib/auth';
import { notFound } from '../lib/errors';
import { isOpenAt } from '../modules/branch/hours';
import { publicMenu } from '../modules/menu/service';
import { listPlans } from '../modules/plans/service';
import { activeCashbackRules } from '../modules/wallet/service';

export function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/branch', async (req) => {
    const b = await requireBranch(ctx, req);
    const stationRows = await ctx.db
      .select()
      .from(stations)
      .where(and(eq(stations.branchId, b.id), eq(stations.isActive, true)));
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      gymName: b.gymName,
      address: b.address,
      phone: b.phone,
      instagram: b.instagram,
      whatsapp: b.whatsapp,
      cardNumber: b.cardNumber,
      cardHolder: b.cardHolder,
      openingHours: b.openingHours,
      isOpen: isOpenAt(b.openingHours, ctx.now()),
      stations: stationRows.map((s) => ({
        id: s.id,
        name: s.name,
        floorLabel: s.floorLabel,
        isAcceptance: s.isAcceptance,
      })),
      preorder: {
        maxDays: b.settings.preorderMaxDays,
        minLeadMinutes: b.settings.preorderMinLeadMinutes,
      },
      memberApproval: b.settings.memberApproval,
    };
  });

  app.get('/api/v1/menu', async (req) => publicMenu(ctx, await requireBranch(ctx, req)));

  app.get<{ Params: { code: string } }>('/api/v1/spots/:code', async (req) => {
    const b = await requireBranch(ctx, req);
    const [spot] = await ctx.db
      .select()
      .from(spots)
      .where(
        and(
          eq(spots.code, req.params.code.toUpperCase()),
          eq(spots.branchId, b.id),
          eq(spots.isActive, true),
        ),
      );
    if (!spot) throw notFound('این QR متعلق به این باشگاه نیست');
    return { code: spot.code, label: spot.label, stationId: spot.stationId };
  });

  app.get('/api/v1/plans', async (req) => {
    const b = await requireBranch(ctx, req);
    return listPlans(ctx.db, b.id);
  });

  app.get('/api/v1/cashback', async (req) => {
    const b = await requireBranch(ctx, req);
    const rules = await activeCashbackRules(ctx.db, b.id, ctx.now());
    return rules.map((r) => ({
      id: r.id,
      title: r.title,
      minAmount: r.minAmount,
      percent: r.percent,
      maxBonus: r.maxBonus,
    }));
  });
}
