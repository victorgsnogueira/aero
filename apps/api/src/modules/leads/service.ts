import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { companies, companyPhones, phones } from '../../db/schema.ts';
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';
import { normalizePhone } from '../../lib/phone.ts';
import { isValidTimezone } from '../../lib/schedule.ts';
import { domainFromUrl } from '../../integrations/scraper/csv.ts';
import type { CompanyInput, CompanyUpdate } from './input.ts';

export function companyPatch(input: CompanyUpdate) {
  if (input.timezone && !isValidTimezone(input.timezone)) throw badRequest('invalid_timezone', 'Fuso horário inválido');
  const { latitude, longitude, rating, website, ...rest } = input;
  return {
    ...rest,
    ...(website !== undefined ? { website, domain: domainFromUrl(website) } : {}),
    ...(latitude !== undefined ? { latitude: latitude === null ? null : latitude.toFixed(7) } : {}),
    ...(longitude !== undefined ? { longitude: longitude === null ? null : longitude.toFixed(7) } : {}),
    ...(rating !== undefined ? { rating: rating === null ? null : rating.toFixed(2) } : {}),
  };
}

export async function addCompanyPhone(tx: Tx, companyId: number, raw: string, countryCode: string | null, now: Date) {
  if (!raw.trim()) throw badRequest('phone_required', 'Informe o telefone');
  const normalized = normalizePhone(raw, countryCode);
  if (normalized.dedupeKey.length > 64) throw badRequest('phone_too_long', 'Telefone longo demais para normalização');
  await tx.insert(phones).values({
    e164: normalized.e164, dedupeKey: normalized.dedupeKey, rawSample: normalized.raw,
    countryCode: normalized.countryCode, formatStatus: normalized.formatStatus,
    formatNote: normalized.note?.slice(0, 255) ?? null, lineType: normalized.lineType,
    waStatus: normalized.formatStatus === 'invalid' ? 'invalid_format' : 'pending',
  }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
  const [phone] = await tx.select().from(phones).where(eq(phones.dedupeKey, normalized.dedupeKey));
  await tx.insert(companyPhones).values({ companyId, phoneId: phone!.id, rawValue: normalized.raw, source: 'manual' })
    .onDuplicateKeyUpdate({ set: { phoneId: phone!.id } });
  await audit(tx, 'owner', 'lead.phone.add', 'company', companyId, { phoneId: phone!.id });
  return { phoneId: phone!.id, e164: phone!.e164, formatStatus: phone!.formatStatus, waStatus: phone!.waStatus };
}

export async function createCompany(tx: Tx, input: CompanyInput, now: Date) {
  const { clientKey, phones: rawPhones, ...fields } = input;
  if (((fields.latitude ?? null) === null) !== ((fields.longitude ?? null) === null)) throw badRequest('coordinates_pair', 'Informe latitude e longitude juntas');
  // The unique source/place key gives the manual creation operation a durable identity.
  const patch = companyPatch(fields);
  const sourcePlaceId = `manual:${clientKey}`;
  const [inserted] = await tx.insert(companies).ignore().values({ ...patch, name: input.name, source: 'manual', sourcePlaceId, firstSeenAt: now, lastSeenAt: now });
  const [company] = await tx.select().from(companies).where(and(eq(companies.source, 'manual'), eq(companies.sourcePlaceId, sourcePlaceId)));
  if (!company) throw conflict('company_create_failed', 'Não foi possível cadastrar a empresa');
  if ((inserted as { affectedRows: number }).affectedRows === 0) return { id: company.id };
  // A repeated creation is not an update: preserve all existing business data and phone state.
  for (const raw of rawPhones ?? []) await addCompanyPhone(tx, company.id, raw, fields.countryCode ?? null, now);
  await audit(tx, 'owner', 'lead.create', 'company', company.id, { source: 'manual' });
  return { id: company.id };
}

export async function updateCompany(tx: Tx, id: number, input: CompanyUpdate) {
  const [company] = await tx.select().from(companies).where(eq(companies.id, id)).for('update');
  if (!company) throw notFound('Empresa');
  const latitude = input.latitude !== undefined ? input.latitude : company.latitude;
  const longitude = input.longitude !== undefined ? input.longitude : company.longitude;
  if ((latitude === null) !== (longitude === null)) throw badRequest('coordinates_pair', 'Informe latitude e longitude juntas');
  if (Object.keys(input).length === 0) throw badRequest('empty_patch', 'Informe ao menos um campo');
  await tx.update(companies).set(companyPatch(input)).where(eq(companies.id, id));
  await audit(tx, 'owner', 'lead.update', 'company', id, { fields: Object.keys(input) });
}
