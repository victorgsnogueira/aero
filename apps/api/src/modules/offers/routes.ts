import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { desc, eq } from 'drizzle-orm';
import { PRICE_TYPES, SERVICES } from '@aero/shared';
import { offers } from '../../db/schema.ts';
import { Merge, Cents, CurrencyCode, IdParams, Nullable, StringEnum, iso } from '../../lib/schemas.ts';
import { getOffer, validateOfferPricing, type Offer } from './service.ts';
import { audit } from '../../core/audit.ts';

const OfferBody = Type.Object({
  service: StringEnum(SERVICES),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Nullable(Type.String({ maxLength: 4000 })),
  scope: Nullable(Type.String({ maxLength: 4000 })),
  priceType: StringEnum(PRICE_TYPES),
  priceCents: Nullable(Cents),
  setupCents: Nullable(Cents),
  monthlyCents: Nullable(Cents),
  currency: CurrencyCode,
  conditions: Nullable(Type.String({ maxLength: 4000 })),
  validUntil: Nullable(Type.String({ format: 'date' })),
});

const OfferSchema = Merge(OfferBody,
  Type.Object({ id: Type.Integer(), archived: Type.Boolean(), createdAt: Type.String(), updatedAt: Type.String() }));

const present = (o: Offer) => ({ ...o, createdAt: iso(o.createdAt)!, updatedAt: iso(o.updatedAt)! });

export const offersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx;

  app.get(
    '/',
    { schema: { tags: ['offers'], querystring: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }), response: { 200: Type.Array(OfferSchema) } } },
    async (req) => {
      const rows = await db
        .select()
        .from(offers)
        .where(req.query.includeArchived ? undefined : eq(offers.archived, false))
        .orderBy(desc(offers.id));
      return rows.map(present);
    },
  );

  app.get('/:id', { schema: { tags: ['offers'], params: IdParams, response: { 200: OfferSchema } } }, async (req) => present(await getOffer(db, req.params.id)));

  app.post('/', { schema: { tags: ['offers'], body: OfferBody, response: { 201: OfferSchema } } }, async (req, reply) => {
    validateOfferPricing(req.body);
    const id = await db.transaction(async (tx) => {
      const [res] = await tx.insert(offers).values(req.body).$returningId();
      await audit(tx, 'owner', 'offer.create', 'offer', res!.id);
      return res!.id;
    });
    return reply.code(201).send(present(await getOffer(db, id)));
  });

  app.put('/:id', { schema: { tags: ['offers'], params: IdParams, body: OfferBody, response: { 200: OfferSchema } } }, async (req) => {
    await getOffer(db, req.params.id);
    validateOfferPricing(req.body);
    await db.transaction(async (tx) => {
      await tx.update(offers).set(req.body).where(eq(offers.id, req.params.id));
      await audit(tx, 'owner', 'offer.update', 'offer', req.params.id);
    });
    return present(await getOffer(db, req.params.id));
  });

  app.post('/:id/archive', { schema: { tags: ['offers'], params: IdParams, response: { 200: OfferSchema } } }, async (req) => {
    await getOffer(db, req.params.id);
    await db.update(offers).set({ archived: true }).where(eq(offers.id, req.params.id));
    return present(await getOffer(db, req.params.id));
  });
};
