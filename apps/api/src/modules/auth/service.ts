import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { memberships, memberWhitelist, otpCodes, sessions, staff, users } from '../../db/schema';
import type { Branch } from '../../lib/auth';
import {
  hashPassword,
  newToken,
  otpCode,
  safeEqual,
  sha256,
  verifyPassword,
} from '../../lib/crypto';
import { AppError, badRequest, unauthorized } from '../../lib/errors';
import { queueSms, smsText } from '../notifications/sms';

const OTP_TTL_MS = 3 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const MEMBER_SESSION_DAYS = 60;
const STAFF_SESSION_HOURS = 16;

let dummyHash: Promise<string> | undefined;

function otpHash(ctx: AppContext, phone: string, code: string) {
  return sha256(`${ctx.config.APP_SECRET}:${phone}:${code}`);
}

export async function requestOtp(ctx: AppContext, phone: string, ip: string | undefined) {
  const now = ctx.now();
  const recent = await ctx.db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(
      and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, new Date(now.getTime() - 3_600_000))),
    )
    .orderBy(desc(otpCodes.createdAt));

  const last = recent[0];
  if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
    throw new AppError(429, 'otp_wait', `برای ارسال دوباره ${wait} ثانیه صبر کنید`, {
      retryAfter: wait,
    });
  }
  if (recent.length >= OTP_MAX_PER_HOUR) {
    throw new AppError(429, 'otp_limit', 'تعداد درخواست کد زیاد بوده؛ کمی بعد دوباره تلاش کنید');
  }

  const code = otpCode();
  await ctx.db.insert(otpCodes).values({
    phone,
    codeHash: otpHash(ctx, phone, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    ip: ip ?? null,
    createdAt: now,
  });
  await queueSms(ctx.db, {
    branchId: null,
    phone,
    template: 'otp',
    body: smsText.otp(code),
    tokens: { code },
  });

  return {
    expiresIn: OTP_TTL_MS / 1000,
    resendIn: OTP_RESEND_MS / 1000,
    ...(ctx.config.DEV_ECHO_OTP ? { devCode: code } : {}),
  };
}

/**
 * Verifies the code, creates the user on first login, and joins them to the branch according to
 * its approval policy. Returns a fresh session token.
 */
export async function verifyOtp(
  ctx: AppContext,
  input: { phone: string; code: string; branch: Branch; ip?: string; userAgent?: string },
) {
  const now = ctx.now();
  const [otp] = await ctx.db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phone, input.phone),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otp) throw badRequest('otp_expired', 'کد منقضی شده؛ دوباره درخواست کنید');
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw badRequest('otp_locked', 'تعداد تلاش زیاد بود؛ کد جدید بگیرید');

  if (!safeEqual(otp.codeHash, otpHash(ctx, input.phone, input.code))) {
    await ctx.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, otp.id));
    throw badRequest('otp_invalid', 'کد واردشده درست نیست');
  }

  return ctx.db.transaction(async (tx) => {
    await tx.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, otp.id));

    const [user] = await tx
      .insert(users)
      .values({ phone: input.phone })
      .onConflictDoUpdate({ target: users.phone, set: { lastSeenAt: now } })
      .returning();

    let [membership] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user!.id), eq(memberships.branchId, input.branch.id)))
      .limit(1);

    let isNewMember = false;
    if (!membership) {
      const [listed] = await tx
        .select()
        .from(memberWhitelist)
        .where(
          and(
            eq(memberWhitelist.branchId, input.branch.id),
            eq(memberWhitelist.phone, input.phone),
          ),
        )
        .limit(1);
      const approved = input.branch.settings.memberApproval === 'auto' || Boolean(listed);
      [membership] = await tx
        .insert(memberships)
        .values({
          branchId: input.branch.id,
          userId: user!.id,
          status: approved ? 'active' : 'pending',
          gymMemberCode: listed?.gymMemberCode ?? null,
          approvedAt: approved ? now : null,
        })
        .returning();
      isNewMember = true;
    }

    const token = newToken();
    const expiresAt = new Date(now.getTime() + MEMBER_SESSION_DAYS * 86_400_000);
    await tx.insert(sessions).values({
      tokenHash: sha256(token),
      kind: 'member',
      userId: user!.id,
      branchId: input.branch.id,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    });

    return { token, expiresAt, user: user!, membership: membership!, isNewMember };
  });
}

export async function staffLogin(
  ctx: AppContext,
  input: { username: string; password: string; ip?: string; userAgent?: string },
) {
  const [member] = await ctx.db
    .select()
    .from(staff)
    .where(eq(staff.username, input.username.trim().toLowerCase()))
    .limit(1);
  // Verify even for unknown users so response time does not reveal which usernames exist.
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(input.password, member?.passwordHash ?? (await dummyHash));
  if (!member || !ok || !member.isActive) throw unauthorized('نام کاربری یا رمز عبور درست نیست');

  const now = ctx.now();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_HOURS * 3_600_000);
  await ctx.db.insert(sessions).values({
    tokenHash: sha256(token),
    kind: 'staff',
    staffId: member.id,
    branchId: member.branchId,
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  await ctx.db.update(staff).set({ lastLoginAt: now }).where(eq(staff.id, member.id));
  return { token, expiresAt, staff: member };
}

export async function revokeSession(ctx: AppContext, sessionId: string) {
  await ctx.db.delete(sessions).where(eq(sessions.id, sessionId));
}
