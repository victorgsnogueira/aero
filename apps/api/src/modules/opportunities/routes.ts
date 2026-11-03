import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq, sql } from 'drizzle-orm';
import { OPPORTUNITY_STAGES, PROPOSAL_STATUSES, SERVICES } from '@aero/shared';
import { opportunities, opportunityStageHistory, payments, proposals, companies } from '../../db/schema.ts';
import { Merge, Cents, CurrencyCode, IdParams, Nullable, Pagination, StringEnum, iso, pageArgs } from '../../lib/schemas.ts';
import { badRequest, conflict } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';
import { changeStage, createOpportunity, getOpportunity, getProposal, paymentStatus } from './service.ts';

const ProposalBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 255 }),
  scope: Nullable(Type.String({ maxLength: 10000 })),
  amountCents: Cents,
  setupCents: Nullable(Cents),
  monthlyCents: Nullable(Cents),
  currency: CurrencyCode,
  conditions: Nullable(Type.String({ maxLength: 4000 })),
  validUntil: Nullable(Type.String({ format: 'date' })),
  origin: Nullable(Type.String({ maxLength: 64 })),
});

export const opportunitiesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { ctx } = app;
  const { db } = ctx;

  app.get(
    '/',
    {
      schema: {
        tags: ['opportunities'],
        querystring: Merge(Pagination,
          Type.Object({ stage: Type.Optional(StringEnum(OPPORTUNITY_STAGES)), service: Type.Optional(StringEnum(SERVICES)), campaignId: Type.Optional(Type.Integer()) })),
      },
    },
    async (req) => {
      const { page, pageSize, offset, limit } = pageArgs({ pageSize: 200, ...req.query });
      const where = and(
        req.query.stage ? eq(opportunities.stage, req.query.stage) : undefined,
        req.query.service ? eq(opportunities.service, req.query.service) : undefined,
        req.query.campaignId ? eq(opportunities.campaignId, req.query.campaignId) : undefined,
      );
      const rows = await db
        .select({ o: opportunities, companyName: companies.name, city: companies.city })
        .from(opportunities)
        .innerJoin(companies, eq(companies.id, opportunities.companyId))
        .where(where)
        .orderBy(desc(opportunities.updatedAt))
        .limit(limit)
        .offset(offset);
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`COUNT(*)` }).from(opportunities).where(where);
      return {
        items: rows.map((r) => ({
          ...r.o,
          companyName: r.companyName,
          city: r.city,
          nextActionDueAt: iso(r.o.nextActionDueAt),
          wonAt: iso(r.o.wonAt),
          lostAt: iso(r.o.lostAt),
          createdAt: iso(r.o.createdAt),
          updatedAt: iso(r.o.updatedAt),
        })),
        total: Number(n),
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/proposals',
    { schema: { tags: ['opportunities'], querystring: Merge(Pagination, Type.Object({ status: Type.Optional(StringEnum(PROPOSAL_STATUSES)) })) } },
    async (req) => {
      const { page, pageSize, offset, limit } = pageArgs(req.query);
      const where = req.query.status ? eq(proposals.status, req.query.status) : undefined;
      const rows = await db
        .select({ p: proposals, oppTitle: opportunities.title, stage: opportunities.stage, companyName: companies.name })
        .from(proposals)
        .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
        .innerJoin(companies, eq(companies.id, opportunities.companyId))
        .where(where)
        .orderBy(desc(proposals.updatedAt))
        .limit(limit)
        .offset(offset);
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`COUNT(*)` }).from(proposals).where(where);
      const items = await Promise.all(
        rows.map(async (r) => {
          const st = await paymentStatus(db, r.p);
          return {
            ...r.p,
            opportunityTitle: r.oppTitle,
            stage: r.stage,
            companyName: r.companyName,
            sentAt: iso(r.p.sentAt),
            acceptedAt: iso(r.p.acceptedAt),
            rejectedAt: iso(r.p.rejectedAt),
            createdAt: iso(r.p.createdAt),
            updatedAt: iso(r.p.updatedAt),
            paymentStatus: st.status,
            receivedCents: st.receivedCents,
          };
        }),
      );
      return { items, total: Number(n), page, pageSize };
    },
  );

  app.get('/:id', { schema: { tags: ['opportunities'], params: IdParams } }, async (req) => {
    const o = await getOpportunity(db, req.params.id);
    const [company] = await db.select({ id: companies.id, name: companies.name, city: companies.city }).from(companies).where(eq(companies.id, o.companyId));
    const history = await db.select().from(opportunityStageHistory).where(eq(opportunityStageHistory.opportunityId, o.id)).orderBy(desc(opportunityStageHistory.id));
    const props = await db.select().from(proposals).where(eq(proposals.opportunityId, o.id)).orderBy(desc(proposals.id));
    const withPayments = await Promise.all(
      props.map(async (p) => {
        const pays = await db.select().from(payments).where(eq(payments.proposalId, p.id)).orderBy(desc(payments.receivedAt));
        const st = await paymentStatus(db, p);
        return {
          ...p,
          sentAt: iso(p.sentAt),
          acceptedAt: iso(p.acceptedAt),
          rejectedAt: iso(p.rejectedAt),
          createdAt: iso(p.createdAt),
          paymentStatus: st.status,
          receivedCents: st.receivedCents,
          payments: pays.map((x) => ({ ...x, receivedAt: iso(x.receivedAt), createdAt: iso(x.createdAt) })),
        };
      }),
    );
    return {
      opportunity: { ...o, nextActionDueAt: iso(o.nextActionDueAt), wonAt: iso(o.wonAt), lostAt: iso(o.lostAt), createdAt: iso(o.createdAt), updatedAt: iso(o.updatedAt) },
      company,
      history: history.map((h) => ({ ...h, createdAt: iso(h.createdAt) })),
      proposals: withPayments,
    };
  });

  app.post(
    '/',
    {
      schema: {
        tags: ['opportunities'],
        body: Type.Object({
          companyId: Type.Integer({ minimum: 1 }),
          service: StringEnum(SERVICES),
          title: Type.String({ minLength: 1, maxLength: 255 }),
          stage: Type.Optional(StringEnum(['presentation', 'qualification', 'proposal', 'negotiation'] as const)),
          conversationId: Nullable(Type.Integer({ minimum: 1 })),
        }),
      },
    },
    async (req, reply) => {
      const id = await db.transaction((tx) =>
        createOpportunity(tx, { ...req.body, stage: req.body.stage ?? 'presentation', actor: 'owner', reason: 'Criada manualmente' }),
      );
      return reply.code(201).send({ id });
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['opportunities'],
        params: IdParams,
        body: Type.Partial(
          Type.Object({
            title: Type.String({ minLength: 1, maxLength: 255 }),
            notes: Nullable(Type.String({ maxLength: 10000 })),
            nextAction: Nullable(Type.String({ maxLength: 255 })),
            nextActionDueAt: Nullable(Type.String({ format: 'date-time' })),
          }),
        ),
      },
    },
    async (req) => {
      await getOpportunity(db, req.params.id);
      const { nextActionDueAt, ...rest } = req.body;
      await db
        .update(opportunities)
        .set({ ...rest, ...(nextActionDueAt !== undefined ? { nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt) : null } : {}) })
        .where(eq(opportunities.id, req.params.id));
      await ctx.events.publish({ type: 'opportunity.updated', opportunityId: req.params.id });
      return { ok: true };
    },
  );

  app.post(
    '/:id/stage',
    { schema: { tags: ['opportunities'], params: IdParams, body: Type.Object({ stage: StringEnum(OPPORTUNITY_STAGES), reason: Nullable(Type.String({ maxLength: 255 })) }) } },
    async (req) => {
      await db.transaction((tx) => changeStage(tx, req.params.id, req.body.stage, 'owner', req.body.reason, ctx.now()));
      await ctx.events.publish({ type: 'opportunity.updated', opportunityId: req.params.id });
      return { ok: true };
    },
  );

  app.post('/:id/proposals', { schema: { tags: ['opportunities'], params: IdParams, body: ProposalBody } }, async (req, reply) => {
    const o = await getOpportunity(db, req.params.id);
    const id = await db.transaction(async (tx) => {
      const [res] = await tx.insert(proposals).values({ ...req.body, opportunityId: o.id, service: o.service, status: 'draft' }).$returningId();
      await audit(tx, 'owner', 'proposal.create', 'proposal', res!.id, { amountCents: req.body.amountCents, currency: req.body.currency });
      return res!.id;
    });
    return reply.code(201).send({ id });
  });

  app.put('/proposals/:id', { schema: { tags: ['opportunities'], params: IdParams, body: ProposalBody } }, async (req) => {
    const p = await getProposal(db, req.params.id);
    if (p.status !== 'draft') throw conflict('proposal_locked', 'Somente rascunhos podem ser alterados; crie uma nova proposta');
    await db.update(proposals).set(req.body).where(eq(proposals.id, p.id));
    return { ok: true };
  });

  app.post(
    '/proposals/:id/status',
    { schema: { tags: ['opportunities'], params: IdParams, body: Type.Object({ status: StringEnum(PROPOSAL_STATUSES), reason: Nullable(Type.String({ maxLength: 255 })) }) } },
    async (req) => {
      const p = await getProposal(db, req.params.id);
      const to = req.body.status;
      const allowed: Record<string, string[]> = {
        draft: ['sent', 'withdrawn'],
        sent: ['accepted', 'rejected', 'expired', 'withdrawn'],
        accepted: ['withdrawn'],
        rejected: [],
        expired: ['sent'],
        withdrawn: [],
      };
      if (!allowed[p.status]?.includes(to)) throw conflict('invalid_transition', `Transição inválida: ${p.status} → ${to}`);
      const now = ctx.now();
      await db.transaction(async (tx) => {
        await tx
          .update(proposals)
          .set({
            status: to,
            sentAt: to === 'sent' ? (p.sentAt ?? now) : p.sentAt,
            acceptedAt: to === 'accepted' ? now : p.acceptedAt,
            rejectedAt: to === 'rejected' ? now : p.rejectedAt,
          })
          .where(eq(proposals.id, p.id));
        await audit(tx, 'owner', `proposal.${to}`, 'proposal', p.id);
        const opp = await getOpportunity(tx, p.opportunityId);
        if (to === 'sent' && ['presentation', 'qualification'].includes(opp.stage)) await changeStage(tx, opp.id, 'proposal', 'system', 'Proposta enviada', now);
        if (to === 'accepted') await changeStage(tx, opp.id, 'won', 'owner', 'Proposta aceita', now);
      });
      await ctx.events.publish({ type: 'opportunity.updated', opportunityId: p.opportunityId });
      return { ok: true };
    },
  );

  app.post(
    '/proposals/:id/payments',
    {
      schema: {
        tags: ['opportunities'],
        params: IdParams,
        body: Type.Object({
          amountCents: Type.Integer({ minimum: 1, maximum: 9_000_000_000_000 }),
          currency: CurrencyCode,
          receivedAt: Type.String({ format: 'date-time' }),
          method: Nullable(Type.String({ maxLength: 64 })),
          note: Nullable(Type.String({ maxLength: 255 })),
        }),
      },
    },
    async (req, reply) => {
      const p = await getProposal(db, req.params.id);
      if (p.status !== 'accepted') throw conflict('proposal_not_accepted', 'Registre pagamentos somente em propostas aceitas');
      if (req.body.currency !== p.currency) throw badRequest('currency_mismatch', `A proposta está em ${p.currency}`);
      const id = await db.transaction(async (tx) => {
        const [res] = await tx.insert(payments).values({ ...req.body, proposalId: p.id, receivedAt: new Date(req.body.receivedAt) }).$returningId();
        await audit(tx, 'owner', 'payment.create', 'payment', res!.id, { proposalId: p.id, amountCents: req.body.amountCents });
        return res!.id;
      });
      await ctx.events.publish({ type: 'opportunity.updated', opportunityId: p.opportunityId });
      return reply.code(201).send({ id, ...(await paymentStatus(db, p)) });
    },
  );

  app.delete('/payments/:id', { schema: { tags: ['opportunities'], params: IdParams } }, async (req) => {
    await db.transaction(async (tx) => {
      const [pay] = await tx.select().from(payments).where(eq(payments.id, req.params.id));
      if (!pay) return;
      await tx.delete(payments).where(eq(payments.id, req.params.id));
      await audit(tx, 'owner', 'payment.delete', 'payment', req.params.id, { proposalId: pay.proposalId, amountCents: pay.amountCents });
    });
    return { ok: true };
  });
};
