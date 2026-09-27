import type { FastifyInstance } from 'fastify';
import { otpRequestInput, otpVerifyInput, staffLoginInput } from '@prochia/shared';
import type { AppContext } from '../context';
import {
  MEMBER_COOKIE,
  getMember,
  requireBranch,
  requireStaff,
  setMemberCookie,
} from '../lib/auth';
import { parse } from '../lib/validate';
import { requestOtp, revokeSession, staffLogin, verifyOtp } from '../modules/auth/service';

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post(
    '/api/v1/auth/otp',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const { phone } = parse(otpRequestInput, req.body);
      await requireBranch(ctx, req);
      return requestOtp(ctx, phone, req.ip);
    },
  );

  app.post(
    '/api/v1/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { phone, code } = parse(otpVerifyInput, req.body);
      const branch = await requireBranch(ctx, req);
      const result = await verifyOtp(ctx, {
        phone,
        code,
        branch,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setMemberCookie(ctx, reply, result.token, result.expiresAt);
      if (result.isNewMember && result.membership.status === 'pending') {
        ctx.bus.publish(branch.id, { type: 'member.pending', membershipId: result.membership.id });
      }
      return {
        token: result.token,
        membershipStatus: result.membership.status,
        isNewMember: result.isNewMember,
        needsOnboarding: !result.user.firstName,
      };
    },
  );

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const auth = await getMember(ctx, req);
    if (auth) await revokeSession(ctx, auth.sessionId);
    reply.clearCookie(MEMBER_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post(
    '/api/v1/staff/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req) => {
      const input = parse(staffLoginInput, req.body);
      const { token, expiresAt, staff } = await staffLogin(ctx, {
        ...input,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return {
        token,
        expiresAt,
        staff: { id: staff.id, name: staff.name, role: staff.role, branchId: staff.branchId },
      };
    },
  );

  app.post('/api/v1/staff/auth/logout', async (req) => {
    const auth = await requireStaff(ctx, req);
    await revokeSession(ctx, auth.sessionId);
    return { ok: true };
  });
}
