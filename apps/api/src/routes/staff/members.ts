import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  MEMBERSHIP_STATUSES,
  can,
  memberUpdateInput,
  walletAdjustInput,
  whitelistImportInput,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import { memberWhitelist } from '../../db/schema';
import { requireStaff } from '../../lib/auth';
import { forbidden } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  adjustWallet,
  importWhitelist,
  listMembers,
  memberDetail,
  settlePostpaidAtCounter,
  updateMember,
} from '../../modules/members/staff';

const idParam = z.object({ id: z.uuid() });

export function staffMemberRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/staff/members', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    const q = parse(
      z.object({
        q: z.string().max(60).optional(),
        status: z.enum(MEMBERSHIP_STATUSES).optional(),
        vip: z.enum(['1', 'true']).optional(),
        limit: z.coerce.number().int().optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    return listMembers(ctx, branch.id, { ...q, vip: Boolean(q.vip) });
  });

  app.get('/api/v1/staff/members/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    return memberDetail(ctx, branch.id, parse(idParam, req.params).id);
  });

  app.patch('/api/v1/staff/members/:id', async (req) => {
    const auth = await requireStaff(ctx, req, 'members.edit');
    const patch = parse(memberUpdateInput, req.body);
    const financial =
      patch.isVip !== undefined ||
      patch.creditLimit !== undefined ||
      patch.personalDiscountPct !== undefined;
    if (financial && !can(auth.staff.role, 'members.finance'))
      throw forbidden('تغییر VIP، اعتبار و تخفیف فقط با مدیر است');
    return updateMember(ctx, auth, parse(idParam, req.params).id, patch);
  });

  app.post('/api/v1/staff/members/:id/wallet', async (req) => {
    const auth = await requireStaff(ctx, req, 'members.edit');
    const input = parse(walletAdjustInput, req.body);
    if (input.kind === 'adjustment' && !can(auth.staff.role, 'members.finance'))
      throw forbidden('اصلاح کیف پول فقط با مدیر است');
    await adjustWallet(ctx, auth, parse(idParam, req.params).id, input);
    return { ok: true };
  });

  app.post('/api/v1/staff/members/:id/settle-postpaid', async (req) => {
    const auth = await requireStaff(ctx, req, 'members.edit');
    return settlePostpaidAtCounter(ctx, auth, parse(idParam, req.params).id);
  });

  app.get('/api/v1/staff/whitelist', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.view');
    return ctx.db
      .select()
      .from(memberWhitelist)
      .where(eq(memberWhitelist.branchId, branch.id))
      .orderBy(desc(memberWhitelist.createdAt));
  });

  app.post('/api/v1/staff/whitelist', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'members.edit');
    return importWhitelist(ctx, branch.id, parse(whitelistImportInput, req.body).entries);
  });
}
