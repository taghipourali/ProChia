import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  branchCreateInput,
  branchSettingsInput,
  campaignInput,
  spotInput,
  staffInput,
  stationInput,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import {
  DEFAULT_BRANCH_SETTINGS,
  branches,
  campaigns,
  smsOutbox,
  spots,
  staff,
  stations,
} from '../../db/schema';
import { requireStaff } from '../../lib/auth';
import { hashPassword, shortCode } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { overview, recentActivity } from '../../modules/analytics/service';
import { audienceSize, sendCampaign } from '../../modules/notifications/campaigns';

const idParam = z.object({ id: z.uuid() });

export function staffAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const memberUrl = (slug: string, path: string) =>
    `https://${slug}.${ctx.config.ROOT_DOMAIN}${path}`;

  // ─── QR spots ──────────────────────────────────────────────────────────────
  app.get('/api/v1/staff/spots', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'orders.view');
    const rows = await ctx.db
      .select()
      .from(spots)
      .where(eq(spots.branchId, branch.id))
      .orderBy(asc(spots.label));
    return Promise.all(
      rows.map(async (s) => {
        const url = memberUrl(branch.slug, `/t/${s.code}`);
        const svg = await QRCode.toString(url, {
          type: 'svg',
          margin: 1,
          errorCorrectionLevel: 'M',
        });
        return { ...s, url, svg };
      }),
    );
  });

  app.post('/api/v1/staff/spots', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    const input = parse(spotInput, req.body);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [row] = await ctx.db
        .insert(spots)
        .values({ ...input, branchId: branch.id, code: shortCode(6) })
        .onConflictDoNothing()
        .returning();
      if (row) return row;
    }
    throw conflict('code_collision', 'دوباره تلاش کنید');
  });

  app.put('/api/v1/staff/spots/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    const [row] = await ctx.db
      .update(spots)
      .set(parse(spotInput, req.body))
      .where(and(eq(spots.id, parse(idParam, req.params).id), eq(spots.branchId, branch.id)))
      .returning();
    if (!row) throw notFound('میز پیدا نشد');
    return row;
  });

  /** Generic QR to the menu (posters at the gym entrance, lockers, reception). */
  app.get('/api/v1/staff/qr/menu', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'orders.view');
    const url = memberUrl(branch.slug, '/');
    return {
      url,
      svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    };
  });

  // ─── SMS ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/staff/campaigns', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'sms.send');
    return ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.branchId, branch.id))
      .orderBy(desc(campaigns.createdAt));
  });

  app.post('/api/v1/staff/campaigns', async (req) => {
    const auth = await requireStaff(ctx, req, 'sms.send');
    const input = parse(campaignInput, req.body);
    const [row] = await ctx.db
      .insert(campaigns)
      .values({ ...input, branchId: auth.branch.id, createdBy: auth.staff.id })
      .returning();
    return { ...row!, audienceSize: await audienceSize(ctx, auth.branch.id, input.audience) };
  });

  app.post('/api/v1/staff/campaigns/preview', async (req) => {
    const auth = await requireStaff(ctx, req, 'sms.send');
    const input = parse(campaignInput, req.body);
    return { audienceSize: await audienceSize(ctx, auth.branch.id, input.audience) };
  });

  app.post('/api/v1/staff/campaigns/:id/send', async (req) => {
    const auth = await requireStaff(ctx, req, 'sms.send');
    return sendCampaign(ctx, auth, parse(idParam, req.params).id);
  });

  app.get('/api/v1/staff/sms', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'sms.send');
    return ctx.db
      .select({
        id: smsOutbox.id,
        phone: smsOutbox.phone,
        template: smsOutbox.template,
        body: sql<string>`case when ${smsOutbox.template} = 'otp' then '••••' else ${smsOutbox.body} end`,
        status: smsOutbox.status,
        attempts: smsOutbox.attempts,
        lastError: smsOutbox.lastError,
        createdAt: smsOutbox.createdAt,
        sentAt: smsOutbox.sentAt,
      })
      .from(smsOutbox)
      .where(or(eq(smsOutbox.branchId, branch.id), isNull(smsOutbox.branchId)))
      .orderBy(desc(smsOutbox.createdAt))
      .limit(200);
  });

  // ─── Analytics ─────────────────────────────────────────────────────────────
  app.get('/api/v1/staff/analytics', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'analytics.view');
    const q = parse(
      z.object({
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
      }),
      req.query,
    );
    const to = q.to ? new Date(q.to) : ctx.now();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from >= to) throw badRequest('invalid_range', 'بازه زمانی معتبر نیست');
    return overview(ctx, branch.id, from, to);
  });

  app.get('/api/v1/staff/activity', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'orders.view');
    return recentActivity(ctx, branch.id);
  });

  // ─── Branch settings & stations ────────────────────────────────────────────
  app.get('/api/v1/staff/settings', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    const stationRows = await ctx.db
      .select()
      .from(stations)
      .where(eq(stations.branchId, branch.id))
      .orderBy(asc(stations.sort));
    return { branch, stations: stationRows, memberUrl: memberUrl(branch.slug, '/') };
  });

  app.put('/api/v1/staff/settings', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    const input = parse(branchSettingsInput, req.body);
    const [row] = await ctx.db
      .update(branches)
      .set({ ...input, openingHours: input.openingHours as typeof branch.openingHours })
      .where(eq(branches.id, branch.id))
      .returning();
    return row;
  });

  const saveStation = async (branchId: string, id: string | null, body: unknown) => {
    const input = parse(stationInput, body);
    return ctx.db.transaction(async (tx) => {
      if (input.isAcceptance) {
        await tx
          .update(stations)
          .set({ isAcceptance: false })
          .where(eq(stations.branchId, branchId));
      }
      if (id) {
        const [row] = await tx
          .update(stations)
          .set(input)
          .where(and(eq(stations.id, id), eq(stations.branchId, branchId)))
          .returning();
        if (!row) throw notFound('ایستگاه پیدا نشد');
        return row;
      }
      const [row] = await tx
        .insert(stations)
        .values({ ...input, branchId })
        .onConflictDoNothing()
        .returning();
      if (!row) throw conflict('duplicate', 'ایستگاهی با این کد وجود دارد');
      return row;
    });
  };

  app.post('/api/v1/staff/stations', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    return saveStation(branch.id, null, req.body);
  });

  app.put('/api/v1/staff/stations/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'settings.edit');
    return saveStation(branch.id, parse(idParam, req.params).id, req.body);
  });

  // ─── Staff accounts ────────────────────────────────────────────────────────
  app.get('/api/v1/staff/users', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'staff.manage');
    return ctx.db
      .select({
        id: staff.id,
        name: staff.name,
        username: staff.username,
        role: staff.role,
        isActive: staff.isActive,
        lastLoginAt: staff.lastLoginAt,
        branchId: staff.branchId,
      })
      .from(staff)
      .where(or(eq(staff.branchId, branch.id), isNull(staff.branchId)))
      .orderBy(asc(staff.name));
  });

  app.post('/api/v1/staff/users', async (req) => {
    const auth = await requireStaff(ctx, req, 'staff.manage');
    const input = parse(staffInput, req.body);
    if (!input.password) throw badRequest('password_required', 'رمز عبور را وارد کنید');
    if (input.role === 'owner' && auth.staff.role !== 'owner')
      throw forbidden('فقط مالک می‌تواند مالک جدید تعریف کند');
    const [row] = await ctx.db
      .insert(staff)
      .values({
        name: input.name,
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        isActive: input.isActive,
        branchId: input.role === 'owner' ? null : auth.branch.id,
      })
      .onConflictDoNothing()
      .returning({ id: staff.id });
    if (!row) throw conflict('duplicate', 'این نام کاربری گرفته شده است');
    return row;
  });

  app.put('/api/v1/staff/users/:id', async (req) => {
    const auth = await requireStaff(ctx, req, 'staff.manage');
    const input = parse(staffInput, req.body);
    const { id } = parse(idParam, req.params);
    const [target] = await ctx.db.select().from(staff).where(eq(staff.id, id));
    if (!target || (target.branchId !== auth.branch.id && auth.staff.role !== 'owner'))
      throw notFound('کاربر پیدا نشد');
    if ((input.role === 'owner' || target.role === 'owner') && auth.staff.role !== 'owner')
      throw forbidden();
    if (id === auth.staff.id && !input.isActive)
      throw badRequest('self_disable', 'نمی‌توانید حساب خودتان را غیرفعال کنید');
    await ctx.db
      .update(staff)
      .set({
        name: input.name,
        username: input.username,
        role: input.role,
        isActive: input.isActive,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      })
      .where(eq(staff.id, id));
    return { ok: true };
  });

  // ─── Branches (gyms) — owner only ──────────────────────────────────────────
  app.get('/api/v1/staff/branches', async (req) => {
    await requireStaff(ctx, req, 'branches.manage');
    return ctx.db
      .select({
        id: branches.id,
        slug: branches.slug,
        name: branches.name,
        gymName: branches.gymName,
        isActive: branches.isActive,
      })
      .from(branches);
  });

  app.post('/api/v1/staff/branches', async (req) => {
    await requireStaff(ctx, req, 'branches.manage');
    const input = parse(branchCreateInput, req.body);
    return ctx.db.transaction(async (tx) => {
      const [branch] = await tx
        .insert(branches)
        .values({ ...input, settings: DEFAULT_BRANCH_SETTINGS })
        .onConflictDoNothing()
        .returning();
      if (!branch) throw conflict('duplicate_slug', 'این زیردامنه قبلاً استفاده شده است');
      await tx.insert(stations).values([
        {
          branchId: branch.id,
          code: 'restaurant',
          name: 'رستوران',
          isAcceptance: true,
          defaultPrepMinutes: 15,
          sort: 0,
        },
        {
          branchId: branch.id,
          code: 'cafe',
          name: 'کافه',
          isAcceptance: false,
          defaultPrepMinutes: 5,
          sort: 1,
        },
      ]);
      return { ...branch, memberUrl: memberUrl(branch.slug, '/') };
    });
  });
}
