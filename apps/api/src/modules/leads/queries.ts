import { sql, type SQL } from 'drizzle-orm';

// Filtros da base de leads, compartilhados entre lista e mapa. Sempre parametrizados.

export interface LeadFilters {
  q?: string;
  scanId?: number;
  campaignId?: number;
  category?: string;
  city?: string;
  waStatus?: string;
  formatStatus?: string;
  hasCoords?: boolean;
  suppressed?: boolean;
  includeDemo?: boolean;
}

/** Telefone principal da empresa (menor id) — subconsulta reutilizável. */
export const PRIMARY_PHONE = sql`(SELECT MIN(cp0.phone_id) FROM company_phones cp0 WHERE cp0.company_id = c.id)`;

export function leadWhere(f: LeadFilters): SQL {
  const parts: SQL[] = [sql`1=1`];
  if (!f.includeDemo) parts.push(sql`c.is_demo = 0`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    parts.push(sql`(c.name LIKE ${like} OR c.address LIKE ${like} OR EXISTS (SELECT 1 FROM company_phones cpq JOIN phones pq ON pq.id = cpq.phone_id WHERE cpq.company_id = c.id AND (pq.e164 LIKE ${like} OR pq.raw_sample LIKE ${like})))`);
  }
  if (f.scanId) parts.push(sql`EXISTS (SELECT 1 FROM scan_results sr WHERE sr.company_id = c.id AND sr.scan_id = ${f.scanId})`);
  if (f.campaignId) parts.push(sql`EXISTS (SELECT 1 FROM campaign_contacts cc WHERE cc.company_id = c.id AND cc.campaign_id = ${f.campaignId})`);
  if (f.category) parts.push(sql`c.category = ${f.category}`);
  if (f.city) parts.push(sql`c.city = ${f.city}`);
  if (f.waStatus) parts.push(sql`EXISTS (SELECT 1 FROM company_phones cpw JOIN phones pw ON pw.id = cpw.phone_id WHERE cpw.company_id = c.id AND pw.wa_status = ${f.waStatus})`);
  if (f.formatStatus) parts.push(sql`EXISTS (SELECT 1 FROM company_phones cpf JOIN phones pf ON pf.id = cpf.phone_id WHERE cpf.company_id = c.id AND pf.format_status = ${f.formatStatus})`);
  if (f.hasCoords === true) parts.push(sql`c.latitude IS NOT NULL AND c.longitude IS NOT NULL`);
  if (f.hasCoords === false) parts.push(sql`(c.latitude IS NULL OR c.longitude IS NULL)`);
  if (f.suppressed !== undefined) {
    const exists = sql`EXISTS (SELECT 1 FROM company_phones cps JOIN suppressions s ON s.phone_id = cps.phone_id AND s.lifted_at IS NULL WHERE cps.company_id = c.id)`;
    parts.push(f.suppressed ? exists : sql`NOT ${exists}`);
  }
  return sql.join(parts, sql` AND `);
}
