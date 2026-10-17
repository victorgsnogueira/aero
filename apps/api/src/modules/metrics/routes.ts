import { Type, type FastifyPluginAsyncTypebox, type Static } from '@fastify/type-provider-typebox';
import { sql, type SQL } from 'drizzle-orm';
import { SERVICES } from '@aero/shared';
import { StringEnum } from '../../lib/schemas.ts';
import type { Db } from '../../db/client.ts';

// Indicadores. Convenções:
//  - "contatos" = telefones únicos; "mensagens" = quantidade de mensagens.
//  - Toda taxa traz numerador e denominador explícitos.
//  - Valores monetários são agrupados por moeda (nunca somados entre moedas).
//  - Entregas/leituras contam apenas confirmações recebidas do gateway.
//  - Dados de demonstração ficam fora, salvo pedido explícito.

const Filters = Type.Object({
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
  service: Type.Optional(StringEnum(SERVICES)),
  campaignId: Type.Optional(Type.Integer({ minimum: 1 })),
  scanId: Type.Optional(Type.Integer({ minimum: 1 })),
  city: Type.Optional(Type.String({ maxLength: 160 })),
  state: Type.Optional(Type.String({ maxLength: 120 })),
  includeDemo: Type.Optional(Type.Boolean()),
});
type F = Static<typeof Filters>;

function range(f: F, col: SQL): SQL {
  const parts: SQL[] = [];
  if (f.from) parts.push(sql`${col} >= ${new Date(`${f.from}T00:00:00Z`)}`);
  if (f.to) parts.push(sql`${col} < DATE_ADD(${new Date(`${f.to}T00:00:00Z`)}, INTERVAL 1 DAY)`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`1=1`;
}

function companyFilter(f: F, alias: SQL): SQL {
  const parts: SQL[] = [];
  if (!f.includeDemo) parts.push(sql`${alias}.is_demo = 0`);
  if (f.city) parts.push(sql`${alias}.city = ${f.city}`);
  if (f.state) parts.push(sql`${alias}.state = ${f.state}`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`1=1`;
}

function campaignFilter(f: F, alias: SQL): SQL {
  const parts: SQL[] = [];
  if (f.campaignId) parts.push(sql`${alias}.id = ${f.campaignId}`);
  if (f.service) parts.push(sql`${alias}.service = ${f.service}`);
  if (!f.includeDemo) parts.push(sql`${alias}.is_demo = 0`);
  if (f.scanId) parts.push(sql`${alias}.id IN (SELECT campaign_id FROM scans WHERE id = ${f.scanId} AND campaign_id IS NOT NULL)`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`1=1`;
}

async function one(db: Db, q: SQL): Promise<Record<string, unknown>> {
  const [rows] = await db.execute(q);
  return ((rows as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;
}
async function many(db: Db, q: SQL): Promise<Record<string, unknown>[]> {
  const [rows] = await db.execute(q);
  return rows as unknown as Record<string, unknown>[];
}
const n = (v: unknown) => Number(v ?? 0);
const rate = (num: number, den: number, label: string) => ({ numerator: num, denominator: den, value: den > 0 ? num / den : null, denominatorLabel: label });

export async function computeMetrics(db: Db, f: F) {
  const scanScope = f.scanId ? sql`sr.scan_id = ${f.scanId}` : sql`1=1`;
  const collection = await one(
    db,
    sql`SELECT COUNT(DISTINCT sr.company_id) AS companies, COUNT(DISTINCT CASE WHEN sr.is_new = 1 THEN sr.company_id END) AS new_records,
               COUNT(DISTINCT CASE WHEN sr.is_new = 0 THEN sr.company_id END) AS duplicates,
               COUNT(DISTINCT cp.phone_id) AS phones,
               COUNT(DISTINCT CASE WHEN p.wa_status = 'found' THEN p.id END) AS wa_found,
               COUNT(DISTINCT CASE WHEN p.wa_status = 'inconclusive' THEN p.id END) AS wa_inconclusive,
               COUNT(DISTINCT CASE WHEN p.wa_status = 'not_found' THEN p.id END) AS wa_not_found
        FROM scan_results sr JOIN companies c ON c.id = sr.company_id
        LEFT JOIN company_phones cp ON cp.company_id = sr.company_id LEFT JOIN phones p ON p.id = cp.phone_id
        WHERE ${scanScope} AND ${range(f, sql`sr.created_at`)} AND ${companyFilter(f, sql`c`)}`,
  );

  const cc = sql`campaign_contacts cc JOIN campaigns cm ON cm.id = cc.campaign_id JOIN companies c ON c.id = cc.company_id`;
  const ccWhere = sql`${campaignFilter(f, sql`cm`)} AND ${companyFilter(f, sql`c`)}`;
  const outreach = await one(
    db,
    sql`SELECT COUNT(DISTINCT CASE WHEN cc.first_sent_at IS NOT NULL AND ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END) AS approached,
               COUNT(DISTINCT CASE WHEN cc.replied_at IS NOT NULL AND ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END) AS replied,
               COUNT(DISTINCT CASE WHEN cc.status IN ('qualifying','qualified') OR EXISTS (SELECT 1 FROM opportunities o WHERE o.campaign_contact_id = cc.id) THEN CASE WHEN ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END END) AS interested,
               COUNT(DISTINCT CASE WHEN cc.status = 'qualified' AND ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END) AS qualified,
               COUNT(DISTINCT CASE WHEN cc.status = 'declined' AND ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END) AS declined,
               COUNT(DISTINCT CASE WHEN cc.status = 'closed_no_reply' AND ${range(f, sql`cc.first_sent_at`)} THEN cc.phone_id END) AS no_reply
        FROM ${cc} WHERE ${ccWhere}`,
  );

  const msgs = await one(
    db,
    sql`SELECT COUNT(*) AS first_messages,
               SUM(m.delivered_at IS NOT NULL) AS delivered, SUM(m.read_at IS NOT NULL) AS read_count,
               SUM(m.status = 'unknown') AS unknown_count, SUM(m.status = 'failed') AS failed_count
        FROM messages m JOIN campaigns cm ON cm.id = m.campaign_id JOIN campaign_contacts cc ON cc.id = m.campaign_contact_id JOIN companies c ON c.id = cc.company_id
        WHERE m.purpose = 'first_contact' AND m.status IN ('accepted','delivered','read','unknown','failed') AND ${range(f, sql`m.sent_at`)} AND ${ccWhere}`,
  );

  const oppScope = sql`opportunities o JOIN companies c ON c.id = o.company_id LEFT JOIN campaigns cm ON cm.id = o.campaign_id`;
  const oppWhere = sql`${companyFilter(f, sql`c`)} AND (${f.campaignId || f.scanId ? campaignFilter(f, sql`cm`) : sql`1=1`}) AND (${f.service ? sql`o.service = ${f.service}` : sql`1=1`})`;
  const proposalsAgg = await many(
    db,
    sql`SELECT pr.currency,
               SUM(pr.sent_at IS NOT NULL AND ${range(f, sql`pr.sent_at`)}) AS sent,
               SUM(pr.status = 'accepted' AND ${range(f, sql`pr.accepted_at`)}) AS accepted,
               SUM(CASE WHEN pr.sent_at IS NOT NULL AND ${range(f, sql`pr.sent_at`)} THEN pr.amount_cents + COALESCE(pr.setup_cents,0) ELSE 0 END) AS offered_cents,
               SUM(CASE WHEN pr.status = 'accepted' AND ${range(f, sql`pr.accepted_at`)} THEN pr.amount_cents + COALESCE(pr.setup_cents,0) ELSE 0 END) AS closed_cents
        FROM proposals pr JOIN ${oppScope} ON o.id = pr.opportunity_id WHERE ${oppWhere} GROUP BY pr.currency`,
  );
  const paymentsAgg = await many(
    db,
    sql`SELECT pay.currency, SUM(pay.amount_cents) AS received_cents, COUNT(DISTINCT pay.proposal_id) AS proposals_with_payment
        FROM payments pay JOIN proposals pr ON pr.id = pay.proposal_id JOIN ${oppScope} ON o.id = pr.opportunity_id
        WHERE ${range(f, sql`pay.received_at`)} AND ${oppWhere} GROUP BY pay.currency`,
  );
  const fullyPaid = await one(
    db,
    sql`SELECT COUNT(*) AS n FROM proposals pr JOIN ${oppScope} ON o.id = pr.opportunity_id
        WHERE pr.status = 'accepted' AND ${oppWhere} AND ${range(f, sql`pr.accepted_at`)}
          AND (SELECT COALESCE(SUM(pay.amount_cents),0) FROM payments pay WHERE pay.proposal_id = pr.id AND pay.currency = pr.currency) >= pr.amount_cents + COALESCE(pr.setup_cents,0)`,
  );
  const stages = await many(db, sql`SELECT o.stage, COUNT(*) AS n FROM ${oppScope} WHERE ${oppWhere} AND ${range(f, sql`o.created_at`)} GROUP BY o.stage`);
  const lossReasons = await many(
    db,
    sql`SELECT COALESCE(o.lost_reason, 'Sem motivo') AS reason, COUNT(*) AS n FROM ${oppScope} WHERE o.stage = 'lost' AND ${oppWhere} AND ${range(f, sql`o.lost_at`)} GROUP BY reason ORDER BY n DESC LIMIT 20`,
  );

  const approached = n(outreach.approached);
  const firstMessages = n(msgs.first_messages);
  const sentProposals = proposalsAgg.reduce((a, r) => a + n(r.sent), 0);
  const acceptedProposals = proposalsAgg.reduce((a, r) => a + n(r.accepted), 0);
  return {
    collection: {
      companies: n(collection.companies),
      newRecords: n(collection.new_records),
      duplicates: n(collection.duplicates),
      phones: n(collection.phones),
      waConfirmed: n(collection.wa_found),
      waInconclusive: n(collection.wa_inconclusive),
      waNotFound: n(collection.wa_not_found),
    },
    outreach: {
      contactsApproached: approached,
      firstMessages,
      deliveredConfirmed: n(msgs.delivered),
      readConfirmed: n(msgs.read_count),
      unknownResult: n(msgs.unknown_count),
      failed: n(msgs.failed_count),
      contactsReplied: n(outreach.replied),
      contactsInterested: n(outreach.interested),
      contactsQualified: n(outreach.qualified),
      contactsDeclined: n(outreach.declined),
      contactsNoReply: n(outreach.no_reply),
    },
    rates: {
      reply: rate(n(outreach.replied), approached, 'contatos abordados'),
      interest: rate(n(outreach.interested), approached, 'contatos abordados'),
      qualification: rate(n(outreach.qualified), n(outreach.interested), 'contatos interessados'),
      deliveryConfirmed: rate(n(msgs.delivered), firstMessages, 'primeiras mensagens enviadas'),
      readConfirmed: rate(n(msgs.read_count), firstMessages, 'primeiras mensagens enviadas'),
      proposalAcceptance: rate(acceptedProposals, sentProposals, 'propostas enviadas'),
    },
    proposals: { sent: sentProposals, accepted: acceptedProposals, fullyPaid: n(fullyPaid.n) },
    money: {
      offered: Object.fromEntries(proposalsAgg.map((r) => [String(r.currency), n(r.offered_cents)])),
      closed: Object.fromEntries(proposalsAgg.map((r) => [String(r.currency), n(r.closed_cents)])),
      received: Object.fromEntries(paymentsAgg.map((r) => [String(r.currency), n(r.received_cents)])),
    },
    stages: Object.fromEntries(stages.map((r) => [String(r.stage), n(r.n)])),
    lossReasons: lossReasons.map((r) => ({ reason: String(r.reason), count: n(r.n) })),
  };
}

export const metricsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx;

  app.get('/overview', { schema: { tags: ['metrics'], querystring: Filters } }, async (req) => computeMetrics(db, req.query));

  app.get('/campaigns', { schema: { tags: ['metrics'], querystring: Filters } }, async (req) => {
    const [rows] = await db.execute(sql`SELECT id, name, service, status FROM campaigns WHERE ${req.query.includeDemo ? sql`1=1` : sql`is_demo = 0`} ORDER BY id DESC LIMIT 100`);
    const list = rows as unknown as { id: number; name: string; service: string; status: string }[];
    return {
      note: 'Campanhas com públicos, ofertas e períodos diferentes não constituem um experimento controlado; compare com cautela.',
      items: await Promise.all(list.map(async (c) => ({ ...c, metrics: await computeMetrics(db, { ...req.query, campaignId: Number(c.id) }) }))),
    };
  });

  app.get('/attention', { schema: { tags: ['metrics'] } }, async () => {
    const r = await one(
      db,
      sql`SELECT (SELECT COUNT(*) FROM conversations WHERE state = 'awaiting_human') AS awaiting_human,
                 (SELECT COALESCE(SUM(unread_count),0) FROM conversations) AS unread,
                 (SELECT COUNT(*) FROM messages WHERE status = 'unknown') AS unknown_sends,
                 (SELECT COUNT(*) FROM messages WHERE status = 'scheduled') AS scheduled,
                 (SELECT COUNT(*) FROM scans WHERE status IN ('queued','running','pausing','cancelling')) AS running_scans,
                 (SELECT COUNT(*) FROM opportunities WHERE next_action_due_at IS NOT NULL AND next_action_due_at < UTC_TIMESTAMP(3) AND stage NOT IN ('won','lost')) AS overdue`,
    );
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]));
  });
};
