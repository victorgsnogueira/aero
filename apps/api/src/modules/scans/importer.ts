import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { companies, companyPhones, phones, scanResults } from '../../db/schema.ts';
import { domainFromUrl, type ScrapedPlace } from '../../integrations/scraper/csv.ts';
import { normalizePhone } from '../../lib/phone.ts';

export interface ImportContext {
  scanId: number;
  scanUnitId: number;
  countryCode: string | null;
  /** Meta de números únicos (somente quando targetKind = unique_phones). */
  phoneTarget: number | null;
  /** Números válidos já contabilizados para a meta nesta varredura. */
  countedPhones: number;
  now: Date;
}

export interface ImportOutcome {
  places: number;
  phonesFound: number;
  newCompanies: number;
  duplicates: number;
  surplus: number;
  countedPhones: number;
  /** Todas as empresas vistas nesta unidade (inclusive já presentes na varredura). */
  companyIds: number[];
}

/** Chave da fonte: place_id; na falta, cid/data_id; por último um hash estável de nome+endereço. */
export function sourceKey(p: ScrapedPlace): string {
  if (p.placeId) return p.placeId;
  if (p.cid) return `cid:${p.cid}`;
  if (p.dataId) return `data:${p.dataId}`;
  return `synthetic:${createHash('sha1').update(`${p.title}|${p.address ?? ''}`).digest('hex')}`;
}

function countryFor(p: ScrapedPlace, fallback: string | null): string | null {
  const c = p.completeAddress?.country;
  if (c && /^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return fallback;
}

/**
 * Importa os estabelecimentos de uma unidade de varredura.
 * Reimportar atualiza apenas campos vindos da fonte: anotações, conversas,
 * oportunidades, recusas e supressões nunca são apagados ou sobrescritos.
 */
export async function importPlaces(tx: Tx, ctx: ImportContext, places: ScrapedPlace[]): Promise<ImportOutcome> {
  const out: ImportOutcome = { places: 0, phonesFound: 0, newCompanies: 0, duplicates: 0, surplus: 0, countedPhones: ctx.countedPhones, companyIds: [] };
  const seenPhonesInScan = new Set<number>();

  // Telefones já contabilizados nesta varredura (para não contar duas vezes)
  const counted = await tx.execute(sql`
    SELECT DISTINCT cp.phone_id AS id FROM scan_results sr
    JOIN company_phones cp ON cp.company_id = sr.company_id
    WHERE sr.scan_id = ${ctx.scanId} AND sr.is_surplus = 0`);
  for (const r of (counted[0] as unknown as { id: number }[]) ?? []) seenPhonesInScan.add(Number(r.id));

  for (const p of places) {
    out.places++;
    const key = sourceKey(p);
    const country = countryFor(p, ctx.countryCode);
    const sourceFields = {
      sourceCid: p.cid,
      sourceDataId: p.dataId,
      name: p.title.slice(0, 255),
      category: p.category?.slice(0, 191) ?? null,
      address: p.address?.slice(0, 512) ?? null,
      neighborhood: p.completeAddress?.borough?.slice(0, 160) ?? null,
      city: p.completeAddress?.city?.slice(0, 160) ?? null,
      state: p.completeAddress?.state?.slice(0, 120) ?? null,
      postalCode: p.completeAddress?.postalCode?.slice(0, 32) ?? null,
      countryCode: country,
      website: p.website?.slice(0, 512) ?? null,
      domain: domainFromUrl(p.website),
      mapsUrl: p.link?.slice(0, 1024) ?? null,
      latitude: p.latitude === null ? null : p.latitude.toFixed(7),
      longitude: p.longitude === null ? null : p.longitude.toFixed(7),
      rating: p.rating === null ? null : p.rating.toFixed(2),
      reviewCount: p.reviewCount === null ? null : Math.trunc(p.reviewCount),
      timezone: p.timezone?.slice(0, 64) ?? null,
      raw: p.raw,
    };

    const [existing] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.source, 'google_maps'), eq(companies.sourcePlaceId, key)));

    let companyId: number;
    let isNewCompany = false;
    if (existing) {
      companyId = existing.id;
      // Somente campos da fonte; preserva coordenadas antigas se a nova coleta veio sem elas.
      await tx
        .update(companies)
        .set({
          ...sourceFields,
          latitude: sourceFields.latitude ?? sql`${companies.latitude}`,
          longitude: sourceFields.longitude ?? sql`${companies.longitude}`,
          lastSeenAt: ctx.now,
        })
        .where(eq(companies.id, companyId));
    } else {
      const [res] = await tx
        .insert(companies)
        .values({ source: 'google_maps', sourcePlaceId: key, ...sourceFields, firstSeenAt: ctx.now, lastSeenAt: ctx.now })
        .$returningId();
      companyId = res!.id;
      isNewCompany = true;
      out.newCompanies++;
    }

    if (!out.companyIds.includes(companyId)) out.companyIds.push(companyId);

    // Telefone (opcional)
    const companyPhoneIds: { id: number; valid: boolean }[] = [];
    if (p.phone) {
      out.phonesFound++;
      const n = normalizePhone(p.phone, country);
      await tx
        .insert(phones)
        .values({
          e164: n.e164,
          dedupeKey: n.dedupeKey,
          rawSample: n.raw.slice(0, 64),
          countryCode: n.countryCode,
          formatStatus: n.formatStatus,
          formatNote: n.note?.slice(0, 255) ?? null,
          lineType: n.lineType,
          waStatus: n.formatStatus === 'invalid' ? 'invalid_format' : 'pending',
        })
        .onDuplicateKeyUpdate({ set: { updatedAt: ctx.now } });
      const [phone] = await tx.select({ id: phones.id, formatStatus: phones.formatStatus }).from(phones).where(eq(phones.dedupeKey, n.dedupeKey));
      await tx
        .insert(companyPhones)
        .values({ companyId, phoneId: phone!.id, rawValue: n.raw.slice(0, 64) })
        .onDuplicateKeyUpdate({ set: { rawValue: sql`raw_value` } });
      companyPhoneIds.push({ id: phone!.id, valid: phone!.formatStatus === 'valid' });
    }

    // Ocorrência na varredura (única por empresa)
    const [prior] = await tx
      .select({ id: scanResults.id })
      .from(scanResults)
      .where(and(eq(scanResults.scanId, ctx.scanId), eq(scanResults.companyId, companyId)));
    if (prior) {
      out.duplicates++;
      continue;
    }
    if (!isNewCompany) out.duplicates++;

    const targetReached = ctx.phoneTarget !== null && out.countedPhones >= ctx.phoneTarget;
    let countsTowardTarget = false;
    if (!targetReached) {
      for (const ph of companyPhoneIds) {
        if (ph.valid && !seenPhonesInScan.has(ph.id)) {
          seenPhonesInScan.add(ph.id);
          out.countedPhones++;
          countsTowardTarget = true;
        }
      }
    } else {
      out.surplus++;
    }
    await tx.insert(scanResults).values({
      scanId: ctx.scanId,
      scanUnitId: ctx.scanUnitId,
      companyId,
      isNew: isNewCompany,
      isSurplus: targetReached,
      countsTowardTarget,
    });
  }
  return out;
}
