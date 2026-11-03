import { formatMoney } from '@aero/shared';
import type { Offer } from './types';

export function offerPrice(o: Pick<Offer, 'priceType' | 'priceCents' | 'currency'>): string {
  if (o.priceType === 'custom_quote') return 'Orçamento personalizado';
  if (o.priceCents === null) return '—';
  return `${o.priceType === 'starting_at' ? 'A partir de ' : ''}${formatMoney(o.priceCents, o.currency)}`;
}
