import { sql, type SQL } from 'drizzle-orm';
import { OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS, WA_STATUSES, WA_STATUS_LABELS, type LeadSortField, type SortDirection } from '@aero/shared';

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

export const PRIMARY_PHONE = sql`(SELECT MIN(cp0.phone_id) FROM company_phones cp0 WHERE cp0.company_id = c.id)`;

export function leadOrder(field: LeadSortField = 'recent', direction: SortDirection = field === 'recent' ? 'desc' : 'asc'): SQL {
  const stage = sql`CASE l.opportunity_stage ${sql.join(
    OPPORTUNITY_STAGES.map((value) => sql`WHEN ${value} THEN ${OPPORTUNITY_STAGE_LABELS[value]}`),
    sql` `,
  )} END`;
  const fields: Record<LeadSortField, SQL> = {
    recent: sql`l.last_seen_at`,
    name: sql`l.name`,
    category: sql`l.category`,
    phone: sql`COALESCE(l.e164, l.raw_sample)`,
    whatsapp: sql`CASE WHEN l.phone_id IS NULL THEN 'Sem telefone' ELSE CASE l.wa_status ${sql.join(
      WA_STATUSES.map((value) => sql`WHEN ${value} THEN ${WA_STATUS_LABELS[value]}`),
      sql` `,
    )} END END`,
    local: sql`NULLIF(CONCAT_WS(' · ', l.city, l.state), '')`,
    situation: sql`NULLIF(CONCAT_WS(' · ', IF(l.suppressed > 0, 'Bloqueado', NULL), IF(l.shared_count > 1, 'Telefone compartilhado', NULL), IF(l.active_participations > 0, 'Em campanha', NULL), ${stage}, IF(l.is_demo = 1, 'Demonstração', NULL)), '')`,
  };
  const value = fields[field];
  const order = direction === 'asc' ? sql`ASC` : sql`DESC`;
  return sql`${value} IS NULL ASC, ${value} ${order}, l.id ${order}`;
}

export function leadWhere(f: LeadFilters): SQL {
  const parts: SQL[] = [sql`1=1`];
  if (!f.includeDemo) parts.push(sql`c.is_demo = 0`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    parts.push(
      sql`(c.name LIKE ${like} OR c.address LIKE ${like} OR EXISTS (SELECT 1 FROM company_phones cpq JOIN phones pq ON pq.id = cpq.phone_id WHERE cpq.company_id = c.id AND (pq.e164 LIKE ${like} OR pq.raw_sample LIKE ${like})))`,
    );
  }
  if (f.scanId) parts.push(sql`EXISTS (SELECT 1 FROM scan_results sr WHERE sr.company_id = c.id AND sr.scan_id = ${f.scanId})`);
  if (f.campaignId) parts.push(sql`EXISTS (SELECT 1 FROM campaign_contacts cc WHERE cc.company_id = c.id AND cc.campaign_id = ${f.campaignId})`);
  if (f.category) parts.push(sql`c.category = ${f.category}`);
  if (f.city) parts.push(sql`c.city = ${f.city}`);
  if (f.waStatus)
    parts.push(
      sql`EXISTS (SELECT 1 FROM company_phones cpw JOIN phones pw ON pw.id = cpw.phone_id WHERE cpw.company_id = c.id AND pw.wa_status = ${f.waStatus})`,
    );
  if (f.formatStatus)
    parts.push(
      sql`EXISTS (SELECT 1 FROM company_phones cpf JOIN phones pf ON pf.id = cpf.phone_id WHERE cpf.company_id = c.id AND pf.format_status = ${f.formatStatus})`,
    );
  if (f.hasCoords === true) parts.push(sql`c.latitude IS NOT NULL AND c.longitude IS NOT NULL`);
  if (f.hasCoords === false) parts.push(sql`(c.latitude IS NULL OR c.longitude IS NULL)`);
  if (f.suppressed !== undefined) {
    const exists = sql`EXISTS (SELECT 1 FROM company_phones cps JOIN suppressions s ON s.phone_id = cps.phone_id AND s.lifted_at IS NULL WHERE cps.company_id = c.id)`;
    parts.push(f.suppressed ? exists : sql`NOT ${exists}`);
  }
  return sql.join(parts, sql` AND `);
}
