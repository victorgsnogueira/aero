import { formatMoney, PRICE_TYPE_LABELS, renderTemplate, type RenderResult, type TemplateValues } from '@aero/shared';
import type { OfferSnapshot } from '../../db/schema.ts';
import type { OperatorSettings } from '../settings/service.ts';

export function offerPriceText(o: Pick<OfferSnapshot, 'priceType' | 'priceCents' | 'currency'> | null): string | null {
  if (!o) return null;
  if (o.priceType === 'custom_quote') return 'orçamento personalizado';
  if (o.priceCents === null) return null;
  const v = formatMoney(o.priceCents, o.currency);
  return o.priceType === 'starting_at' ? `${PRICE_TYPE_LABELS.starting_at.toLowerCase()} ${v}` : v;
}

export function templateValues(
  settings: Pick<OperatorSettings, 'senderName' | 'companyName'>,
  company: { name: string; category: string | null; city: string | null } | null,
  offer: OfferSnapshot | null,
): TemplateValues {
  return {
    remetente_nome: settings.senderName,
    remetente_empresa: settings.companyName,
    empresa_lead: company?.name,
    categoria_lead: company?.category,
    cidade_lead: company?.city,
    oferta_nome: offer?.name,
    oferta_preco: offerPriceText(offer),
    oferta_implantacao: offer?.setupCents != null ? formatMoney(offer.setupCents, offer.currency) : null,
    oferta_mensalidade: offer?.monthlyCents != null ? formatMoney(offer.monthlyCents, offer.currency) : null,
  };
}

export function renderFor(
  template: string,
  settings: Pick<OperatorSettings, 'senderName' | 'companyName'>,
  company: { name: string; category: string | null; city: string | null } | null,
  offer: OfferSnapshot | null,
): RenderResult {
  return renderTemplate(template, templateValues(settings, company, offer));
}
