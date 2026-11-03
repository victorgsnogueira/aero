import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq, sql } from 'drizzle-orm';
import { LEAD_SORT_FIELDS, PHONE_FORMAT_STATUSES, WA_STATUSES } from '@aero/shared';
import { companies, phones } from '../../db/schema.ts';
import { Merge, IdParams, Nullable, Pagination, StringEnum, pageArgs } from '../../lib/schemas.ts';
import { notFound } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';
import { enqueue } from '../../core/outbox.ts';
import { leadOrder, leadWhere, PRIMARY_PHONE, type LeadFilters } from './queries.ts';
import { liftManualSuppression, suppressPhone } from './suppression.ts';
import { CompanyCreate, CompanyPatch } from './input.ts';
import { addCompanyPhone, createCompany, updateCompany } from './service.ts';

const LeadFilterQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 120 })),
  scanId: Type.Optional(Type.Integer({ minimum: 1 })),
  campaignId: Type.Optional(Type.Integer({ minimum: 1 })),
  category: Type.Optional(Type.String({ maxLength: 191 })),
  city: Type.Optional(Type.String({ maxLength: 160 })),
  waStatus: Type.Optional(StringEnum(WA_STATUSES)),
  formatStatus: Type.Optional(StringEnum(PHONE_FORMAT_STATUSES)),
  hasCoords: Type.Optional(Type.Boolean()),
  suppressed: Type.Optional(Type.Boolean()),
  includeDemo: Type.Optional(Type.Boolean()),
});

const LeadRow = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  category: Nullable(Type.String()),
  city: Nullable(Type.String()),
  state: Nullable(Type.String()),
  countryCode: Nullable(Type.String()),
  hasCoords: Type.Boolean(),
  latitude: Nullable(Type.Number()),
  longitude: Nullable(Type.Number()),
  isDemo: Type.Boolean(),
  phoneId: Nullable(Type.Integer()),
  phoneE164: Nullable(Type.String()),
  phoneRaw: Nullable(Type.String()),
  formatStatus: Nullable(Type.String()),
  waStatus: Nullable(Type.String()),
  waCheckedAt: Nullable(Type.String()),
  phoneCount: Type.Integer(),
  sharedPhone: Type.Boolean({ description: 'Telefone também associado a outra empresa' }),
  suppressed: Type.Boolean(),
  activeParticipations: Type.Integer(),
  opportunityStage: Nullable(Type.String()),
  lastSeenAt: Type.String(),
});

type RawLead = Record<string, unknown>;
const toNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function mapLead(r: RawLead) {
  return {
    id: Number(r.id),
    name: String(r.name),
    category: (r.category as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    countryCode: (r.country_code as string) ?? null,
    hasCoords: r.latitude !== null && r.longitude !== null,
    latitude: toNum(r.latitude),
    longitude: toNum(r.longitude),
    isDemo: Boolean(Number(r.is_demo)),
    phoneId: toNum(r.phone_id),
    phoneE164: (r.e164 as string) ?? null,
    phoneRaw: (r.raw_sample as string) ?? null,
    formatStatus: (r.format_status as string) ?? null,
    waStatus: (r.wa_status as string) ?? null,
    waCheckedAt: toIso(r.wa_checked_at),
    phoneCount: Number(r.phone_count ?? 0),
    sharedPhone: Number(r.shared_count ?? 0) > 1,
    suppressed: Number(r.suppressed ?? 0) > 0,
    activeParticipations: Number(r.active_participations ?? 0),
    opportunityStage: (r.opportunity_stage as string) ?? null,
    lastSeenAt: toIso(r.last_seen_at)!,
  };
}

const LEAD_SELECT = sql`
  SELECT c.id, c.name, c.category, c.city, c.state, c.country_code, c.latitude, c.longitude, c.is_demo, c.last_seen_at,
         p.id AS phone_id, p.e164, p.raw_sample, p.format_status, p.wa_status, p.wa_checked_at,
         (SELECT COUNT(*) FROM company_phones x WHERE x.company_id = c.id) AS phone_count,
         (SELECT COUNT(DISTINCT y.company_id) FROM company_phones y WHERE y.phone_id = p.id) AS shared_count,
         (SELECT COUNT(*) FROM suppressions s WHERE s.phone_id = p.id AND s.lifted_at IS NULL) AS suppressed,
         (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.phone_id = p.id AND cc.status IN ('scheduled','sent','awaiting_reply','replied','qualifying','qualified','handed_off')) AS active_participations,
         (SELECT o.stage FROM opportunities o WHERE o.company_id = c.id ORDER BY o.updated_at DESC LIMIT 1) AS opportunity_stage
  FROM companies c
  LEFT JOIN phones p ON p.id = ${PRIMARY_PHONE}`;

export const leadsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx;

  app.post('/', { schema: { tags: ['leads'], body: CompanyCreate, response: { 201: Type.Object({ id: Type.Integer() }) } } }, async (req, reply) => {
    const result = await db.transaction((tx) => createCompany(tx, req.body, app.ctx.now()));
    return reply.code(201).send(result);
  });

  app.post('/:id/phones', { schema: { tags: ['leads'], params: IdParams, body: Type.Object({ phone: Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }), countryCode: Type.Optional(Nullable(Type.String({ pattern: '^[A-Z]{2}$' }))) }) } }, async (req) => {
    return db.transaction(async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, req.params.id)).for('update');
      if (!company) throw notFound('Empresa');
      return addCompanyPhone(tx, company.id, req.body.phone, req.body.countryCode !== undefined ? req.body.countryCode : company.countryCode, app.ctx.now());
    });
  });

  app.get(
    '/',
    {
      schema: {
        tags: ['leads'],
        querystring: Merge(Merge(LeadFilterQuery, Pagination), Type.Object({ sort: Type.Optional(StringEnum(LEAD_SORT_FIELDS)), direction: Type.Optional(StringEnum(['asc', 'desc'] as const)) })),
        response: { 200: Type.Object({ items: Type.Array(LeadRow), total: Type.Integer(), page: Type.Integer(), pageSize: Type.Integer() }) },
      },
    },
    async (req) => {
      const { page, pageSize, offset, limit } = pageArgs(req.query);
      const where = leadWhere(req.query as LeadFilters);
      const order = leadOrder(req.query.sort, req.query.direction);
      const [rowsRes, totalRes] = await Promise.all([
        db.execute(sql`SELECT * FROM (${LEAD_SELECT} WHERE ${where}) AS l ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`),
        db.execute(sql`SELECT COUNT(*) AS n FROM companies c WHERE ${where}`),
      ]);
      const rows = rowsRes[0] as unknown as RawLead[];
      const total = Number((totalRes[0] as unknown as { n: string }[])[0]?.n ?? 0);
      return { items: rows.map(mapLead), total, page, pageSize };
    },
  );

  app.get('/export.csv', { schema: { tags: ['leads'], querystring: LeadFilterQuery } }, async (req, reply) => {
    const where = leadWhere(req.query as LeadFilters);
    const [rows] = await db.execute(sql`${LEAD_SELECT} WHERE ${where} ORDER BY c.id LIMIT 50000`);
    const header = ['id', 'empresa', 'categoria', 'cidade', 'estado', 'pais', 'telefone_e164', 'telefone_original', 'formato', 'whatsapp', 'whatsapp_verificado_em', 'bloqueado', 'latitude', 'longitude'];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);

      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [header.join(',')];
    for (const r of (rows as unknown as RawLead[]).map(mapLead)) {
      lines.push(
        [r.id, r.name, r.category, r.city, r.state, r.countryCode, r.phoneE164, r.phoneRaw, r.formatStatus, r.waStatus, r.waCheckedAt, r.suppressed ? 'sim' : 'nao', r.latitude, r.longitude].map(esc).join(','),
      );
    }
    await audit(db, 'owner', 'leads.export', 'leads', null, { rows: lines.length - 1 });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="aero-leads-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('cache-control', 'no-store')
      .send(String.fromCharCode(0xfeff) + `${lines.join('\n')}\n`);
  });

  app.get(
    '/facets',
    { schema: { tags: ['leads'], response: { 200: Type.Object({ categories: Type.Array(Type.String()), cities: Type.Array(Type.String()) }) } } },
    async () => {
      const [cats] = await db.execute(sql`SELECT category AS v FROM companies WHERE category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC LIMIT 200`);
      const [cities] = await db.execute(sql`SELECT city AS v FROM companies WHERE city IS NOT NULL GROUP BY city ORDER BY COUNT(*) DESC LIMIT 200`);
      return {
        categories: (cats as unknown as { v: string }[]).map((r) => r.v),
        cities: (cities as unknown as { v: string }[]).map((r) => r.v),
      };
    },
  );

  app.get(
    '/map',
    {
      schema: {
        tags: ['leads'],
        querystring: Merge(LeadFilterQuery,
          Type.Object({
            west: Type.Number({ minimum: -180, maximum: 180 }),
            south: Type.Number({ minimum: -90, maximum: 90 }),
            east: Type.Number({ minimum: -180, maximum: 180 }),
            north: Type.Number({ minimum: -90, maximum: 90 }),
            zoom: Type.Number({ minimum: 0, maximum: 24 }),
          })),
        response: {
          200: Type.Object({
            mode: StringEnum(['points', 'grid'] as const),
            total: Type.Integer(),
            withoutCoords: Type.Integer(),
            points: Type.Array(Type.Object({ id: Type.Integer(), lat: Type.Number(), lng: Type.Number(), name: Type.String(), waStatus: Nullable(Type.String()), stage: Nullable(Type.String()) })),
            cells: Type.Array(Type.Object({ lat: Type.Number(), lng: Type.Number(), count: Type.Integer() })),
          }),
        },
      },
    },
    async (req) => {
      const { west, south, east, north, zoom, ...filters } = req.query;
      const where = leadWhere({ ...(filters as LeadFilters), hasCoords: undefined });

      const lngCond = west <= east ? sql`c.longitude BETWEEN ${west} AND ${east}` : sql`(c.longitude >= ${west} OR c.longitude <= ${east})`;
      const bbox = sql`c.latitude IS NOT NULL AND c.longitude IS NOT NULL AND c.latitude BETWEEN ${south} AND ${north} AND ${lngCond}`;
      const [[countRow], [noCoords]] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) AS n FROM companies c WHERE ${where} AND ${bbox}`).then((r) => r[0] as unknown as { n: string }[]),
        db.execute(sql`SELECT COUNT(*) AS n FROM companies c WHERE ${where} AND (c.latitude IS NULL OR c.longitude IS NULL)`).then((r) => r[0] as unknown as { n: string }[]),
      ]);
      const total = Number(countRow?.n ?? 0);
      const withoutCoords = Number(noCoords?.n ?? 0);
      const POINT_LIMIT = 4000;
      if (total <= POINT_LIMIT) {
        const [rows] = await db.execute(sql`
          SELECT c.id, c.latitude AS lat, c.longitude AS lng, c.name, p.wa_status,
                 (SELECT o.stage FROM opportunities o WHERE o.company_id = c.id ORDER BY o.updated_at DESC LIMIT 1) AS stage
          FROM companies c LEFT JOIN phones p ON p.id = ${PRIMARY_PHONE}
          WHERE ${where} AND ${bbox} LIMIT ${POINT_LIMIT}`);
        const points = (rows as unknown as RawLead[]).map((r) => ({
          id: Number(r.id),
          lat: Number(r.lat),
          lng: Number(r.lng),
          name: String(r.name),
          waStatus: (r.wa_status as string) ?? null,
          stage: (r.stage as string) ?? null,
        }));
        return { mode: 'points' as const, total, withoutCoords, points, cells: [] };
      }

      const cell = Math.max(0.0005, 360 / Math.pow(2, Math.floor(zoom) + 6));
      const [cells] = await db.execute(sql`
        SELECT AVG(c.latitude) AS lat, AVG(c.longitude) AS lng, COUNT(*) AS n
        FROM companies c WHERE ${where} AND ${bbox}
        GROUP BY FLOOR(c.latitude / ${cell}), FLOOR(c.longitude / ${cell}) LIMIT 5000`);
      return {
        mode: 'grid' as const,
        total,
        withoutCoords,
        points: [],
        cells: (cells as unknown as RawLead[]).map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), count: Number(r.n) })),
      };
    },
  );

  app.get('/:id', { schema: { tags: ['leads'], params: IdParams } }, async (req) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, req.params.id));
    if (!company) throw notFound('Empresa');
    const [phoneRows] = await db.execute(sql`
      SELECT p.*, cp.raw_value,
        (SELECT COUNT(DISTINCT y.company_id) FROM company_phones y WHERE y.phone_id = p.id) AS shared_count,
        (SELECT s.reason FROM suppressions s WHERE s.phone_id = p.id AND s.lifted_at IS NULL ORDER BY s.id DESC LIMIT 1) AS suppression_reason
      FROM company_phones cp JOIN phones p ON p.id = cp.phone_id WHERE cp.company_id = ${company.id} ORDER BY p.id`);
    const [scanRows] = await db.execute(sql`
      SELECT s.id, s.name, sr.is_new, sr.is_surplus, sr.created_at FROM scan_results sr JOIN scans s ON s.id = sr.scan_id
      WHERE sr.company_id = ${company.id} ORDER BY sr.id DESC LIMIT 50`);
    const [partRows] = await db.execute(sql`
      SELECT cc.id, cc.status, cc.status_reason, cc.first_sent_at, cc.replied_at, cm.id AS campaign_id, cm.name AS campaign_name, cm.service
      FROM campaign_contacts cc JOIN campaigns cm ON cm.id = cc.campaign_id WHERE cc.company_id = ${company.id} ORDER BY cc.id DESC`);
    const [oppRows] = await db.execute(sql`
      SELECT id, title, stage, service, updated_at FROM opportunities WHERE company_id = ${company.id} ORDER BY updated_at DESC`);
    const [convRows] = await db.execute(sql`
      SELECT DISTINCT cv.id, cv.state, cv.last_message_at FROM conversations cv
      JOIN company_phones cp ON cp.phone_id = cv.phone_id WHERE cp.company_id = ${company.id}`);
    return {
      company: {
        ...company,
        latitude: company.latitude === null ? null : Number(company.latitude),
        longitude: company.longitude === null ? null : Number(company.longitude),
        rating: company.rating === null ? null : Number(company.rating),
        raw: undefined,
      },
      phones: phoneRows,
      scans: scanRows,
      participations: partRows,
      opportunities: oppRows,
      conversations: convRows,
    };
  });

  app.patch(
    '/:id',
    { schema: { tags: ['leads'], params: IdParams, body: CompanyPatch } },
    async (req) => {
      await db.transaction((tx) => updateCompany(tx, req.params.id, req.body));
      return { ok: true };
    },
  );

  app.post(
    '/phones/:id/suppress',
    { schema: { tags: ['leads'], params: IdParams, body: Type.Object({ reason: Type.String({ minLength: 2, maxLength: 64 }), detail: Nullable(Type.String({ maxLength: 1000 })) }) } },
    async (req) => {
      await db.transaction((tx) => suppressPhone(tx, { phoneId: req.params.id, reason: req.body.reason, detail: req.body.detail, actor: 'owner', now: app.ctx.now() }));
      return { ok: true };
    },
  );

  app.post(
    '/phones/:id/unsuppress',
    { schema: { tags: ['leads'], params: IdParams, body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 255 }) }) } },
    async (req) => {
      await db.transaction((tx) => liftManualSuppression(tx, req.params.id, req.body.reason, app.ctx.now()));
      return { ok: true };
    },
  );

  app.post(
    '/validate',
    {
      schema: {
        tags: ['leads'],
        body: Type.Object({ phoneIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 500 })), scanId: Type.Optional(Type.Integer({ minimum: 1 })) }),
      },
    },
    async (req) => {
      const scope = req.body.scanId ? { kind: 'scan', scanId: req.body.scanId } : { kind: 'phones', phoneIds: req.body.phoneIds ?? [] };
      if (scope.kind === 'phones' && (req.body.phoneIds ?? []).length > 0) {

        await db.update(phones).set({ waStatus: 'pending' }).where(sql`${phones.id} IN (${sql.join((req.body.phoneIds ?? []).map((i) => sql`${i}`), sql`,`)}) AND ${phones.formatStatus} = 'valid'`);
      }
      await db.transaction((tx) => enqueue(tx, 'validation.run', { scope }));
      return { ok: true, queued: true };
    },
  );
};
