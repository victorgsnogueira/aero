import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import { scans, scanUnits, scanQueryLog, scanResults } from '../../db/schema.ts';
import { parseScraperCsv } from '../../integrations/scraper/csv.ts';
import { importPlaces } from './importer.ts';
import { getScan, listUnits, queryHash, recomputeCounters, targetProgress, type Scan, type ScanUnit } from './service.ts';
import { runValidation } from '../validation/service.ts';

// Orquestrador de varreduras. Cada "tick" é idempotente e avança o estado com
// base no que está persistido; pode ser repetido após reinícios sem duplicar efeitos.
// Executado pelo worker com concorrência 1 (o scraper processa um job por vez).

const MAX_UNIT_ATTEMPTS = 2;
/** Tolerância além do max_time da unidade antes de considerá-la travada. */
const UNIT_GRACE_SECONDS = 600;
/** Uma consulta idêntica executada há menos disso é reaproveitada em vez de repetida. */
const QUERY_REUSE_HOURS = 24;

export interface TickResult {
  /** Agendar próximo tick em ms; null = varredura encerrada/parada. */
  nextInMs: number | null;
}

async function finish(ctx: AppContext, scan: Scan, status: Scan['status'], reason: string): Promise<TickResult> {
  await recomputeCounters(ctx.db, scan.id);
  await ctx.db.update(scans).set({ status, statusReason: reason, finishedAt: ctx.now() }).where(eq(scans.id, scan.id));
  await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
  ctx.log.info({ scanId: scan.id, status, reason }, 'Varredura encerrada');
  return { nextInMs: null };
}

async function setUnit(ctx: AppContext, unitId: number, patch: Partial<ScanUnit>): Promise<void> {
  await ctx.db.update(scanUnits).set(patch).where(eq(scanUnits.id, unitId));
}

async function abandonActiveUnits(ctx: AppContext, units: ScanUnit[]): Promise<void> {
  for (const u of units.filter((x) => x.status === 'submitted' || x.status === 'running')) {
    // DELETE remove o job pendente; um job já em execução segue no scraper até o
    // max_time — o resultado é descartado (não importado).
    if (u.externalJobId) await ctx.scraper.deleteJob(u.externalJobId).catch(() => undefined);
    await setUnit(ctx, u.id, { status: 'abandoned', finishedAt: ctx.now(), error: 'Descartada por cancelamento' });
  }
  await ctx.db
    .update(scanUnits)
    .set({ status: 'skipped' })
    .where(and(eq(scanUnits.scanId, units[0]?.scanId ?? 0), eq(scanUnits.status, 'pending')));
}

async function targetReached(ctx: AppContext, scan: Scan): Promise<boolean> {
  const counters = await recomputeCounters(ctx.db, scan.id);
  return targetProgress({ targetKind: scan.targetKind, ...counters }) >= scan.targetCount;
}

/** Importa o CSV de uma unidade concluída. */
async function importUnit(ctx: AppContext, scan: Scan, unit: ScanUnit): Promise<void> {
  await setUnit(ctx, unit.id, { status: 'importing' });
  const csv = unit.externalJobId ? await ctx.scraper.downloadCsv(unit.externalJobId) : null;
  const places = csv ? parseScraperCsv(csv) : [];
  const counters = await recomputeCounters(ctx.db, scan.id);
  await ctx.db.transaction(async (tx) => {
    const outcome = await importPlaces(
      tx,
      {
        scanId: scan.id,
        scanUnitId: unit.id,
        countryCode: scan.countryCode,
        phoneTarget: scan.targetKind === 'unique_phones' ? scan.targetCount : null,
        countedPhones: counters.uniquePhones,
        now: ctx.now(),
      },
      places,
    );
    await tx
      .update(scanUnits)
      .set({ status: 'done', placesFound: outcome.places, newRecords: outcome.newCompanies, duplicates: outcome.duplicates, finishedAt: ctx.now(), error: null })
      .where(eq(scanUnits.id, unit.id));
    await tx.insert(scanQueryLog).values({ queryHash: queryHash(unit.query, scan.language), query: unit.query, language: scan.language, depth: unit.depth, scanUnitId: unit.id, placesFound: outcome.places });
  });
  // Resultado já persistido; o CSV no scraper pode ser removido para liberar disco.
  if (unit.externalJobId) await ctx.scraper.deleteJob(unit.externalJobId).catch(() => undefined);
}

/** Reaproveita o resultado de uma consulta idêntica recente, sem novo acesso ao Google Maps. */
async function tryReuse(ctx: AppContext, scan: Scan, unit: ScanUnit): Promise<boolean> {
  const since = new Date(ctx.now().getTime() - QUERY_REUSE_HOURS * 3600_000);
  const [prior] = await ctx.db
    .select()
    .from(scanQueryLog)
    .where(and(eq(scanQueryLog.queryHash, queryHash(unit.query, scan.language)), sql`${scanQueryLog.depth} >= ${unit.depth}`, sql`${scanQueryLog.executedAt} >= ${since}`))
    .orderBy(sql`${scanQueryLog.executedAt} DESC`)
    .limit(1);
  if (!prior || prior.scanUnitId === unit.id) return false;
  const companyRows = await ctx.db.select({ companyId: scanResults.companyId }).from(scanResults).where(eq(scanResults.scanUnitId, prior.scanUnitId));
  const counters = await recomputeCounters(ctx.db, scan.id);
  await ctx.db.transaction(async (tx) => {
    let counted = counters.uniquePhones;
    let dup = 0;
    for (const { companyId } of companyRows) {
      const [exists] = await tx.select({ id: scanResults.id }).from(scanResults).where(and(eq(scanResults.scanId, scan.id), eq(scanResults.companyId, companyId)));
      dup++;
      if (exists) continue;
      const surplus = scan.targetKind === 'unique_phones' && counted >= scan.targetCount;
      const validPhones = (await tx.execute(sql`
        SELECT COUNT(*) AS n FROM company_phones cp JOIN phones p ON p.id = cp.phone_id
        WHERE cp.company_id = ${companyId} AND p.format_status = 'valid'
          AND NOT EXISTS (SELECT 1 FROM scan_results sr JOIN company_phones cp2 ON cp2.company_id = sr.company_id
                          WHERE sr.scan_id = ${scan.id} AND sr.is_surplus = 0 AND cp2.phone_id = cp.phone_id)`))[0] as unknown as { n: string }[];
      const n = Number(validPhones[0]?.n ?? 0);
      if (!surplus) counted += n;
      await tx.insert(scanResults).values({ scanId: scan.id, scanUnitId: unit.id, companyId, isNew: false, isSurplus: surplus, countsTowardTarget: !surplus && n > 0 });
    }
    await tx
      .update(scanUnits)
      .set({ status: 'done', placesFound: prior.placesFound, newRecords: 0, duplicates: dup, finishedAt: ctx.now(), error: `Reaproveitada: consulta idêntica executada em ${prior.executedAt.toISOString()}` })
      .where(eq(scanUnits.id, unit.id));
  });
  return true;
}

export async function scanTick(ctx: AppContext, scanId: number): Promise<TickResult> {
  let scan = await getScan(ctx.db, scanId);
  const units = await listUnits(ctx.db, scanId);
  const active = units.find((u) => u.status === 'submitted' || u.status === 'running' || u.status === 'importing');

  if (!['queued', 'running', 'pausing', 'cancelling'].includes(scan.status)) return { nextInMs: null };

  if (scan.status === 'cancelling') {
    await abandonActiveUnits(ctx, units);
    return finish(ctx, scan, 'cancelled', 'Cancelada pelo proprietário');
  }

  if (scan.status === 'queued') {
    await ctx.db.update(scans).set({ status: 'running', startedAt: scan.startedAt ?? ctx.now() }).where(eq(scans.id, scan.id));
    scan = { ...scan, status: 'running', startedAt: scan.startedAt ?? ctx.now() };
  }

  // Limite de duração total
  const deadline = (scan.startedAt ?? ctx.now()).getTime() + scan.maxDurationMinutes * 60_000;
  if (ctx.now().getTime() > deadline) {
    await abandonActiveUnits(ctx, units);
    const reached = await targetReached(ctx, scan);
    return finish(ctx, scan, reached ? 'completed' : 'partial', reached ? 'Meta atingida' : `Tempo máximo de ${scan.maxDurationMinutes} min atingido antes da meta`);
  }

  // 1) Acompanhar unidade em andamento
  if (active) {
    if (active.status === 'importing') {
      // Importação interrompida (ex.: reinício): refaz — é idempotente.
      await importUnit(ctx, scan, active);
    } else {
      let job;
      try {
        job = active.externalJobId ? await ctx.scraper.getJob(active.externalJobId) : null;
      } catch (err) {
        await ctx.db.update(scans).set({ lastError: `Scraper indisponível: ${(err as Error).message}`.slice(0, 1000) }).where(eq(scans.id, scan.id));
        await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
        return { nextInMs: 30_000 };
      }
      const runningFor = active.submittedAt ? (ctx.now().getTime() - active.submittedAt.getTime()) / 1000 : 0;
      if (!job || job.status === 'failed') {
        const attempts = active.attempts;
        await setUnit(ctx, active.id, {
          status: attempts < MAX_UNIT_ATTEMPTS ? 'pending' : 'failed',
          externalJobId: null,
          error: job ? 'Scraper reportou falha no job' : 'Job não encontrado no scraper',
        });
      } else if (job.status === 'ok') {
        await importUnit(ctx, scan, active);
      } else {
        if (job.status === 'working' && active.status !== 'running') {
          await setUnit(ctx, active.id, { status: 'running', submittedAt: ctx.now() });
        } else if (active.status === 'running' && runningFor > scan.unitMaxSeconds + UNIT_GRACE_SECONDS) {
          await ctx.scraper.deleteJob(active.externalJobId!).catch(() => undefined);
          await setUnit(ctx, active.id, { status: active.attempts < MAX_UNIT_ATTEMPTS ? 'pending' : 'failed', externalJobId: null, error: 'Unidade excedeu o tempo limite' });
        }
        await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
        return { nextInMs: 10_000 };
      }
    }
    await recomputeCounters(ctx.db, scan.id);
    await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
  }

  // 2) Validação de WhatsApp (somente no modo que a inclui)
  if (scan.mode === 'collect_and_validate') {
    const res = await runValidation(ctx, { kind: 'scan', scanId: scan.id }, {
      maxBatches: 5,
      shouldStop: async () => scan.targetKind === 'whatsapp_confirmed' && (await targetReached(ctx, scan)),
    });
    await recomputeCounters(ctx.db, scan.id);
    if (res.stoppedReason && res.stoppedReason !== 'Meta atingida') {
      await ctx.db.update(scans).set({ lastError: res.stoppedReason.slice(0, 1000) }).where(eq(scans.id, scan.id));
    }
    await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
    const sessionDown = res.stoppedReason?.startsWith('Sessão WhatsApp indisponível');
    if (res.remaining > 0 && !sessionDown && !(scan.targetKind === 'whatsapp_confirmed' && (await targetReached(ctx, scan)))) {
      return { nextInMs: 2_000 };
    }
  }

  if (await targetReached(ctx, scan)) return finish(ctx, scan, 'completed', 'Meta atingida');

  const fresh = await getScan(ctx.db, scan.id);
  if (fresh.status === 'pausing') {
    await ctx.db.update(scans).set({ status: 'paused', statusReason: 'Pausada pelo proprietário' }).where(eq(scans.id, scan.id));
    await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
    return { nextInMs: null };
  }
  if (fresh.status === 'cancelling') return { nextInMs: 1_000 };

  // 3) Próxima unidade
  const refreshed = await listUnits(ctx.db, scan.id);
  let next = refreshed.find((u) => u.status === 'pending');
  if (!next) {
    // Segunda passada com mais profundidade, se houver orçamento de unidades
    const firstPass = refreshed.filter((u) => u.depth === scan.depth);
    const canEscalate = refreshed.every((u) => u.depth === scan.depth) && refreshed.length < scan.maxUnits;
    if (canEscalate && firstPass.length > 0) {
      const budget = scan.maxUnits - refreshed.length;
      const extra = firstPass.slice(0, budget).map((u, i) => ({ scanId: scan.id, seq: refreshed.length + i + 1, query: u.query, depth: Math.min(u.depth * 2, 100) }));
      await ctx.db.insert(scanUnits).values(extra);
      return { nextInMs: 500 };
    }
    const failed = refreshed.filter((u) => u.status === 'failed').length;
    const pendingValidation = scan.mode === 'collect_and_validate' ? (await getScan(ctx.db, scan.id)).lastError : null;
    return finish(
      ctx,
      scan,
      'partial',
      `Buscas planejadas concluídas sem atingir a meta (${targetProgress(await getScan(ctx.db, scan.id))}/${scan.targetCount})` +
        (failed ? `; ${failed} unidade(s) falharam` : '') +
        (pendingValidation ? `; validação: ${pendingValidation}` : ''),
    );
  }

  if (await tryReuse(ctx, scan, next)) return { nextInMs: 500 };

  try {
    const jobId = await ctx.scraper.createJob({
      name: `aero-scan-${scan.id}-u${next.seq}`,
      query: next.query,
      lang: scan.language,
      depth: next.depth,
      maxTimeSeconds: Math.max(180, scan.unitMaxSeconds),
    });
    await setUnit(ctx, next.id, { status: 'submitted', externalJobId: jobId, submittedAt: ctx.now(), attempts: next.attempts + 1, error: null });
    await ctx.db.update(scans).set({ lastError: null }).where(eq(scans.id, scan.id));
  } catch (err) {
    await ctx.db.update(scans).set({ lastError: `Falha ao criar job no scraper: ${(err as Error).message}`.slice(0, 1000) }).where(eq(scans.id, scan.id));
    await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
    return { nextInMs: 30_000 };
  }
  await ctx.events.publish({ type: 'scan.updated', scanId: scan.id });
  return { nextInMs: 10_000 };
}

/** Varreduras que precisam de acompanhamento (usado na recuperação após reinício). */
export async function activeScanIds(ctx: AppContext): Promise<number[]> {
  const rows = await ctx.db.select({ id: scans.id }).from(scans).where(inArray(scans.status, ['queued', 'running', 'pausing', 'cancelling'])).orderBy(asc(scans.id));
  return rows.map((r) => r.id);
}
