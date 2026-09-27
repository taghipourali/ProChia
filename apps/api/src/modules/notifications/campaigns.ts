import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { campaigns, healthProfiles, memberships, orders, users } from '../../db/schema';
import type { CampaignAudience } from '../../db/schema/messaging';
import type { StaffAuth } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { queueSms, smsText } from './sms';

function audienceConditions(branchId: string, audience: CampaignAudience): SQL[] {
  const conditions: SQL[] = [eq(memberships.branchId, branchId), eq(memberships.status, 'active')];
  if (audience.vipOnly) conditions.push(eq(memberships.isVip, true));
  if (audience.tierId) conditions.push(eq(memberships.tierId, audience.tierId));
  if (audience.goal) conditions.push(sql`${healthProfiles.goal} = ${audience.goal}`);
  if (audience.inactiveDays) {
    conditions.push(sql`not exists (
      select 1 from ${orders} o where o.membership_id = ${memberships.id}
      and o.created_at > now() - make_interval(days => ${audience.inactiveDays})
    )`);
  }
  return conditions;
}

export async function audienceSize(ctx: AppContext, branchId: string, audience: CampaignAudience) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(healthProfiles, eq(healthProfiles.userId, users.id))
    .where(and(...audienceConditions(branchId, audience)));
  return row?.n ?? 0;
}

/** Queues the campaign for every member in the audience; the outbox sends them in the background. */
export async function sendCampaign(ctx: AppContext, auth: StaffAuth, campaignId: string) {
  return ctx.db.transaction(async (tx) => {
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.branchId, auth.branch.id)))
      .for('update');
    if (!campaign) throw notFound('کمپین پیدا نشد');
    if (campaign.status === 'sent') throw conflict('already_sent', 'این کمپین قبلاً ارسال شده است');

    const recipients = await tx
      .select({ phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(healthProfiles, eq(healthProfiles.userId, users.id))
      .where(and(...audienceConditions(auth.branch.id, campaign.audience)));

    for (const r of recipients) {
      await queueSms(tx, {
        branchId: auth.branch.id,
        phone: r.phone,
        template: 'campaign',
        body: smsText.campaign(campaign.body),
        campaignId: campaign.id,
      });
    }
    await tx
      .update(campaigns)
      .set({ status: 'sent', recipients: recipients.length, sentAt: ctx.now() })
      .where(eq(campaigns.id, campaign.id));
    return { recipients: recipients.length };
  });
}
