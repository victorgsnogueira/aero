import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { offers, type OfferSnapshot } from '../../db/schema.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import type { PriceType } from '@aero/shared';

export type Offer = typeof offers.$inferSelect;

export function validateOfferPricing(o: { priceType: PriceType; priceCents?: number | null }): void {
  if ((o.priceType === 'fixed' || o.priceType === 'starting_at') && (o.priceCents === null || o.priceCents === undefined)) {
    throw badRequest('price_required', 'Informe o preço para "preço fixo" ou "a partir de"');
  }
}

export async function getOffer(db: DbOrTx, id: number): Promise<Offer> {
  const [row] = await db.select().from(offers).where(eq(offers.id, id));
  if (!row) throw notFound('Oferta');
  return row;
}

/** Cópia imutável da oferta no momento em que é apresentada. */
export function snapshotOffer(o: Offer, now: Date): OfferSnapshot {
  return {
    offerId: o.id,
    service: o.service,
    name: o.name,
    description: o.description,
    scope: o.scope,
    priceType: o.priceType,
    priceCents: o.priceCents,
    setupCents: o.setupCents,
    monthlyCents: o.monthlyCents,
    currency: o.currency,
    conditions: o.conditions,
    validUntil: o.validUntil,
    capturedAt: now.toISOString(),
  };
}
