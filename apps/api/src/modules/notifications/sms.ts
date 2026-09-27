import { and, eq, lte, sql } from 'drizzle-orm';
import type { SmsTemplate } from '@prochia/shared';
import { formatJalali, formatTime, toFaDigits } from '@prochia/shared';
import type { AppContext } from '../../context';
import type { Executor } from '../../db/client';
import { smsOutbox } from '../../db/schema';

/** Message bodies. Kept short: one Persian SMS segment is 70 characters. */
export const smsText = {
  otp: (code: string) => `کد ورود پروچیا: ${toFaDigits(code)}\nاین کد را به کسی ندهید.`,
  orderAccepted: (number: number, pickupAt: Date) =>
    `پیش‌سفارش ${toFaDigits(number)} تأیید شد. ساعت ${formatTime(pickupAt)} آماده تحویل است.\nپروچیا`,
  orderReady: (number: number, where: string) =>
    `سفارش ${toFaDigits(number)} آماده است — ${where}.\nنوش جان! پروچیا`,
  orderRejected: (number: number, reason: string, refunded: boolean) =>
    `سفارش ${toFaDigits(number)} انجام نشد: ${reason}.${refunded ? '\nمبلغ به کیف پول شما برگشت.' : ''}\nپروچیا`,
  birthday: (name: string, code: string, title: string, until: Date) =>
    `${name} عزیز، تولدت مبارک!\nهدیه پروچیا: ${title} با کد ${code} تا ${formatJalali(until, 'dayMonth')}.`,
  planExpiring: (planName: string, remaining: number, expiresOn: Date) =>
    `${toFaDigits(remaining)} وعده از «${planName}» باقی مانده و ${formatJalali(expiresOn, 'dayMonth')} منقضی می‌شود.\nپروچیا`,
  lowCredits: (planName: string, remaining: number) =>
    `فقط ${toFaDigits(remaining)} وعده از «${planName}» باقی مانده. برای تمدید با تخفیف به اپ سر بزنید.\nپروچیا`,
  paymentReviewed: (approved: boolean, amountText: string) =>
    approved
      ? `پرداخت کارت‌به‌کارت ${amountText} تأیید شد.\nپروچیا`
      : `پرداخت کارت‌به‌کارت ${amountText} تأیید نشد. لطفاً با صندوق تماس بگیرید.\nپروچیا`,
  /** Advertising messages must carry the opt-out keyword under Iranian telecom rules. */
  campaign: (body: string) => `${body}\nلغو۱۱`,
};

export async function queueSms(
  db: Executor,
  msg: {
    branchId: string | null;
    phone: string;
    template: SmsTemplate;
    body: string;
    tokens?: Record<string, string>;
    campaignId?: string;
    sendAfter?: Date;
  },
) {
  await db.insert(smsOutbox).values({
    branchId: msg.branchId,
    phone: msg.phone,
    template: msg.template,
    body: msg.body,
    tokens: msg.tokens ?? null,
    campaignId: msg.campaignId ?? null,
    sendAfter: msg.sendAfter ?? sql`now()`,
  });
}

const MAX_ATTEMPTS = 5;

/**
 * Sends queued messages. Rows are claimed with SKIP LOCKED so overlapping runs never double-send;
 * failures back off exponentially (1, 2, 4, 8 minutes) before giving up. Timing uses the
 * database clock, the same one that stamps `send_after` when messages are queued.
 */
export async function drainSmsOutbox(ctx: AppContext, batchSize = 25): Promise<number> {
  const claimed = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(smsOutbox)
      .where(and(eq(smsOutbox.status, 'queued'), lte(smsOutbox.sendAfter, sql`now()`)))
      .orderBy(smsOutbox.sendAfter)
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (rows.length) {
      // Push the claim forward so a crash mid-send is retried later rather than immediately.
      await tx
        .update(smsOutbox)
        .set({
          sendAfter: sql`now() + interval '5 minutes'`,
          attempts: sql`${smsOutbox.attempts} + 1`,
        })
        .where(sql`${smsOutbox.id} in ${rows.map((r) => r.id)}`);
    }
    return rows;
  });

  for (const row of claimed) {
    try {
      const { messageId } =
        row.template === 'otp' && row.tokens?.code
          ? await ctx.sms.sendOtp(row.phone, row.tokens.code, row.body)
          : await ctx.sms.send(row.phone, row.body);
      await ctx.db
        .update(smsOutbox)
        .set({
          status: 'sent',
          sentAt: sql`now()`,
          provider: ctx.sms.name,
          providerMessageId: messageId,
        })
        .where(eq(smsOutbox.id, row.id));
    } catch (err) {
      const attempts = row.attempts + 1;
      await ctx.db
        .update(smsOutbox)
        .set({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          lastError: String(err instanceof Error ? err.message : err).slice(0, 500),
          sendAfter: sql`now() + make_interval(mins => ${2 ** (attempts - 1)})`,
        })
        .where(eq(smsOutbox.id, row.id));
    }
  }
  return claimed.length;
}
