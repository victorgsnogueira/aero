import { eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import { phones } from '../../db/schema.ts';
import { getSettings } from '../settings/service.ts';
import { HttpError } from '../../lib/http.ts';
import { getSessionKey } from '../whatsapp/session.ts';
import type { WaStatus } from '@aero/shared';

// Validação de existência de conta WhatsApp pelo WA-AKG.
// Regras:
//  - Somente números com formato válido (E.164) são consultados.
//  - Falha de rede, timeout, sessão indisponível ou erro do gateway => "inconclusivo",
//    nunca "não encontrado".
//  - Resultados conclusivos recentes (dentro do prazo de revalidação) são reutilizados.
//  - Existência de conta NÃO comprova identidade da empresa nem entrega de mensagem.

export type ValidationScope =
  | { kind: 'scan'; scanId: number }
  | { kind: 'campaign'; campaignId: number }
  | { kind: 'phones'; phoneIds: number[] }
  | { kind: 'stale' };

export interface ValidationRunResult {
  checked: number;
  found: number;
  notFound: number;
  inconclusive: number;
  remaining: number;
  stoppedReason: string | null;
}

/** Fila de candidatos à validação para um escopo, em ordem estável. */
const INCONCLUSIVE_RETRY_MS = 15 * 60_000;

async function candidates(ctx: AppContext, scope: ValidationScope, revalidateBefore: Date, limit: number): Promise<{ id: number; e164: string }[]> {
  const retryBefore = new Date(ctx.now().getTime() - INCONCLUSIVE_RETRY_MS);
  const needs = sql`(p.wa_status = 'pending'
    OR (p.wa_status = 'inconclusive' AND (p.wa_checked_at IS NULL OR p.wa_checked_at < ${retryBefore}))
    OR (p.wa_status IN ('found','not_found') AND (p.wa_checked_at IS NULL OR p.wa_checked_at < ${revalidateBefore})))`;
  let rows: unknown;
  switch (scope.kind) {
    case 'scan':
      rows = await ctx.db.execute(sql`
        SELECT p.id, p.e164 FROM scan_results sr
        JOIN company_phones cp ON cp.company_id = sr.company_id
        JOIN phones p ON p.id = cp.phone_id
        WHERE sr.scan_id = ${scope.scanId} AND sr.is_surplus = 0 AND p.format_status = 'valid' AND p.e164 IS NOT NULL AND ${needs}
        GROUP BY p.id, p.e164 ORDER BY MIN(sr.id) LIMIT ${limit}`);
      break;
    case 'campaign':
      rows = await ctx.db.execute(sql`
        SELECT p.id, p.e164 FROM campaign_contacts cc JOIN phones p ON p.id = cc.phone_id
        WHERE cc.campaign_id = ${scope.campaignId} AND cc.status = 'selected' AND p.format_status = 'valid' AND p.e164 IS NOT NULL AND ${needs}
        ORDER BY cc.id LIMIT ${limit}`);
      break;
    case 'phones':
      if (scope.phoneIds.length === 0) return [];
      rows = await ctx.db.execute(sql`
        SELECT p.id, p.e164 FROM phones p
        WHERE p.id IN (${sql.join(scope.phoneIds.map((i) => sql`${i}`), sql`,`)}) AND p.format_status = 'valid' AND p.e164 IS NOT NULL
        ORDER BY p.id LIMIT ${limit}`);
      break;
    case 'stale':
      rows = await ctx.db.execute(sql`
        SELECT p.id, p.e164 FROM phones p
        WHERE p.format_status = 'valid' AND p.e164 IS NOT NULL AND p.wa_status IN ('found','not_found') AND p.wa_checked_at < ${revalidateBefore}
        ORDER BY p.wa_checked_at LIMIT ${limit}`);
      break;
  }
  return ((rows as unknown[])[0] as { id: number; e164: string }[]).map((r) => ({ id: Number(r.id), e164: r.e164 }));
}

async function markInconclusive(ctx: AppContext, ids: number[], error: string): Promise<void> {
  if (!ids.length) return;
  await ctx.db
    .update(phones)
    .set({ waStatus: 'inconclusive', waError: error.slice(0, 255), waCheckedAt: ctx.now(), waAttempts: sql`${phones.waAttempts} + 1` })
    .where(inArray(phones.id, ids));
}

/**
 * Executa até `maxBatches` lotes. Para antes se a sessão estiver indisponível
 * (deixa os números como estão) ou se `shouldStop` indicar meta atingida.
 */
export async function runValidation(
  ctx: AppContext,
  scope: ValidationScope,
  opts: { maxBatches?: number; shouldStop?: () => Promise<boolean>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ValidationRunResult> {
  const settings = await getSettings(ctx.db);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const revalidateBefore = new Date(ctx.now().getTime() - settings.validationRevalidateDays * 86400_000);
  const result: ValidationRunResult = { checked: 0, found: 0, notFound: 0, inconclusive: 0, remaining: 0, stoppedReason: null };
  const sessionKey = getSessionKey(ctx);

  const session = await ctx.wa.getSession(sessionKey);
  if (session.status !== 'connected') {
    result.stoppedReason = `Sessão WhatsApp indisponível (${session.status})`;
    result.remaining = (await candidates(ctx, scope, revalidateBefore, 1000)).length;
    return result;
  }

  const maxBatches = opts.maxBatches ?? 10;
  for (let b = 0; b < maxBatches; b++) {
    if (opts.shouldStop && (await opts.shouldStop())) {
      result.stoppedReason = 'Meta atingida';
      break;
    }
    const batch = await candidates(ctx, scope, revalidateBefore, settings.validationBatchSize);
    if (batch.length === 0) break;
    const numbers = batch.map((p) => p.e164.replace(/^\+/, ''));
    try {
      const results = await ctx.wa.checkNumbers(sessionKey, numbers);
      const now = ctx.now();
      for (let i = 0; i < batch.length; i++) {
        const phone = batch[i]!;
        const r = results[i]!;
        const status: WaStatus = r.outcome;
        await ctx.db
          .update(phones)
          .set({
            waStatus: status,
            waJid: r.outcome === 'found' ? r.jid : null,
            waError: r.error?.slice(0, 255) ?? null,
            waCheckedAt: now,
            waAttempts: sql`${phones.waAttempts} + 1`,
          })
          .where(eq(phones.id, phone.id));
        result.checked++;
        if (status === 'found') result.found++;
        else if (status === 'not_found') result.notFound++;
        else result.inconclusive++;
      }
    } catch (err) {
      const msg = err instanceof HttpError ? `${err.kind}: ${err.message}` : (err as Error).message;
      await markInconclusive(
        ctx,
        batch.map((p) => p.id),
        `Falha na consulta: ${msg}`,
      );
      result.inconclusive += batch.length;
      result.checked += batch.length;
      result.stoppedReason = `Falha no gateway: ${msg}`;
      ctx.log.warn({ err: msg, scope }, 'Validação interrompida por falha do gateway');
      break;
    }
    await ctx.events.publish({ type: 'validation.updated' });
    await sleep(settings.validationMinIntervalMs);
  }
  result.remaining = (await candidates(ctx, scope, revalidateBefore, 1000)).length;
  return result;
}

/** Validação vigente: conclusiva, encontrada e dentro do prazo. */
export function isValidationCurrent(p: { waStatus: WaStatus; waCheckedAt: Date | null }, revalidateDays: number, now: Date): boolean {
  if (p.waStatus !== 'found' || !p.waCheckedAt) return false;
  return now.getTime() - p.waCheckedAt.getTime() <= revalidateDays * 86400_000;
}

export const _internal = { candidates, markInconclusive };
