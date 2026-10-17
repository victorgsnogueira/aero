// Estados e vocabulários compartilhados entre API, workers e interface.
// Mantidos como tuplas `as const` (sem enums do TS) para funcionar com type stripping.

export const SERVICES = ['landing_page', 'micro_saas'] as const;
export type Service = (typeof SERVICES)[number];

export const PRICE_TYPES = ['fixed', 'starting_at', 'custom_quote'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const SCAN_MODES = ['collect_only', 'collect_and_validate'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

export const SCAN_TARGET_KINDS = ['unique_phones', 'whatsapp_confirmed'] as const;
export type ScanTargetKind = (typeof SCAN_TARGET_KINDS)[number];

export const SCAN_STATUSES = [
  'draft',
  'queued',
  'running',
  'pausing',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'partial',
  'failed',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_UNIT_STATUSES = [
  'pending',
  'submitted',
  'running',
  'importing',
  'done',
  'failed',
  'skipped',
  'abandoned',
] as const;
export type ScanUnitStatus = (typeof SCAN_UNIT_STATUSES)[number];

export const PHONE_FORMAT_STATUSES = ['valid', 'needs_review', 'invalid'] as const;
export type PhoneFormatStatus = (typeof PHONE_FORMAT_STATUSES)[number];

export const WA_STATUSES = ['pending', 'invalid_format', 'found', 'not_found', 'inconclusive'] as const;
export type WaStatus = (typeof WA_STATUSES)[number];

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Transições permitidas entre estados de campanha. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const PARTICIPATION_STATUSES = [
  'selected',
  'excluded',
  'blocked',
  'scheduled',
  'sent',
  'awaiting_reply',
  'replied',
  'qualifying',
  'qualified',
  'handed_off',
  'declined',
  'closed_no_reply',
  'cancelled',
] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

/** Participações que ainda representam uma abordagem em andamento para o telefone. */
export const ACTIVE_PARTICIPATION_STATUSES: readonly ParticipationStatus[] = [
  'scheduled',
  'sent',
  'awaiting_reply',
  'replied',
  'qualifying',
  'qualified',
  'handed_off',
];

export const CONVERSATION_STATES = ['awaiting_reply', 'awaiting_human', 'human', 'closed'] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_ORIGINS = ['automatic', 'manual', 'phone', 'contact'] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const MESSAGE_STATUSES = [
  'scheduled',
  'processing',
  'accepted',
  'delivered',
  'read',
  'failed',
  'unknown',
  'cancelled',
  'received',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const OPPORTUNITY_STAGES = ['presentation', 'qualification', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const PROPOSAL_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PAYMENT_STATUSES = ['pending', 'partial', 'confirmed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WA_SESSION_STATUSES = [
  'unknown',
  'not_created',
  'connecting',
  'scan_qr',
  'connected',
  'disconnected',
  'stopped',
  'logged_out',
  'gateway_unreachable',
] as const;
export type WaSessionStatus = (typeof WA_SESSION_STATUSES)[number];

export const REPLY_CLASSES = ['refusal', 'affirmative', 'question', 'auto_reply', 'answer', 'unrecognized'] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];
