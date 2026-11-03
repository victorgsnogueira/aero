import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import { campaignContacts, campaigns, conversations, webhookEvents } from '../../db/schema.ts';
import { setParticipationStatus, scheduleEligible } from '../campaigns/service.ts';
import { enqueue } from '../../core/outbox.ts';

export async function closeNoReply(ctx: AppContext): Promise<number> {
  const rows = await ctx.db
    .select({ cc: campaignContacts, hours: campaigns.noReplyCloseHours })
    .from(campaignContacts)
    .innerJoin(campaigns, eq(campaigns.id, campaignContacts.campaignId))
    .where(and(eq(campaignContacts.status, 'awaiting_reply'), isNull(campaignContacts.repliedAt), sql`${campaignContacts.firstSentAt} IS NOT NULL`))
    .limit(500);
  let closed = 0;
  for (const { cc, hours } of rows) {
    if (!cc.firstSentAt || ctx.now().getTime() - cc.firstSentAt.getTime() < hours * 3600_000) continue;
    await ctx.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(campaignContacts).where(eq(campaignContacts.id, cc.id)).for('update');
      if (!fresh || fresh.status !== 'awaiting_reply') return;
      await setParticipationStatus(tx, fresh, 'closed_no_reply', 'system', `Sem resposta em ${hours}h`, { closedAt: ctx.now() });
      await tx
        .update(conversations)
        .set({ state: 'closed' })
        .where(and(eq(conversations.activeCampaignContactId, cc.id), eq(conversations.state, 'awaiting_reply'), eq(conversations.automationPaused, false)));
    });
    closed++;
  }
  return closed;
}

export async function schedulePendingForActiveCampaigns(ctx: AppContext): Promise<number> {
  const active = await ctx.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'active'), sql`EXISTS (SELECT 1 FROM campaign_contacts cc WHERE cc.campaign_id = ${campaigns.id} AND cc.status = 'selected')`));
  let total = 0;
  for (const c of active) total += (await scheduleEligible(ctx, c.id)).scheduled;
  return total;
}

export async function requeueUnprocessedWebhooks(ctx: AppContext): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - 2 * 60_000);
  const rows = await ctx.db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.receivedAt, cutoff), lt(webhookEvents.attempts, 10)))
    .limit(200);
  if (!rows.length) return 0;
  await ctx.db.transaction(async (tx) => {
    for (const r of rows) await enqueue(tx, 'inbound.process', { webhookEventId: r.id }, { dedupeKey: `wh:${r.id}` });
  });
  return rows.length;
}

