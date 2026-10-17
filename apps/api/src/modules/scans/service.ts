import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.ts';
import { scans, scanUnits } from '../../db/schema.ts';
import { conflict, notFound } from '../../core/errors.ts';
import { enqueue } from '../../core/outbox.ts';
import { audit } from '../../core/audit.ts';
import type { ScanMode, ScanStatus, ScanTargetKind } from '@aero/shared';

export type Scan = typeof scans.$inferSelect;
export type ScanUnit = typeof scanUnits.$inferSelect;

export interface CreateScanInput {
  name: string;
  segment: string | null;
  category: string | null;
  keywords: string[];
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  language: string;
  mode: ScanMode;
  targetKind: ScanTargetKind;
  targetCount: number;
  campaignId: number | null;
  depth: number;
  unitMaxSeconds: number;
  maxUnits: number;
  maxDurationMinutes: number;
}

export function regionLabel(s: Pick<Scan, 'neighborhood' | 'city' | 'state' | 'country'>): string {
  return [s.neighborhood, s.city, s.state, s.country].filter((x) => x && x.trim()).join(', ');
}

/** Consulta textual enviada ao Google Maps: termo + região digitada. */
export function buildQuery(keyword: string, region: string): string {
  return region ? `${keyword.trim()} ${region}` : keyword.trim();
}

export function queryHash(query: string, lang: string): string {
  return createHash('sha256').update(`${lang}|${query.toLowerCase().replace(/\s+/g, ' ').trim()}`).digest('hex');
}

/**
 * Planejamento: primeira passada com uma unidade por termo; se a meta não for
 * atingida, o orquestrador cria uma segunda passada com profundidade maior,
 * respeitando `maxUnits`.
 */
export function planFirstPass(input: Pick<CreateScanInput, 'keywords' | 'depth'> & { region: string }): { query: string; depth: number }[] {
  const uniq = [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))];
  return uniq.map((k) => ({ query: buildQuery(k, input.region), depth: input.depth }));
}

export async function getScan(db: DbOrTx, id: number): Promise<Scan> {
  const [row] = await db.select().from(scans).where(eq(scans.id, id));
  if (!row) throw notFound('Varredura');
  return row;
}

export async function listUnits(db: DbOrTx, scanId: number): Promise<ScanUnit[]> {
  return db.select().from(scanUnits).where(eq(scanUnits.scanId, scanId)).orderBy(asc(scanUnits.seq));
}

export async function createScan(db: Db, input: CreateScanInput): Promise<number> {
  return db.transaction(async (tx) => {
    const [res] = await tx.insert(scans).values({ ...input, status: 'draft' }).$returningId();
    const scanId = res!.id;
    const plan = planFirstPass({ keywords: input.keywords, depth: input.depth, region: regionLabel(input) }).slice(0, input.maxUnits);
    if (plan.length) {
      await tx.insert(scanUnits).values(plan.map((u, i) => ({ scanId, seq: i + 1, query: u.query, depth: u.depth })));
    }
    await audit(tx, 'owner', 'scan.create', 'scan', scanId, { mode: input.mode, targetKind: input.targetKind, targetCount: input.targetCount });
    return scanId;
  });
}

const ACTIVE: ScanStatus[] = ['queued', 'running', 'pausing', 'cancelling'];

async function transition(db: Db, id: number, allowed: ScanStatus[], to: ScanStatus, action: string, patch: Partial<Scan> = {}): Promise<Scan> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(scans).where(eq(scans.id, id)).for('update');
    if (!row) throw notFound('Varredura');
    if (!allowed.includes(row.status)) throw conflict('invalid_transition', `Não é possível ${action} uma varredura com estado "${row.status}"`);
    await tx.update(scans).set({ status: to, ...patch }).where(eq(scans.id, id));
    if (ACTIVE.includes(to)) await enqueue(tx, 'scan.tick', { scanId: id }, { dedupeKey: `scan.tick:${id}` });
    await audit(tx, 'owner', `scan.${action}`, 'scan', id, { from: row.status, to });
    return { ...row, status: to, ...patch };
  });
}

/** Início/retomada manual. Coletar nunca dispara mensagens. */
export const startScan = (db: Db, id: number, now: Date) =>
  transition(db, id, ['draft'], 'queued', 'start', { startedAt: now, statusReason: null, lastError: null });

export const pauseScan = (db: Db, id: number) =>
  transition(db, id, ['queued', 'running'], 'pausing', 'pause', { statusReason: 'Pausa solicitada; aguardando a unidade em andamento' });

export async function resumeScan(db: Db, id: number): Promise<Scan> {
  const scan = await transition(db, id, ['paused', 'partial', 'failed'], 'queued', 'resume', { statusReason: null, finishedAt: null });
  // Unidades que falharam voltam a ficar pendentes ao retomar
  await db
    .update(scanUnits)
    .set({ status: 'pending', error: null, externalJobId: null })
    .where(and(eq(scanUnits.scanId, id), inArray(scanUnits.status, ['failed'])));
  return scan;
}

export const cancelScan = (db: Db, id: number) =>
  transition(db, id, ['draft', 'queued', 'running', 'pausing', 'paused'], 'cancelling', 'cancel', { statusReason: 'Cancelamento solicitado' });

/** Recalcula contadores a partir dos dados persistidos (fonte de verdade). */
export async function recomputeCounters(db: DbOrTx, scanId: number): Promise<Pick<Scan, 'placesFound' | 'phonesFound' | 'newRecords' | 'duplicates' | 'uniquePhones' | 'waConfirmed' | 'waInconclusive' | 'surplus'>> {
  const [units] = (await db.execute(sql`
    SELECT COALESCE(SUM(places_found),0) AS places FROM scan_units WHERE scan_id = ${scanId}`))[0] as unknown as { places: string }[];
  const [agg] = (await db.execute(sql`
    SELECT
      COUNT(*) AS results,
      SUM(sr.is_new) AS new_records,
      SUM(1 - sr.is_new) AS duplicates_base,
      SUM(sr.is_surplus) AS surplus
    FROM scan_results sr WHERE sr.scan_id = ${scanId}`))[0] as unknown as { results: string; new_records: string | null; duplicates_base: string | null; surplus: string | null }[];
  const [ph] = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT cp.phone_id) AS phones_found,
      COUNT(DISTINCT CASE WHEN p.format_status = 'valid' AND sr.is_surplus = 0 THEN p.id END) AS unique_valid,
      COUNT(DISTINCT CASE WHEN p.wa_status = 'found' AND sr.is_surplus = 0 THEN p.id END) AS wa_found,
      COUNT(DISTINCT CASE WHEN p.wa_status = 'inconclusive' THEN p.id END) AS wa_inconclusive
    FROM scan_results sr
    JOIN company_phones cp ON cp.company_id = sr.company_id
    JOIN phones p ON p.id = cp.phone_id
    WHERE sr.scan_id = ${scanId}`))[0] as unknown as { phones_found: string; unique_valid: string; wa_found: string; wa_inconclusive: string }[];
  const unitDup = (await db.execute(sql`SELECT COALESCE(SUM(duplicates),0) AS d FROM scan_units WHERE scan_id = ${scanId}`))[0] as unknown as { d: string }[];
  const counters = {
    placesFound: Number(units?.places ?? 0),
    phonesFound: Number(ph?.phones_found ?? 0),
    newRecords: Number(agg?.new_records ?? 0),
    duplicates: Number(unitDup[0]?.d ?? agg?.duplicates_base ?? 0),
    uniquePhones: Number(ph?.unique_valid ?? 0),
    waConfirmed: Number(ph?.wa_found ?? 0),
    waInconclusive: Number(ph?.wa_inconclusive ?? 0),
    surplus: Number(agg?.surplus ?? 0),
  };
  await db.update(scans).set(counters).where(eq(scans.id, scanId));
  return counters;
}

export function targetProgress(scan: Pick<Scan, 'targetKind' | 'uniquePhones' | 'waConfirmed'>): number {
  return scan.targetKind === 'whatsapp_confirmed' ? scan.waConfirmed : scan.uniquePhones;
}
