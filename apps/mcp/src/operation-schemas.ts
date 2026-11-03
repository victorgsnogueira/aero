import * as z from 'zod/v4';
import { OPPORTUNITY_STAGES, PRICE_TYPES, PROPOSAL_STATUSES, SERVICES } from '@aero/shared';
import { id, pagination } from './schemas.ts';

const text = (max: number) => z.string().max(max).nullable();
export const cents = z.number().int().min(0).max(9_000_000_000_000);
export const currency = z.string().regex(/^[A-Z]{3}$/);
const datetime = z.iso.datetime({ offset: true });
const nonempty = (obj: object) => Object.values(obj).some((value) => value !== undefined);
export const settingsPatch = z.object({
  senderName: text(120).optional(), companyName: text(160).optional(), introduction: text(2000).optional(),
  defaultTimezone: z.string().min(1).max(64).optional(), defaultCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
  sendMinIntervalSeconds: z.number().int().min(30).max(3600).optional(), sendDailyLimit: z.number().int().min(1).max(500).optional(),
  sendHourlyLimit: z.number().int().min(1).max(100).optional(), validationRevalidateDays: z.number().int().min(1).max(365).optional(),
  validationBatchSize: z.number().int().min(1).max(50).optional(), validationMinIntervalMs: z.number().int().min(1000).max(60000).optional(),
  scanDefaultDepth: z.number().int().min(1).max(100).optional(), scanUnitMaxSeconds: z.number().int().min(180).max(3600).optional(),
}).strict().refine(nonempty, 'Informe ao menos um campo');

// Create defaults and update inputs are separate: updates must never reset omitted values to defaults.
const offerFields = {
  service: z.enum(SERVICES), name: z.string().trim().min(1).max(160), description: text(4000), scope: text(4000),
  priceType: z.enum(PRICE_TYPES), priceCents: cents.nullable(), setupCents: cents.nullable(), monthlyCents: cents.nullable(),
  currency, conditions: text(4000), validUntil: z.iso.date().nullable(),
};
const offerPricing = (x: { priceType: string; priceCents: number | null }) => x.priceType === 'custom_quote' || x.priceCents !== null;
export const offerBody = z.object(offerFields).refine(offerPricing, 'Preço obrigatório para fixed/starting_at');
export const offerCreate = z.object({ ...offerFields, description: text(4000).default(null), scope: text(4000).default(null), priceCents: cents.nullable().default(null), setupCents: cents.nullable().default(null), monthlyCents: cents.nullable().default(null), currency: currency.default('BRL'), conditions: text(4000).default(null), validUntil: z.iso.date().nullable().default(null) }).refine(offerPricing, 'Preço obrigatório para fixed/starting_at');

export const opportunityCreate = z.object({ companyId: id, service: z.enum(SERVICES), title: z.string().trim().min(1).max(255), stage: z.enum(['presentation', 'qualification', 'proposal', 'negotiation']).default('presentation'), conversationId: id.nullable().default(null) });
export const opportunityPatch = z.object({ title: z.string().trim().min(1).max(255).optional(), notes: text(10000).optional(), nextAction: text(255).optional(), nextActionDueAt: datetime.nullable().optional() }).strict().refine(nonempty, 'Informe ao menos um campo');
export const stageChange = z.object({ id, stage: z.enum(OPPORTUNITY_STAGES), reason: text(255).default(null) });
const proposalFields = { title: z.string().trim().min(1).max(255), scope: text(10000), amountCents: cents, setupCents: cents.nullable(), monthlyCents: cents.nullable(), currency, conditions: text(4000), validUntil: z.iso.date().nullable(), origin: text(64) };
export const proposalBody = z.object(proposalFields);
export const proposalCreate = z.object({ ...proposalFields, scope: text(10000).default(null), setupCents: cents.nullable().default(null), monthlyCents: cents.nullable().default(null), currency: currency.default('BRL'), conditions: text(4000).default(null), validUntil: z.iso.date().nullable().default(null), origin: text(64).default('mcp') });
export const proposalList = z.object({ ...pagination, status: z.enum(PROPOSAL_STATUSES).optional() });
export const proposalStatus = z.object({ id, status: z.enum(PROPOSAL_STATUSES), reason: text(255).default(null) });
export const paymentCreate = z.object({ id, amountCents: cents.min(1), currency, receivedAt: datetime, method: text(64).default(null), note: text(255).default(null) });
export const conversationPatch = z.object({ state: z.enum(['awaiting_human', 'closed', 'awaiting_reply']).optional(), nextAction: text(255).optional(), nextActionDueAt: datetime.nullable().optional(), notes: text(10000).optional() }).strict().refine(nonempty, 'Informe ao menos um campo');
export const clientKey = z.string().regex(/^[A-Za-z0-9-]{8,64}$/).describe('Chave estável para esta mensagem; reutilize a mesma chave ao consultar/repetir após falha, nunca gere outra para o mesmo envio.');
export const messageSend = z.object({ id, text: z.string().trim().min(1).max(4096), clientKey });
export const attachmentSend = z.object({ id, filePath: z.string().min(1).max(2048), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']), caption: z.string().max(1024).default(''), clientKey });

export const leadFields = {
  name: z.string().trim().min(1).max(255), category: text(191), address: text(512), neighborhood: text(160), city: text(160), state: text(120), postalCode: text(32), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(), website: text(512), mapsUrl: text(1024), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(), rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().min(0).nullable(), timezone: text(64), notes: text(10000),
};
export const leadCreate = z.object({
  ...leadFields, category: text(191).default(null), address: text(512).default(null), neighborhood: text(160).default(null), city: text(160).default(null), state: text(120).default(null), postalCode: text(32).default(null), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null), website: text(512).default(null), mapsUrl: text(1024).default(null), latitude: leadFields.latitude.default(null), longitude: leadFields.longitude.default(null), rating: leadFields.rating.default(null), reviewCount: leadFields.reviewCount.default(null), timezone: text(64).default(null), notes: text(10000).default(null),
  phones: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  clientKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).describe('Chave estável para deduplicar este cadastro manual, inclusive após timeout.'),
}).refine((x) => (x.latitude === null) === (x.longitude === null), 'Informe latitude e longitude juntas');
export const leadPatch = z.object(leadFields).partial().strict().refine(nonempty, 'Informe ao menos um campo');
