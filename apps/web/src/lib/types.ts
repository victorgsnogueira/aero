import type {
  CampaignStatus,
  ConversationState,
  MessageOrigin,
  MessageStatus,
  OpportunityStage,
  ParticipationStatus,
  PaymentStatus,
  PriceType,
  ProposalStatus,
  ScanMode,
  ScanStatus,
  ScanTargetKind,
  ScanUnitStatus,
  Service,
  WaSessionStatus,
  WaStatus,
} from '@aero/shared';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Settings {
  senderName: string | null;
  companyName: string | null;
  introduction: string | null;
  defaultTimezone: string;
  defaultCountry: string;
  sendMinIntervalSeconds: number;
  sendDailyLimit: number;
  sendHourlyLimit: number;
  validationRevalidateDays: number;
  validationBatchSize: number;
  validationMinIntervalMs: number;
  scanDefaultDepth: number;
  scanUnitMaxSeconds: number;
  missingForOutreach: string[];
  sendingEnabled: boolean;
  sendAllowlistActive: boolean;
}

export interface Offer {
  id: number;
  service: Service;
  name: string;
  description: string | null;
  scope: string | null;
  priceType: PriceType;
  priceCents: number | null;
  setupCents: number | null;
  monthlyCents: number | null;
  currency: string;
  conditions: string | null;
  validUntil: string | null;
  archived: boolean;
}

export interface OfferSnapshot extends Omit<Offer, 'id' | 'archived'> {
  offerId: number | null;
  capturedAt: string;
}

export interface Scan {
  id: number;
  name: string;
  segment: string | null;
  category: string | null;
  keywords: string[];
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  regionLabel: string;
  language: string;
  mode: ScanMode;
  targetKind: ScanTargetKind;
  targetCount: number;
  targetProgress: number;
  campaignId: number | null;
  depth: number;
  unitMaxSeconds: number;
  maxUnits: number;
  maxDurationMinutes: number;
  status: ScanStatus;
  statusReason: string | null;
  lastError: string | null;
  placesFound: number;
  phonesFound: number;
  newRecords: number;
  duplicates: number;
  uniquePhones: number;
  waConfirmed: number;
  waInconclusive: number;
  surplus: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ScanUnit {
  id: number;
  seq: number;
  query: string;
  depth: number;
  status: ScanUnitStatus;
  attempts: number;
  placesFound: number;
  newRecords: number;
  duplicates: number;
  error: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
}

export interface LeadRow {
  id: number;
  name: string;
  category: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  hasCoords: boolean;
  latitude: number | null;
  longitude: number | null;
  isDemo: boolean;
  phoneId: number | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  formatStatus: string | null;
  waStatus: WaStatus | null;
  waCheckedAt: string | null;
  phoneCount: number;
  sharedPhone: boolean;
  suppressed: boolean;
  activeParticipations: number;
  opportunityStage: OpportunityStage | null;
  lastSeenAt: string;
}

export interface LeadFilters {
  q?: string;
  scanId?: number;
  campaignId?: number;
  category?: string;
  city?: string;
  waStatus?: WaStatus;
  formatStatus?: string;
  hasCoords?: boolean;
  suppressed?: boolean;
  includeDemo?: boolean;
}

export interface MapResponse {
  mode: 'points' | 'grid';
  total: number;
  withoutCoords: number;
  points: { id: number; lat: number; lng: number; name: string; waStatus: WaStatus | null; stage: OpportunityStage | null }[];
  cells: { lat: number; lng: number; count: number }[];
}

export interface WaSession {
  sessionKey: string;
  status: WaSessionStatus;
  ownJid: string | null;
  webhookRegisteredAt: string | null;
  lastError: string | null;
  checkedAt: string;
}

export interface QualificationQuestion {
  key: string;
  text: string;
}

export interface Campaign {
  id: number;
  name: string;
  objective: string | null;
  service: Service;
  offerId: number | null;
  status: CampaignStatus;
  firstMessageTemplate: string | null;
  presentationTemplate: string | null;
  qualificationQuestions: QualificationQuestion[];
  questionsPerMessage: number;
  qualificationDoneTemplate: string | null;
  declineAckTemplate: string | null;
  timezone: string;
  sendDays: number[];
  sendWindowStart: string;
  sendWindowEnd: string;
  dailyLimit: number;
  noReplyCloseHours: number;
  audienceFilters: Record<string, unknown> | null;
  isDemo: boolean;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  counts: Partial<Record<ParticipationStatus, number>>;
}

export interface CampaignContact {
  id: number;
  status: ParticipationStatus;
  statusReason: string | null;
  firstSentAt: string | null;
  repliedAt: string | null;
  companyId: number;
  companyName: string;
  city: string | null;
  phoneId: number;
  e164: string | null;
  waStatus: WaStatus;
  formatStatus: string;
}

export interface ConversationListItem {
  id: number;
  state: ConversationState;
  automationPaused: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  title: string;
  phone: string;
  lastBody: string | null;
  lastDirection: 'in' | 'out' | null;
  campaignName: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
}

export interface ChatMessage {
  id: number;
  direction: 'in' | 'out';
  origin: MessageOrigin;
  status: MessageStatus;
  kind: string;
  body: string | null;
  media: { kind: string; fileName: string; mimeType: string; size: number; available: boolean } | null;
  campaignId: number | null;
  purpose: string | null;
  error: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  occurredAt: string;
}

export interface ConversationDetail {
  conversation: {
    id: number;
    state: ConversationState;
    automationPaused: boolean;
    unreadCount: number;
    jid: string;
    displayName: string | null;
    nextAction: string | null;
    nextActionDueAt: string | null;
    notes: string | null;
    lastMessageAt: string | null;
  };
  phone: { id: number; e164: string | null; raw_sample: string; wa_status: WaStatus; wa_checked_at: string | null; suppressed: number } | null;
  companies: { id: number; name: string; category: string | null; city: string | null; state: string | null; website: string | null; maps_url: string | null; notes: string | null }[];
  participations: {
    id: number;
    campaignId: number;
    campaignName: string;
    campaignStatus: CampaignStatus;
    service: Service;
    status: ParticipationStatus;
    statusReason: string | null;
    offerSnapshot: OfferSnapshot | null;
    answers: Record<string, string> | null;
    firstSentAt: string | null;
  }[];
  opportunities: { id: number; title: string; stage: OpportunityStage; service: Service; next_action: string | null; next_action_due_at: string | null }[];
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface Opportunity {
  id: number;
  companyId: number;
  companyName: string;
  city: string | null;
  conversationId: number | null;
  campaignId: number | null;
  service: Service;
  title: string;
  stage: OpportunityStage;
  lostReason: string | null;
  offerSnapshot: OfferSnapshot | null;
  qualificationAnswers: Record<string, string> | null;
  notes: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: number;
  amountCents: number;
  currency: string;
  receivedAt: string;
  method: string | null;
  note: string | null;
}

export interface Proposal {
  id: number;
  opportunityId: number;
  service: Service;
  title: string;
  scope: string | null;
  amountCents: number;
  setupCents: number | null;
  monthlyCents: number | null;
  currency: string;
  conditions: string | null;
  validUntil: string | null;
  origin: string | null;
  status: ProposalStatus;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  paymentStatus: PaymentStatus;
  receivedCents: number;
  payments: Payment[];
}

export interface Rate {
  numerator: number;
  denominator: number;
  value: number | null;
  denominatorLabel: string;
}

export interface Metrics {
  collection: { companies: number; newRecords: number; duplicates: number; phones: number; waConfirmed: number; waInconclusive: number; waNotFound: number };
  outreach: {
    contactsApproached: number;
    firstMessages: number;
    deliveredConfirmed: number;
    readConfirmed: number;
    unknownResult: number;
    failed: number;
    contactsReplied: number;
    contactsInterested: number;
    contactsQualified: number;
    contactsDeclined: number;
    contactsNoReply: number;
  };
  rates: Record<'reply' | 'interest' | 'qualification' | 'deliveryConfirmed' | 'readConfirmed' | 'proposalAcceptance', Rate>;
  proposals: { sent: number; accepted: number; fullyPaid: number };
  money: { offered: Record<string, number>; closed: Record<string, number>; received: Record<string, number> };
  stages: Partial<Record<OpportunityStage, number>>;
  lossReasons: { reason: string; count: number }[];
}
