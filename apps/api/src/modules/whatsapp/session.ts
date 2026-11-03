import { eq } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import type { DbOrTx } from '../../db/client.ts';
import { waSessions } from '../../db/schema.ts';
import { WEBHOOK_EVENTS } from '../../integrations/wa/client.ts';
import { precondition } from '../../core/errors.ts';
import type { WaSessionStatus } from '@aero/shared';

export type WaSessionRow = typeof waSessions.$inferSelect;

export const getSessionKey = (ctx: AppContext) => ctx.config.gateway.sessionId;

export async function ensureSessionRow(db: DbOrTx, sessionKey: string): Promise<WaSessionRow> {
  const [row] = await db.select().from(waSessions).where(eq(waSessions.sessionKey, sessionKey));
  if (row) return row;
  await db.insert(waSessions).values({ sessionKey, label: 'Meu WhatsApp' }).onDuplicateKeyUpdate({ set: { label: 'Meu WhatsApp' } });
  const [created] = await db.select().from(waSessions).where(eq(waSessions.sessionKey, sessionKey));
  return created!;
}

export async function syncSessionStatus(ctx: AppContext): Promise<WaSessionRow> {
  const key = getSessionKey(ctx);
  const row = await ensureSessionRow(ctx.db, key);
  let status: WaSessionStatus = 'unknown';
  let ownJid: string | null = row.ownJid;
  let lastError: string | null = null;
  try {
    const info = await ctx.wa.getSession(key);
    status = info.status;
    ownJid = info.ownJid ?? ownJid;
  } catch (err) {
    status = 'gateway_unreachable';
    lastError = (err as Error).message.slice(0, 500);
  }
  await ctx.db.update(waSessions).set({ status, ownJid, lastError, lastEventAt: ctx.now() }).where(eq(waSessions.id, row.id));
  if (status !== row.status) await ctx.events.publish({ type: 'wa.session', status });
  return { ...row, status, ownJid, lastError };
}

export async function provisionSession(ctx: AppContext): Promise<WaSessionRow> {
  const key = getSessionKey(ctx);
  if (!ctx.config.gateway.apiKey) throw precondition('gateway_not_configured', 'WA_GATEWAY_API_KEY não configurada');
  if (!ctx.config.gateway.webhookSecret) throw precondition('webhook_secret_missing', 'WA_WEBHOOK_SECRET não configurado');
  const info = await ctx.wa.getSession(key);
  if (info.status === 'gateway_unreachable') throw precondition('gateway_unreachable', 'Gateway WhatsApp indisponível');
  if (!info.exists) await ctx.wa.createSession(key, 'aero');
  await ctx.wa.disableBuiltInBot(key).catch((err: Error) => ctx.log.warn({ err: err.message }, 'Não foi possível desativar o bot embutido'));
  await ctx.wa.upsertWebhook(key, { url: ctx.config.gateway.webhookUrl, secret: ctx.config.gateway.webhookSecret, events: WEBHOOK_EVENTS });
  const row = await ensureSessionRow(ctx.db, key);
  await ctx.db.update(waSessions).set({ webhookRegisteredAt: ctx.now() }).where(eq(waSessions.id, row.id));
  return syncSessionStatus(ctx);
}
