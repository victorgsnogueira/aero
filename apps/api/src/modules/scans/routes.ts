import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { count, desc } from 'drizzle-orm';
import { SCAN_MODES, SCAN_STATUSES, SCAN_TARGET_KINDS, SCAN_UNIT_STATUSES } from '@aero/shared';
import { scans } from '../../db/schema.ts';
import { IdParams, Nullable, Pagination, StringEnum, iso, pageArgs, paged } from '../../lib/schemas.ts';
import { cancelScan, createScan, getScan, listUnits, pauseScan, recomputeCounters, regionLabel, resumeScan, startScan, targetProgress, type Scan } from './service.ts';
import { getSettings } from '../settings/service.ts';
import { badRequest } from '../../core/errors.ts';

const ScanSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  segment: Nullable(Type.String()),
  category: Nullable(Type.String()),
  keywords: Type.Array(Type.String()),
  neighborhood: Nullable(Type.String()),
  city: Nullable(Type.String()),
  state: Nullable(Type.String()),
  country: Nullable(Type.String()),
  countryCode: Nullable(Type.String()),
  regionLabel: Type.String(),
  language: Type.String(),
  mode: StringEnum(SCAN_MODES),
  targetKind: StringEnum(SCAN_TARGET_KINDS),
  targetCount: Type.Integer(),
  targetProgress: Type.Integer(),
  campaignId: Nullable(Type.Integer()),
  depth: Type.Integer(),
  unitMaxSeconds: Type.Integer(),
  maxUnits: Type.Integer(),
  maxDurationMinutes: Type.Integer(),
  status: StringEnum(SCAN_STATUSES),
  statusReason: Nullable(Type.String()),
  lastError: Nullable(Type.String()),
  placesFound: Type.Integer(),
  phonesFound: Type.Integer(),
  newRecords: Type.Integer(),
  duplicates: Type.Integer(),
  uniquePhones: Type.Integer(),
  waConfirmed: Type.Integer(),
  waInconclusive: Type.Integer(),
  surplus: Type.Integer(),
  startedAt: Nullable(Type.String()),
  finishedAt: Nullable(Type.String()),
  createdAt: Type.String(),
});

const UnitSchema = Type.Object({
  id: Type.Integer(),
  seq: Type.Integer(),
  query: Type.String(),
  depth: Type.Integer(),
  status: StringEnum(SCAN_UNIT_STATUSES),
  attempts: Type.Integer(),
  placesFound: Type.Integer(),
  newRecords: Type.Integer(),
  duplicates: Type.Integer(),
  error: Nullable(Type.String()),
  submittedAt: Nullable(Type.String()),
  finishedAt: Nullable(Type.String()),
});

const CreateScanBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  segment: Nullable(Type.String({ maxLength: 160 })),
  category: Nullable(Type.String({ maxLength: 160 })),
  keywords: Type.Array(Type.String({ minLength: 2, maxLength: 120 }), { minItems: 1, maxItems: 20 }),
  neighborhood: Nullable(Type.String({ maxLength: 160 })),
  city: Nullable(Type.String({ maxLength: 160 })),
  state: Nullable(Type.String({ maxLength: 120 })),
  country: Nullable(Type.String({ maxLength: 120 })),
  countryCode: Nullable(Type.String({ pattern: '^[A-Z]{2}$', description: 'País usado para normalizar telefones' })),
  language: Type.String({ pattern: '^[a-z]{2}$', description: 'Idioma (2 letras) suportado pelo scraper' }),
  mode: StringEnum(SCAN_MODES),
  targetKind: StringEnum(SCAN_TARGET_KINDS),
  targetCount: Type.Integer({ minimum: 1, maximum: 5000 }),
  campaignId: Nullable(Type.Integer({ minimum: 1 })),
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  unitMaxSeconds: Type.Optional(Type.Integer({ minimum: 180, maximum: 3600 })),
  maxUnits: Type.Integer({ minimum: 1, maximum: 200 }),
  maxDurationMinutes: Type.Integer({ minimum: 5, maximum: 24 * 60 }),
  startNow: Type.Optional(Type.Boolean()),
});

export function presentScan(s: Scan) {
  return {
    ...s,
    regionLabel: regionLabel(s),
    targetProgress: targetProgress(s),
    startedAt: iso(s.startedAt),
    finishedAt: iso(s.finishedAt),
    createdAt: iso(s.createdAt)!,
  };
}

export const scansRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx;

  app.get('/', { schema: { tags: ['scans'], querystring: Pagination, response: { 200: paged(ScanSchema) } } }, async (req) => {
    const { page, pageSize, offset, limit } = pageArgs(req.query);
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db.select().from(scans).orderBy(desc(scans.id)).limit(limit).offset(offset),
      db.select({ total: count() }).from(scans),
    ]);
    return { items: rows.map(presentScan), total, page, pageSize };
  });

  app.get(
    '/:id',
    { schema: { tags: ['scans'], params: IdParams, response: { 200: Type.Object({ scan: ScanSchema, units: Type.Array(UnitSchema) }) } } },
    async (req) => {
      const scan = await getScan(db, req.params.id);
      const units = await listUnits(db, scan.id);
      return {
        scan: presentScan(scan),
        units: units.map((u) => ({ ...u, submittedAt: iso(u.submittedAt), finishedAt: iso(u.finishedAt) })),
      };
    },
  );

  app.post('/', { schema: { tags: ['scans'], body: CreateScanBody, response: { 201: ScanSchema } } }, async (req, reply) => {
    const b = req.body;
    if (b.targetKind === 'whatsapp_confirmed' && b.mode !== 'collect_and_validate') {
      throw badRequest('target_requires_validation', 'A meta de WhatsApps confirmados exige o modo "Coletar e validar WhatsApp"');
    }
    if (![b.neighborhood, b.city, b.state, b.country].some((x) => x && x.trim())) {
      throw badRequest('region_required', 'Informe ao menos um campo de região');
    }
    const settings = await getSettings(db);
    const { startNow, ...rest } = b;
    const id = await createScan(db, {
      ...rest,
      depth: b.depth ?? settings.scanDefaultDepth,
      unitMaxSeconds: b.unitMaxSeconds ?? settings.scanUnitMaxSeconds,
    });
    if (startNow) await startScan(db, id, app.ctx.now());
    return reply.code(201).send(presentScan(await getScan(db, id)));
  });

  app.post('/:id/start', { schema: { tags: ['scans'], params: IdParams, response: { 200: ScanSchema } } }, async (req) => {
    await startScan(db, req.params.id, app.ctx.now());
    return presentScan(await getScan(db, req.params.id));
  });
  app.post('/:id/pause', { schema: { tags: ['scans'], params: IdParams, response: { 200: ScanSchema } } }, async (req) => {
    await pauseScan(db, req.params.id);
    return presentScan(await getScan(db, req.params.id));
  });
  app.post('/:id/resume', { schema: { tags: ['scans'], params: IdParams, response: { 200: ScanSchema } } }, async (req) => {
    await resumeScan(db, req.params.id);
    return presentScan(await getScan(db, req.params.id));
  });
  app.post('/:id/cancel', { schema: { tags: ['scans'], params: IdParams, response: { 200: ScanSchema } } }, async (req) => {
    await cancelScan(db, req.params.id);
    return presentScan(await getScan(db, req.params.id));
  });
  app.post('/:id/recount', { schema: { tags: ['scans'], params: IdParams, response: { 200: ScanSchema } } }, async (req) => {
    await getScan(db, req.params.id);
    await recomputeCounters(db, req.params.id);
    return presentScan(await getScan(db, req.params.id));
  });
};
