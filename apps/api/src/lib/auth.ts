import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { can, type Permission } from '@prochia/shared';
import type { AppContext } from '../context';
import { branches, memberships, sessions, staff, users } from '../db/schema';
import { sha256 } from './crypto';
import { AppError, forbidden, notFound, unauthorized } from './errors';

export type Branch = typeof branches.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type StaffMember = typeof staff.$inferSelect;

export const MEMBER_COOKIE = 'pc_session';

const branchCache = new WeakMap<FastifyRequest, Promise<Branch | null>>();

/**
 * The branch a request is for: `X-Branch` header (or `?branch=`), then the subdomain of the Host,
 * then the configured default (local development without subdomains).
 */
export function resolveBranch(ctx: AppContext, req: FastifyRequest): Promise<Branch | null> {
  let cached = branchCache.get(req);
  if (!cached) {
    cached = (async () => {
      const slug = branchSlugFromRequest(ctx, req);
      if (!slug) return null;
      const [row] = await ctx.db.select().from(branches).where(eq(branches.slug, slug)).limit(1);
      return row && row.isActive ? row : null;
    })();
    branchCache.set(req, cached);
  }
  return cached;
}

function branchSlugFromRequest(ctx: AppContext, req: FastifyRequest): string | undefined {
  const header = req.headers['x-branch'];
  if (typeof header === 'string' && header) return header.toLowerCase();
  // EventSource cannot send headers, so streams may name the branch in the query string.
  const query = (req.query as Record<string, unknown> | undefined)?.branch;
  if (typeof query === 'string' && query) return query.toLowerCase();
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
  const hostname = host.split(':')[0]!.toLowerCase();
  const suffix = `.${ctx.config.ROOT_DOMAIN}`;
  if (hostname.endsWith(suffix)) {
    const sub = hostname.slice(0, -suffix.length);
    if (sub && !sub.includes('.') && !['www', 'api', 'panel'].includes(sub)) return sub;
  }
  return ctx.config.DEFAULT_BRANCH;
}

export async function requireBranch(ctx: AppContext, req: FastifyRequest): Promise<Branch> {
  const branch = await resolveBranch(ctx, req);
  if (!branch) throw notFound('این باشگاه در پروچیا ثبت نشده است');
  return branch;
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

async function findSession(ctx: AppContext, token: string | undefined, kind: 'member' | 'staff') {
  if (!token) return null;
  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        eq(sessions.kind, kind),
        gt(sessions.expiresAt, ctx.now()),
      ),
    )
    .limit(1);
  return session ?? null;
}

export interface MemberAuth {
  sessionId: string;
  user: User;
  branch: Branch;
  /** Null if the user has an account but has not joined this branch yet. */
  membership: Membership | null;
}

const memberCache = new WeakMap<FastifyRequest, Promise<MemberAuth | null>>();

export function getMember(ctx: AppContext, req: FastifyRequest): Promise<MemberAuth | null> {
  let cached = memberCache.get(req);
  if (!cached) {
    cached = (async () => {
      const token = req.cookies[MEMBER_COOKIE] ?? bearer(req);
      const session = await findSession(ctx, token, 'member');
      if (!session?.userId) return null;
      const branch = await resolveBranch(ctx, req);
      if (!branch) return null;
      const [user] = await ctx.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (!user) return null;
      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.branchId, branch.id)))
        .limit(1);
      return { sessionId: session.id, user, branch, membership: membership ?? null };
    })();
    memberCache.set(req, cached);
  }
  return cached;
}

export async function requireMember(ctx: AppContext, req: FastifyRequest): Promise<MemberAuth> {
  const auth = await getMember(ctx, req);
  if (!auth) throw unauthorized();
  return auth;
}

/** A member whose gym membership has been approved — required for anything involving money or orders. */
export async function requireActiveMember(ctx: AppContext, req: FastifyRequest) {
  const auth = await requireMember(ctx, req);
  if (!auth.membership) throw forbidden('ابتدا عضو این باشگاه شوید');
  if (auth.membership.status === 'pending') {
    throw new AppError(403, 'membership_pending', 'عضویت شما در انتظار تأیید پذیرش باشگاه است');
  }
  if (auth.membership.status === 'suspended') {
    throw new AppError(403, 'membership_suspended', 'حساب شما در این باشگاه غیرفعال شده است');
  }
  return { ...auth, membership: auth.membership };
}

export interface StaffAuth {
  sessionId: string;
  staff: StaffMember;
  branch: Branch;
}

/**
 * Staff requests act on the staff member's own branch. Owners have no fixed branch and pick
 * one per request with `X-Branch`.
 */
export async function requireStaff(
  ctx: AppContext,
  req: FastifyRequest,
  permission?: Permission,
): Promise<StaffAuth> {
  const session = await findSession(ctx, bearer(req), 'staff');
  if (!session?.staffId) throw unauthorized('نشست شما منقضی شده؛ دوباره وارد شوید');
  const [member] = await ctx.db.select().from(staff).where(eq(staff.id, session.staffId)).limit(1);
  if (!member?.isActive) throw unauthorized('حساب کاربری غیرفعال است');
  if (permission && !can(member.role, permission)) throw forbidden();

  let branch: Branch | undefined;
  if (member.branchId) {
    [branch] = await ctx.db
      .select()
      .from(branches)
      .where(eq(branches.id, member.branchId))
      .limit(1);
  } else {
    const slug = req.headers['x-branch'];
    if (typeof slug === 'string') {
      [branch] = await ctx.db.select().from(branches).where(eq(branches.slug, slug)).limit(1);
    } else {
      [branch] = await ctx.db.select().from(branches).orderBy(branches.createdAt).limit(1);
    }
  }
  if (!branch) throw notFound('شعبه پیدا نشد');
  return { sessionId: session.id, staff: member, branch };
}

export function setMemberCookie(
  ctx: AppContext,
  reply: FastifyReply,
  token: string,
  expires: Date,
) {
  reply.setCookie(MEMBER_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.COOKIE_SECURE,
    expires,
  });
}
