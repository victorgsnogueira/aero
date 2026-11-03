import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq, sql } from 'drizzle-orm';
import { CAMPAIGN_STATUSES, PARTICIPATION_STATUSES, SERVICES, PHONE_FORMAT_STATUSES, WA_STATUSES } from '@aero/shared';
import { campaigns, campaignContacts, companies, phones, messages } from '../../db/schema.ts';
import { Merge, IdParams, Nullable, Pagination, StringEnum, iso, pageArgs } from '../../lib/schemas.ts';
import { isValidTimezone } from '../../lib/schedule.ts';
import { badRequest } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';
import {
  addAudience,
  applyTemplateToPending,
  getCampaign,
  pendingDivergence,
  removeFromAudience,
  transitionCampaign,
  validateWindow,
  type Campaign,
} from './service.ts';
import { DEFAULT_DECLINE_ACK, DEFAULT_FIRST_MESSAGE, DEFAULT_PRESENTATION, DEFAULT_QUALIFICATION_DONE, DEFAULT_QUESTIONS, DEFAULT_SEND_DAYS } from './defaults.ts';
import { renderFor } from './render.ts';
import { getSettings, missingOutreachSettings } from '../settings/service.ts';
import { getOffer, snapshotOffer } from '../offers/service.ts';
import { checkEligibility, INELIGIBLE_LABELS, overlapCount } from './eligibility.ts';
import { ensureSessionRow, getSessionKey } from '../whatsapp/session.ts';

const Question = Type.Object({ key: Type.String({ pattern: '^[a-z0-9_]{1,40}$' }), text: Type.String({ minLength: 3, maxLength: 1000 }) });

const CampaignConfig = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  objective: Nullable(Type.String({ maxLength: 2000 })),
  offerId: Nullable(Type.Integer({ minimum: 1 })),
  firstMessageTemplate: Nullable(Type.String({ maxLength: 4000 })),
  presentationTemplate: Nullable(Type.String({ maxLength: 4000 })),
  qualificationQuestions: Type.Array(Question, { maxItems: 20 }),
  questionsPerMessage: Type.Integer({ minimum: 1, maximum: 3 }),
  qualificationDoneTemplate: Nullable(Type.String({ maxLength: 2000 })),
  declineAckTemplate: Nullable(Type.String({ maxLength: 1000 })),
  timezone: Type.String({ maxLength: 64 }),
  sendDays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7 }),
  sendWindowStart: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
  sendWindowEnd: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
  dailyLimit: Type.Integer({ minimum: 1, maximum: 500 }),
  noReplyCloseHours: Type.Integer({ minimum: 1, maximum: 24 * 60 }),
  audienceFilters: Nullable(Type.Record(Type.String(), Type.Unknown())),
});

const CampaignSchema = Merge(CampaignConfig,
  Type.Object({
    id: Type.Integer(),
    service: StringEnum(SERVICES),
    status: StringEnum(CAMPAIGN_STATUSES),
    isDemo: Type.Boolean(),
    startedAt: Nullable(Type.String()),
    pausedAt: Nullable(Type.String()),
    endedAt: Nullable(Type.String()),
    createdAt: Type.String(),
    counts: Type.Record(Type.String(), Type.Integer()),
  }));

async function counts(db: Parameters<typeof getCampaign>[0], id: number): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: campaignContacts.status, n: sql<number>`COUNT(*)` })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, id))
    .groupBy(campaignContacts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

const present = (c: Campaign, cnt: Record<string, number>) => ({
  ...c,
  qualificationQuestions: c.qualificationQuestions ?? [],
  audienceFilters: c.audienceFilters ?? null,
  startedAt: iso(c.startedAt),
  pausedAt: iso(c.pausedAt),
  endedAt: iso(c.endedAt),
  createdAt: iso(c.createdAt)!,
  counts: cnt,
});

export const campaignsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { ctx } = app;
  const { db } = ctx;

  app.get('/', { schema: { tags: ['campaigns'], response: { 200: Type.Array(CampaignSchema) } } }, async () => {
    const rows = await db.select().from(campaigns).orderBy(desc(campaigns.id)).limit(500);
    return Promise.all(rows.map(async (c) => present(c, await counts(db, c.id))));
  });

  app.get('/:id', { schema: { tags: ['campaigns'], params: IdParams } }, async (req) => {
    const c = await getCampaign(db, req.params.id);
    const offer = c.offerId ? await getOffer(db, c.offerId).catch(() => null) : null;
    const settings = await getSettings(db);
    return {
      campaign: present(c, await counts(db, c.id)),
      offer,
      overlap: await overlapCount(db, c.id),
      missingSettings: missingOutreachSettings(settings),
    };
  });

  app.post(
    '/',
    { schema: { tags: ['campaigns'], body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 160 }), service: StringEnum(SERVICES), offerId: Nullable(Type.Integer({ minimum: 1 })) }) } },
    async (req, reply) => {
      const settings = await getSettings(db);
      const { service } = req.body;
      const id = await db.transaction(async (tx) => {
        const [res] = await tx
          .insert(campaigns)
          .values({
            name: req.body.name,
            service,
            offerId: req.body.offerId,
            firstMessageTemplate: DEFAULT_FIRST_MESSAGE[service],
            presentationTemplate: DEFAULT_PRESENTATION[service],
            qualificationQuestions: DEFAULT_QUESTIONS[service],
            qualificationDoneTemplate: DEFAULT_QUALIFICATION_DONE,
            declineAckTemplate: DEFAULT_DECLINE_ACK,
            timezone: settings.defaultTimezone,
            sendDays: DEFAULT_SEND_DAYS,
          })
          .$returningId();
        await audit(tx, 'owner', 'campaign.create', 'campaign', res!.id, { service });
        return res!.id;
      });
      const c = await getCampaign(db, id);
      return reply.code(201).send(present(c, {}));
    },
  );

  app.put('/:id', { schema: { tags: ['campaigns'], params: IdParams, body: CampaignConfig } }, async (req) => {
    const c = await getCampaign(db, req.params.id);
    if (c.status === 'completed' || c.status === 'cancelled') throw badRequest('campaign_closed', 'Campanha encerrada não pode ser editada');
    if (!isValidTimezone(req.body.timezone)) throw badRequest('invalid_timezone', 'Fuso horário inválido');
    validateWindow(req.body);
    const keys = req.body.qualificationQuestions.map((q) => q.key);
    if (new Set(keys).size !== keys.length) throw badRequest('duplicate_question_key', 'Chaves de perguntas devem ser únicas');
    if (req.body.offerId) {
      const offer = await getOffer(db, req.body.offerId);
      if (offer.service !== c.service) throw badRequest('offer_service_mismatch', 'A oferta deve ser do mesmo serviço da campanha');
    }
    await db.transaction(async (tx) => {
      await tx.update(campaigns).set(req.body).where(eq(campaigns.id, c.id));
      await audit(tx, 'owner', 'campaign.update', 'campaign', c.id);
    });
    await ctx.events.publish({ type: 'campaign.updated', campaignId: c.id });
    const updated = await getCampaign(db, c.id);
    return present(updated, await counts(db, c.id));
  });

  app.post('/:id/status', { schema: { tags: ['campaigns'], params: IdParams, body: Type.Object({ to: StringEnum(CAMPAIGN_STATUSES) }) } }, async (req) => {
    const c = await transitionCampaign(ctx, req.params.id, req.body.to);
    return present(c, await counts(db, c.id));
  });

  app.post(
    '/:id/preview',
    {
      schema: {
        tags: ['campaigns'],
        params: IdParams,
        body: Type.Object({ template: Type.String({ maxLength: 4000 }), companyId: Type.Optional(Type.Integer({ minimum: 1 })) }),
        response: { 200: Type.Object({ text: Type.String(), missing: Type.Array(Type.String()), unknown: Type.Array(Type.String()), companyName: Nullable(Type.String()) }) },
      },
    },
    async (req) => {
      const c = await getCampaign(db, req.params.id);
      const settings = await getSettings(db);
      const offer = c.offerId ? snapshotOffer(await getOffer(db, c.offerId), ctx.now()) : null;
      let company: { name: string; category: string | null; city: string | null } | null = null;
      if (req.body.companyId) {
        const [row] = await db.select({ name: companies.name, category: companies.category, city: companies.city }).from(companies).where(eq(companies.id, req.body.companyId));
        company = row ?? null;
      } else {
        const [row] = await db
          .select({ name: companies.name, category: companies.category, city: companies.city })
          .from(campaignContacts)
          .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
          .where(eq(campaignContacts.campaignId, c.id))
          .limit(1);
        company = row ?? null;
      }
      const r = renderFor(req.body.template, settings, company, offer);
      return { ...r, companyName: company?.name ?? null };
    },
  );

  app.get(
    '/:id/contacts',
    {
      schema: {
        tags: ['campaigns'],
        params: IdParams,
        querystring: Merge(Pagination, Type.Object({ status: Type.Optional(StringEnum(PARTICIPATION_STATUSES)) })),
      },
    },
    async (req) => {
      const { page, pageSize, offset, limit } = pageArgs(req.query);
      const where = and(eq(campaignContacts.campaignId, req.params.id), req.query.status ? eq(campaignContacts.status, req.query.status) : undefined);
      const [rows, [{ n } = { n: 0 }]] = await Promise.all([
        db
          .select({
            id: campaignContacts.id,
            status: campaignContacts.status,
            statusReason: campaignContacts.statusReason,
            firstSentAt: campaignContacts.firstSentAt,
            repliedAt: campaignContacts.repliedAt,
            companyId: companies.id,
            companyName: companies.name,
            city: companies.city,
            phoneId: phones.id,
            e164: phones.e164,
            waStatus: phones.waStatus,
            formatStatus: phones.formatStatus,
          })
          .from(campaignContacts)
          .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
          .innerJoin(phones, eq(phones.id, campaignContacts.phoneId))
          .where(where)
          .orderBy(desc(campaignContacts.id))
          .limit(limit)
          .offset(offset),
        db.select({ n: sql<number>`COUNT(*)` }).from(campaignContacts).where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...r, firstSentAt: iso(r.firstSentAt), repliedAt: iso(r.repliedAt) })),
        total: Number(n),
        page,
        pageSize,
      };
    },
  );

  app.get('/:id/eligibility', { schema: { tags: ['campaigns'], params: IdParams } }, async (req) => {
    const c = await getCampaign(db, req.params.id);
    const settings = await getSettings(db);
    const session = await ensureSessionRow(db, getSessionKey(ctx));
    const sel = await db
      .select({ id: campaignContacts.id, phoneId: campaignContacts.phoneId, companyName: companies.name, e164: phones.e164 })
      .from(campaignContacts)
      .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
      .innerJoin(phones, eq(phones.id, campaignContacts.phoneId))
      .where(and(eq(campaignContacts.campaignId, c.id), eq(campaignContacts.status, 'selected')))
      .limit(1000);
    const summary: Record<string, number> = { eligible: 0 };
    const items = [];
    for (const s of sel) {
      const reasons = await checkEligibility(db, {
        phoneId: s.phoneId,
        campaignId: c.id,
        sessionId: session.id,
        revalidateDays: settings.validationRevalidateDays,
        allowlist: ctx.config.sending.allowlist,
        now: ctx.now(),
      });
      if (!reasons.length) summary.eligible = (summary.eligible ?? 0) + 1;
      for (const r of reasons) summary[r] = (summary[r] ?? 0) + 1;
      items.push({ ...s, reasons: reasons.map((r) => ({ code: r, label: INELIGIBLE_LABELS[r] })) });
    }
    return { total: sel.length, summary, items: items.slice(0, 200) };
  });

  app.post(
    '/:id/contacts',
    {
      schema: {
        tags: ['campaigns'],
        params: IdParams,
        body: Type.Object({
          companyIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 5000 })),
          filters: Type.Optional(
            Type.Object({
              q: Type.Optional(Type.String()),
              scanId: Type.Optional(Type.Integer()),
              category: Type.Optional(Type.String()),
              city: Type.Optional(Type.String()),
              waStatus: Type.Optional(StringEnum(WA_STATUSES)),
              formatStatus: Type.Optional(StringEnum(PHONE_FORMAT_STATUSES)),
              suppressed: Type.Optional(Type.Boolean()),
              includeDemo: Type.Optional(Type.Boolean()),
            }),
          ),
        }),
      },
    },
    async (req) => {
      const res = await addAudience(db, req.params.id, { companyIds: req.body.companyIds, filters: req.body.filters ? { ...req.body.filters, suppressed: false } : undefined });
      await ctx.events.publish({ type: 'campaign.updated', campaignId: req.params.id });
      return res;
    },
  );

  app.post(
    '/:id/contacts/remove',
    { schema: { tags: ['campaigns'], params: IdParams, body: Type.Object({ ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 1000 }) }) } },
    async (req) => ({ removed: await removeFromAudience(db, req.params.id, req.body.ids) }),
  );

  app.get('/:id/pending', { schema: { tags: ['campaigns'], params: IdParams } }, async (req) => {
    const rows = await db
      .select({ id: messages.id, body: messages.body, scheduledFor: messages.scheduledFor, error: messages.error, purpose: messages.purpose, conversationId: messages.conversationId, companyName: companies.name })
      .from(messages)
      .innerJoin(campaignContacts, eq(campaignContacts.id, messages.campaignContactId))
      .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
      .where(and(eq(messages.campaignId, req.params.id), eq(messages.status, 'scheduled')))
      .orderBy(messages.scheduledFor)
      .limit(500);
    return {
      items: rows.map((r) => ({ ...r, scheduledFor: iso(r.scheduledFor) })),
      divergent: await pendingDivergence(ctx, req.params.id),
    };
  });

  app.post(
    '/:id/pending/apply-template',
    { schema: { tags: ['campaigns'], params: IdParams, body: Type.Object({ messageIds: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 500 }) }) } },
    async (req) => ({ updated: await applyTemplateToPending(ctx, req.params.id, req.body.messageIds) }),
  );
};
