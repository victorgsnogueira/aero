import * as z from 'zod/v4';
import { CONVERSATION_STATES, OPPORTUNITY_STAGES, PARTICIPATION_STATUSES, PHONE_FORMAT_STATUSES, SCAN_MODES, SCAN_TARGET_KINDS, SERVICES, WA_STATUSES } from '@aero/shared';

export const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const ids = z.object({ id });
export const pagination = { page: id.default(1), pageSize: z.number().int().min(1).max(200).default(50) };
export const filters = {
  q: z.string().max(120).optional(), scanId: id.optional(), campaignId: id.optional(),
  category: z.string().max(191).optional(), city: z.string().max(160).optional(),
  waStatus: z.enum(WA_STATUSES).optional(), formatStatus: z.enum(PHONE_FORMAT_STATUSES).optional(),
  hasCoords: z.boolean().optional(), suppressed: z.boolean().optional(), includeDemo: z.boolean().default(false),
};
export const leadList = z.object({ ...filters, ...pagination });
export const mapInput = z.object({
  ...filters, ...pagination,
  west: z.number().min(-180).max(180), east: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90), north: z.number().min(-90).max(90), zoom: z.number().min(0).max(24).default(12),
}).refine((x) => x.south <= x.north, 'south deve ser menor ou igual a north');

const region = z.string().trim().min(1).max(160).nullable().default(null);
export const scanInput = z.object({
  name: z.string().trim().min(1).max(160), segment: region, category: region,
  keywords: z.array(z.string().trim().min(2).max(120)).min(1).max(20),
  neighborhood: region, city: region, state: z.string().trim().min(1).max(120).nullable().default(null),
  country: z.string().trim().min(1).max(120).nullable().default(null),
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default('BR'), language: z.string().regex(/^[a-z]{2}$/).default('pt'),
  mode: z.enum(SCAN_MODES).default('collect_only'), targetKind: z.enum(SCAN_TARGET_KINDS).default('unique_phones'),
  targetCount: z.number().int().min(1).max(5000).default(100), campaignId: id.nullable().default(null),
  depth: z.number().int().min(1).max(100).optional(), unitMaxSeconds: z.number().int().min(180).max(3600).optional(),
  maxUnits: z.number().int().min(1).max(200).default(10), maxDurationMinutes: z.number().int().min(5).max(1440).default(60),
  startNow: z.boolean().default(false),
}).refine((x) => [x.neighborhood, x.city, x.state, x.country].some(Boolean), 'Informe ao menos um campo de região')
  .refine((x) => x.targetKind !== 'whatsapp_confirmed' || x.mode === 'collect_and_validate', 'Meta de WhatsApps exige collect_and_validate');

export const validationInput = z.object({ phoneIds: z.array(id).min(1).max(500).optional(), scanId: id.optional() })
  .refine((x) => Boolean(x.phoneIds) !== Boolean(x.scanId), 'Informe phoneIds OU scanId, exclusivamente');
export const createCampaign = z.object({ name: z.string().trim().min(1).max(160), service: z.enum(SERVICES), offerId: id.nullable().default(null) });
const text = (max: number) => z.string().max(max).nullable();
export const campaignConfig = z.object({
  name: z.string().trim().min(1).max(160), objective: text(2000), offerId: id.nullable(),
  firstMessageTemplate: text(4000), presentationTemplate: text(4000),
  qualificationQuestions: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), text: z.string().min(3).max(1000) })).max(20),
  questionsPerMessage: z.number().int().min(1).max(3), qualificationDoneTemplate: text(2000), declineAckTemplate: text(1000),
  timezone: z.string().min(1).max(64), sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/), sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  dailyLimit: z.number().int().min(1).max(500), noReplyCloseHours: z.number().int().min(1).max(1440),
  audienceFilters: z.record(z.string(), z.unknown()).nullable(),
});
export const audienceInput = z.object({ id, companyIds: z.array(id).min(1).max(5000) });
export const contactsInput = z.object({ id, ...pagination, status: z.enum(PARTICIPATION_STATUSES).optional() });
export const conversationList = z.object({ ...pagination, state: z.enum(CONVERSATION_STATES).optional(), unread: z.boolean().optional(), q: z.string().max(120).optional(), campaignId: id.optional() });
export const opportunityList = z.object({ ...pagination, stage: z.enum(OPPORTUNITY_STAGES).optional(), service: z.enum(SERVICES).optional(), campaignId: id.optional() });
export const metricsInput = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), service: z.enum(SERVICES).optional(), campaignId: id.optional(), scanId: id.optional(), city: z.string().max(160).optional(), state: z.string().max(120).optional(), includeDemo: z.boolean().default(false) });
