import { and, asc, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import { campaigns, messages } from '../../db/schema.ts';
import { getSettings } from '../settings/service.ts';
import { isWithinWindow, startOfLocalDay } from '../../lib/schedule.ts';
import { sendMessage } from './sender.ts';
import { syncSessionStatus } from '../whatsapp/session.ts';

const SENT_STATUSES = ['accepted', 'delivered', 'read', 'unknown', 'processing'] as const;
const REPLY_MIN_INTERVAL_MS = 5_000;

export interface DispatchResult {
  sent: number;
  reason: string;
  nextInMs: number;
}

async function outboundCountSince(ctx: AppContext, since: Date): Promise<number> {
  const [r] = await ctx.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(messages)
    .where(and(eq(messages.direction, 'out'), ne(messages.origin, 'phone'), inArray(messages.status, [...SENT_STATUSES]), isNotNull(messages.sentAt), sql`${messages.sentAt} >= ${since}`));
  return Number(r?.n ?? 0);
}

async function lastOutboundAt(ctx: AppContext): Promise<Date | null> {
  const [r] = await ctx.db
    .select({ at: sql<Date | null>`MAX(${messages.sentAt})` })
    .from(messages)
    .where(and(eq(messages.direction, 'out'), ne(messages.origin, 'phone'), inArray(messages.status, [...SENT_STATUSES])));
  return r?.at ? new Date(r.at) : null;
}

export async function dispatchTick(ctx: AppContext): Promise<DispatchResult> {
  if (!ctx.config.sending.enabled) return { sent: 0, reason: 'Envio desabilitado', nextInMs: 60_000 };
  const settings = await getSettings(ctx.db);
  const now = ctx.now();

  const session = await syncSessionStatus(ctx);
  if (session.status !== 'connected') return { sent: 0, reason: `Sessão ${session.status}`, nextInMs: 60_000 };

  const last = await lastOutboundAt(ctx);
  const sinceLast = last ? now.getTime() - last.getTime() : Infinity;

  const [reply] = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.status, 'scheduled'), eq(messages.origin, 'automatic'), ne(messages.purpose, 'first_contact'), lte(messages.scheduledFor, now)))
    .orderBy(asc(messages.scheduledFor), asc(messages.id))
    .limit(1);
  if (reply) {
    if (sinceLast < REPLY_MIN_INTERVAL_MS) return { sent: 0, reason: 'Intervalo mínimo entre respostas', nextInMs: REPLY_MIN_INTERVAL_MS - sinceLast };
    const out = await sendMessage(ctx, reply.id);
    return { sent: out.kind === 'accepted' ? 1 : 0, reason: `Resposta: ${out.kind}`, nextInMs: 1_000 };
  }

  const minIntervalMs = settings.sendMinIntervalSeconds * 1000;
  if (sinceLast < minIntervalMs) return { sent: 0, reason: 'Intervalo mínimo global', nextInMs: minIntervalMs - sinceLast };
  const hourCount = await outboundCountSince(ctx, new Date(now.getTime() - 3600_000));
  if (hourCount >= settings.sendHourlyLimit) return { sent: 0, reason: 'Limite por hora da sessão', nextInMs: 5 * 60_000 };
  const dayCount = await outboundCountSince(ctx, startOfLocalDay(now, settings.defaultTimezone));
  if (dayCount >= settings.sendDailyLimit) return { sent: 0, reason: 'Limite diário da sessão', nextInMs: 15 * 60_000 };

  const active = await ctx.db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'active'),
        sql`EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = ${campaigns.id} AND m.status = 'scheduled' AND m.purpose = 'first_contact' AND m.scheduled_for <= ${now})`,
      ),
    )
    .orderBy(sql`${campaigns.lastDispatchAt} IS NOT NULL`, asc(campaigns.lastDispatchAt), asc(campaigns.id));

  for (const c of active) {
    const window = { timezone: c.timezone, days: c.sendDays, start: c.sendWindowStart, end: c.sendWindowEnd };
    if (!isWithinWindow(now, window)) continue;
    const [daily] = await ctx.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.campaignId, c.id),
          eq(messages.purpose, 'first_contact'),
          inArray(messages.status, [...SENT_STATUSES]),
          sql`${messages.sentAt} >= ${startOfLocalDay(now, c.timezone)}`,
        ),
      );
    if (Number(daily?.n ?? 0) >= c.dailyLimit) continue;
    const [next] = await ctx.db
      .select()
      .from(messages)
      .where(and(eq(messages.campaignId, c.id), eq(messages.status, 'scheduled'), eq(messages.purpose, 'first_contact'), lte(messages.scheduledFor, now)))
      .orderBy(asc(messages.scheduledFor), asc(messages.id))
      .limit(1);
    if (!next) continue;

    await ctx.db.update(campaigns).set({ lastDispatchAt: now }).where(eq(campaigns.id, c.id));
    const out = await sendMessage(ctx, next.id);
    return { sent: out.kind === 'accepted' ? 1 : 0, reason: `Campanha ${c.id}: ${out.kind}`, nextInMs: out.kind === 'accepted' ? minIntervalMs : 1_000 };
  }
  return { sent: 0, reason: active.length ? 'Fora da janela ou limite das campanhas' : 'Nada pendente', nextInMs: 60_000 };
}
