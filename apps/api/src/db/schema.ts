import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  CAMPAIGN_STATUSES,
  CONVERSATION_STATES,
  MESSAGE_DIRECTIONS,
  MESSAGE_ORIGINS,
  MESSAGE_STATUSES,
  OPPORTUNITY_STAGES,
  PARTICIPATION_STATUSES,
  PHONE_FORMAT_STATUSES,
  PRICE_TYPES,
  PROPOSAL_STATUSES,
  SCAN_MODES,
  SCAN_STATUSES,
  SCAN_TARGET_KINDS,
  SCAN_UNIT_STATUSES,
  SERVICES,
  WA_SESSION_STATUSES,
  WA_STATUSES,
} from '@aero/shared';

// Convenções:
// - IDs: BIGINT UNSIGNED auto incremento.
// - Datas: DATETIME(3) sempre em UTC (a conexão usa timezone 'Z').
// - Dinheiro: BIGINT em centavos + coluna de moeda. Nunca float.
// - Dados vindos da fonte externa ficam preservados em `raw`.

const id = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();
const ref = (name: string) => bigint(name, { mode: 'number', unsigned: true });
const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const createdAt = () => ts('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`);
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date());
const money = (name: string) => bigint(name, { mode: 'number' });

export type OfferSnapshot = {
  offerId: number | null;
  service: (typeof SERVICES)[number];
  name: string;
  description: string | null;
  scope: string | null;
  priceType: (typeof PRICE_TYPES)[number];
  priceCents: number | null;
  setupCents: number | null;
  monthlyCents: number | null;
  currency: string;
  conditions: string | null;
  validUntil: string | null;
  capturedAt: string;
};

export type QualificationQuestion = { key: string; text: string };

// ---------------------------------------------------------------------------
// Configuração da operação (registro único, id = 1)
// ---------------------------------------------------------------------------
export const operatorSettings = mysqlTable('operator_settings', {
  id: int('id').primaryKey(),
  senderName: varchar('sender_name', { length: 120 }),
  companyName: varchar('company_name', { length: 160 }),
  introduction: text('introduction'),
  defaultTimezone: varchar('default_timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),
  defaultCountry: varchar('default_country', { length: 2 }).notNull().default('BR'),
  // Limites globais da sessão (compartilhados por todas as campanhas)
  sendMinIntervalSeconds: int('send_min_interval_seconds').notNull().default(90),
  sendDailyLimit: int('send_daily_limit').notNull().default(40),
  sendHourlyLimit: int('send_hourly_limit').notNull().default(12),
  // Validação de WhatsApp
  validationRevalidateDays: int('validation_revalidate_days').notNull().default(30),
  validationBatchSize: int('validation_batch_size').notNull().default(10),
  validationMinIntervalMs: int('validation_min_interval_ms').notNull().default(4000),
  // Coleta
  scanDefaultDepth: int('scan_default_depth').notNull().default(10),
  scanUnitMaxSeconds: int('scan_unit_max_seconds').notNull().default(600),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------
export const offers = mysqlTable('offers', {
  id: id(),
  service: mysqlEnum('service', SERVICES).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description'),
  scope: text('scope'),
  priceType: mysqlEnum('price_type', PRICE_TYPES).notNull(),
  priceCents: money('price_cents'),
  setupCents: money('setup_cents'),
  monthlyCents: money('monthly_cents'),
  currency: varchar('currency', { length: 3 }).notNull().default('BRL'),
  conditions: text('conditions'),
  validUntil: varchar('valid_until', { length: 10 }),
  archived: boolean('archived').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Empresas, telefones e coleta
// ---------------------------------------------------------------------------
export const companies = mysqlTable(
  'companies',
  {
    id: id(),
    source: varchar('source', { length: 32 }).notNull().default('google_maps'),
    sourcePlaceId: varchar('source_place_id', { length: 191 }),
    sourceCid: varchar('source_cid', { length: 64 }),
    sourceDataId: varchar('source_data_id', { length: 128 }),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 191 }),
    address: varchar('address', { length: 512 }),
    neighborhood: varchar('neighborhood', { length: 160 }),
    city: varchar('city', { length: 160 }),
    state: varchar('state', { length: 120 }),
    postalCode: varchar('postal_code', { length: 32 }),
    countryCode: varchar('country_code', { length: 2 }),
    website: varchar('website', { length: 512 }),
    domain: varchar('domain', { length: 191 }),
    mapsUrl: varchar('maps_url', { length: 1024 }),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    rating: decimal('rating', { precision: 3, scale: 2 }),
    reviewCount: int('review_count'),
    timezone: varchar('timezone', { length: 64 }),
    raw: json('raw'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    firstSeenAt: ts('first_seen_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    lastSeenAt: ts('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('companies_source_place_uq').on(t.source, t.sourcePlaceId),
    index('companies_cid_idx').on(t.sourceCid),
    index('companies_domain_idx').on(t.domain),
    index('companies_city_idx').on(t.countryCode, t.state, t.city),
    index('companies_category_idx').on(t.category),
    index('companies_geo_idx').on(t.latitude, t.longitude),
    index('companies_name_idx').on(t.name),
  ],
);

export const phones = mysqlTable(
  'phones',
  {
    id: id(),
    /** Número normalizado em E.164; nulo quando não foi possível normalizar com segurança. */
    e164: varchar('e164', { length: 20 }),
    /** Chave única: E.164 quando válido, ou `raw:<país>:<dígitos>` para revisão. */
    dedupeKey: varchar('dedupe_key', { length: 64 }).notNull(),
    rawSample: varchar('raw_sample', { length: 64 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }),
    formatStatus: mysqlEnum('format_status', PHONE_FORMAT_STATUSES).notNull(),
    formatNote: varchar('format_note', { length: 255 }),
    lineType: varchar('line_type', { length: 32 }),
    waStatus: mysqlEnum('wa_status', WA_STATUSES).notNull().default('pending'),
    waJid: varchar('wa_jid', { length: 128 }),
    waCheckedAt: ts('wa_checked_at'),
    waError: varchar('wa_error', { length: 255 }),
    waAttempts: int('wa_attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('phones_dedupe_uq').on(t.dedupeKey),
    index('phones_e164_idx').on(t.e164),
    index('phones_wa_idx').on(t.waStatus, t.waCheckedAt),
  ],
);

export const companyPhones = mysqlTable(
  'company_phones',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    phoneId: ref('phone_id').notNull(),
    rawValue: varchar('raw_value', { length: 64 }).notNull(),
    source: varchar('source', { length: 32 }).notNull().default('google_maps'),
    isPrimary: boolean('is_primary').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('company_phones_uq').on(t.companyId, t.phoneId), index('company_phones_phone_idx').on(t.phoneId)],
);

/** Supressão persistente: recusas e descadastros valem para novas campanhas e importações. */
export const suppressions = mysqlTable(
  'suppressions',
  {
    id: id(),
    phoneId: ref('phone_id').notNull(),
    reason: varchar('reason', { length: 64 }).notNull(),
    detail: text('detail'),
    sourceMessageId: ref('source_message_id'),
    campaignId: ref('campaign_id'),
    createdAt: createdAt(),
    liftedAt: ts('lifted_at'),
    liftedReason: varchar('lifted_reason', { length: 255 }),
  },
  (t) => [index('suppressions_phone_idx').on(t.phoneId, t.liftedAt)],
);

export const scans = mysqlTable(
  'scans',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    segment: varchar('segment', { length: 160 }),
    category: varchar('category', { length: 160 }),
    keywords: json('keywords').$type<string[]>().notNull(),
    neighborhood: varchar('neighborhood', { length: 160 }),
    city: varchar('city', { length: 160 }),
    state: varchar('state', { length: 120 }),
    country: varchar('country', { length: 120 }),
    countryCode: varchar('country_code', { length: 2 }),
    language: varchar('language', { length: 2 }).notNull().default('pt'),
    mode: mysqlEnum('mode', SCAN_MODES).notNull(),
    targetKind: mysqlEnum('target_kind', SCAN_TARGET_KINDS).notNull(),
    targetCount: int('target_count').notNull(),
    campaignId: ref('campaign_id'),
    depth: int('depth').notNull().default(10),
    unitMaxSeconds: int('unit_max_seconds').notNull().default(600),
    maxUnits: int('max_units').notNull().default(20),
    maxDurationMinutes: int('max_duration_minutes').notNull().default(180),
    status: mysqlEnum('status', SCAN_STATUSES).notNull().default('draft'),
    statusReason: varchar('status_reason', { length: 512 }),
    lastError: text('last_error'),
    // Contadores (recalculados a partir de scan_results / unidades)
    placesFound: int('places_found').notNull().default(0),
    phonesFound: int('phones_found').notNull().default(0),
    newRecords: int('new_records').notNull().default(0),
    duplicates: int('duplicates').notNull().default(0),
    uniquePhones: int('unique_phones').notNull().default(0),
    waConfirmed: int('wa_confirmed').notNull().default(0),
    waInconclusive: int('wa_inconclusive').notNull().default(0),
    surplus: int('surplus').notNull().default(0),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('scans_status_idx').on(t.status)],
);

export const scanUnits = mysqlTable(
  'scan_units',
  {
    id: id(),
    scanId: ref('scan_id').notNull(),
    seq: int('seq').notNull(),
    query: varchar('query', { length: 512 }).notNull(),
    depth: int('depth').notNull(),
    status: mysqlEnum('status', SCAN_UNIT_STATUSES).notNull().default('pending'),
    externalJobId: varchar('external_job_id', { length: 64 }),
    attempts: int('attempts').notNull().default(0),
    placesFound: int('places_found').notNull().default(0),
    newRecords: int('new_records').notNull().default(0),
    duplicates: int('duplicates').notNull().default(0),
    error: text('error'),
    submittedAt: ts('submitted_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('scan_units_seq_uq').on(t.scanId, t.seq), index('scan_units_status_idx').on(t.status)],
);

/** Registro das consultas executadas, para reduzir repetição entre varreduras. */
export const scanQueryLog = mysqlTable(
  'scan_query_log',
  {
    id: id(),
    queryHash: varchar('query_hash', { length: 64 }).notNull(),
    query: varchar('query', { length: 512 }).notNull(),
    language: varchar('language', { length: 2 }).notNull(),
    depth: int('depth').notNull(),
    scanUnitId: ref('scan_unit_id').notNull(),
    placesFound: int('places_found').notNull().default(0),
    executedAt: createdAt(),
  },
  (t) => [index('scan_query_log_hash_idx').on(t.queryHash, t.executedAt)],
);

/** Ocorrência de uma empresa em uma varredura. */
export const scanResults = mysqlTable(
  'scan_results',
  {
    id: id(),
    scanId: ref('scan_id').notNull(),
    scanUnitId: ref('scan_unit_id').notNull(),
    companyId: ref('company_id').notNull(),
    isNew: boolean('is_new').notNull(),
    /** Excedente: coletado após a meta ser atingida. Preservado, mas fora da contagem da meta. */
    isSurplus: boolean('is_surplus').notNull().default(false),
    countsTowardTarget: boolean('counts_toward_target').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('scan_results_uq').on(t.scanId, t.companyId), index('scan_results_company_idx').on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Sessão do WhatsApp (uma, mas modelada como registro)
// ---------------------------------------------------------------------------
export const waSessions = mysqlTable('wa_sessions', {
  id: id(),
  sessionKey: varchar('session_key', { length: 64 }).notNull().unique(),
  label: varchar('label', { length: 120 }).notNull(),
  status: mysqlEnum('status', WA_SESSION_STATUSES).notNull().default('unknown'),
  ownJid: varchar('own_jid', { length: 128 }),
  webhookRegisteredAt: ts('webhook_registered_at'),
  lastEventAt: ts('last_event_at'),
  lastError: varchar('last_error', { length: 512 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------
export const campaigns = mysqlTable(
  'campaigns',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    objective: text('objective'),
    service: mysqlEnum('service', SERVICES).notNull(),
    offerId: ref('offer_id'),
    status: mysqlEnum('status', CAMPAIGN_STATUSES).notNull().default('draft'),
    sessionId: ref('session_id'),
    audienceFilters: json('audience_filters').$type<Record<string, unknown>>(),
    firstMessageTemplate: text('first_message_template'),
    presentationTemplate: text('presentation_template'),
    qualificationQuestions: json('qualification_questions').$type<QualificationQuestion[]>(),
    questionsPerMessage: int('questions_per_message').notNull().default(1),
    qualificationDoneTemplate: text('qualification_done_template'),
    declineAckTemplate: text('decline_ack_template'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),
    sendDays: json('send_days').$type<number[]>().notNull(),
    sendWindowStart: varchar('send_window_start', { length: 5 }).notNull().default('09:00'),
    sendWindowEnd: varchar('send_window_end', { length: 5 }).notNull().default('18:00'),
    dailyLimit: int('daily_limit').notNull().default(20),
    noReplyCloseHours: int('no_reply_close_hours').notNull().default(72),
    startedAt: ts('started_at'),
    pausedAt: ts('paused_at'),
    endedAt: ts('ended_at'),
    lastDispatchAt: ts('last_dispatch_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('campaigns_status_idx').on(t.status)],
);

export const campaignContacts = mysqlTable(
  'campaign_contacts',
  {
    id: id(),
    campaignId: ref('campaign_id').notNull(),
    companyId: ref('company_id').notNull(),
    phoneId: ref('phone_id').notNull(),
    status: mysqlEnum('status', PARTICIPATION_STATUSES).notNull().default('selected'),
    statusReason: varchar('status_reason', { length: 255 }),
    offerSnapshot: json('offer_snapshot').$type<OfferSnapshot>(),
    qualificationIndex: int('qualification_index').notNull().default(0),
    answers: json('answers').$type<Record<string, string>>(),
    firstMessageId: ref('first_message_id'),
    firstSentAt: ts('first_sent_at'),
    repliedAt: ts('replied_at'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('campaign_contacts_uq').on(t.campaignId, t.phoneId),
    index('campaign_contacts_phone_idx').on(t.phoneId, t.status),
    index('campaign_contacts_status_idx').on(t.campaignId, t.status),
  ],
);

export const campaignContactEvents = mysqlTable(
  'campaign_contact_events',
  {
    id: id(),
    campaignContactId: ref('campaign_contact_id').notNull(),
    fromStatus: varchar('from_status', { length: 32 }),
    toStatus: varchar('to_status', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 255 }),
    actor: varchar('actor', { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('cce_cc_idx').on(t.campaignContactId)],
);

// ---------------------------------------------------------------------------
// Conversas e mensagens
// ---------------------------------------------------------------------------
export const conversations = mysqlTable(
  'conversations',
  {
    id: id(),
    sessionId: ref('session_id').notNull(),
    phoneId: ref('phone_id').notNull(),
    jid: varchar('jid', { length: 128 }).notNull(),
    lid: varchar('lid', { length: 128 }),
    displayName: varchar('display_name', { length: 255 }),
    state: mysqlEnum('state', CONVERSATION_STATES).notNull().default('awaiting_reply'),
    automationPaused: boolean('automation_paused').notNull().default(false),
    activeCampaignContactId: ref('active_campaign_contact_id'),
    unreadCount: int('unread_count').notNull().default(0),
    lastMessageAt: ts('last_message_at'),
    lastInboundAt: ts('last_inbound_at'),
    nextAction: varchar('next_action', { length: 255 }),
    nextActionDueAt: ts('next_action_due_at'),
    notes: text('notes'),
    /** Versão para controle otimista entre worker, webhook e ações manuais. */
    version: int('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conversations_session_phone_uq').on(t.sessionId, t.phoneId),
    index('conversations_last_idx').on(t.lastMessageAt),
    index('conversations_state_idx').on(t.state),
  ],
);

export type MessageMedia = { kind: string; mimeType: string; fileName: string; size: number; storageKey: string | null; gatewayUrl: string | null };

export const messages = mysqlTable(
  'messages',
  {
    id: id(),
    conversationId: ref('conversation_id').notNull(),
    direction: mysqlEnum('direction', MESSAGE_DIRECTIONS).notNull(),
    origin: mysqlEnum('origin', MESSAGE_ORIGINS).notNull(),
    status: mysqlEnum('status', MESSAGE_STATUSES).notNull(),
    kind: varchar('kind', { length: 32 }).notNull().default('text'),
    body: text('body'),
    media: json('media').$type<MessageMedia>(),
    campaignId: ref('campaign_id'),
    campaignContactId: ref('campaign_contact_id'),
    purpose: varchar('purpose', { length: 32 }),
    externalId: varchar('external_id', { length: 128 }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    scheduledFor: ts('scheduled_for'),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    occurredAt: ts('occurred_at').notNull(),
    error: varchar('error', { length: 512 }),
    attempts: int('attempts').notNull().default(0),
    lockedAt: ts('locked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('messages_external_uq').on(t.conversationId, t.externalId),
    uniqueIndex('messages_idem_uq').on(t.idempotencyKey),
    index('messages_conv_idx').on(t.conversationId, t.occurredAt),
    index('messages_sched_idx').on(t.status, t.scheduledFor),
    index('messages_campaign_idx').on(t.campaignId, t.purpose),
    index('messages_external_idx').on(t.externalId),
  ],
);

/** Eventos de webhook persistidos e deduplicados antes de qualquer efeito. */
export const webhookEvents = mysqlTable(
  'webhook_events',
  {
    id: id(),
    source: varchar('source', { length: 32 }).notNull(),
    eventKey: varchar('event_key', { length: 191 }).notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    receivedAt: createdAt(),
    processedAt: ts('processed_at'),
    attempts: int('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [uniqueIndex('webhook_events_key_uq').on(t.source, t.eventKey), index('webhook_events_pending_idx').on(t.processedAt)],
);

/** Outbox transacional: intenção registrada junto da mudança de negócio e publicada depois na fila. */
export const outbox = mysqlTable(
  'outbox',
  {
    id: id(),
    topic: varchar('topic', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    dedupeKey: varchar('dedupe_key', { length: 191 }),
    availableAt: ts('available_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    publishedAt: ts('published_at'),
    attempts: int('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 512 }),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_pending_idx').on(t.publishedAt, t.availableAt), uniqueIndex('outbox_dedupe_uq').on(t.dedupeKey)],
);

// ---------------------------------------------------------------------------
// Oportunidades, propostas e pagamentos
// ---------------------------------------------------------------------------
export const opportunities = mysqlTable(
  'opportunities',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    conversationId: ref('conversation_id'),
    campaignId: ref('campaign_id'),
    campaignContactId: ref('campaign_contact_id'),
    service: mysqlEnum('service', SERVICES).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    stage: mysqlEnum('stage', OPPORTUNITY_STAGES).notNull(),
    lostReason: varchar('lost_reason', { length: 255 }),
    offerSnapshot: json('offer_snapshot').$type<OfferSnapshot>(),
    qualificationAnswers: json('qualification_answers').$type<Record<string, string>>(),
    notes: text('notes'),
    nextAction: varchar('next_action', { length: 255 }),
    nextActionDueAt: ts('next_action_due_at'),
    wonAt: ts('won_at'),
    lostAt: ts('lost_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('opportunities_stage_idx').on(t.stage),
    index('opportunities_company_idx').on(t.companyId),
    index('opportunities_campaign_idx').on(t.campaignId),
    uniqueIndex('opportunities_cc_uq').on(t.campaignContactId),
  ],
);

export const opportunityStageHistory = mysqlTable(
  'opportunity_stage_history',
  {
    id: id(),
    opportunityId: ref('opportunity_id').notNull(),
    fromStage: varchar('from_stage', { length: 32 }),
    toStage: varchar('to_stage', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 255 }),
    actor: varchar('actor', { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('osh_opp_idx').on(t.opportunityId)],
);

export const proposals = mysqlTable(
  'proposals',
  {
    id: id(),
    opportunityId: ref('opportunity_id').notNull(),
    service: mysqlEnum('service', SERVICES).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    scope: text('scope'),
    amountCents: money('amount_cents').notNull(),
    setupCents: money('setup_cents'),
    monthlyCents: money('monthly_cents'),
    currency: varchar('currency', { length: 3 }).notNull(),
    conditions: text('conditions'),
    validUntil: varchar('valid_until', { length: 10 }),
    origin: varchar('origin', { length: 64 }),
    status: mysqlEnum('status', PROPOSAL_STATUSES).notNull().default('draft'),
    sentAt: ts('sent_at'),
    acceptedAt: ts('accepted_at'),
    rejectedAt: ts('rejected_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('proposals_opp_idx').on(t.opportunityId), index('proposals_status_idx').on(t.status)],
);

export const payments = mysqlTable(
  'payments',
  {
    id: id(),
    proposalId: ref('proposal_id').notNull(),
    amountCents: money('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    receivedAt: ts('received_at').notNull(),
    method: varchar('method', { length: 64 }),
    note: varchar('note', { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index('payments_proposal_idx').on(t.proposalId)],
);

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: id(),
    actor: varchar('actor', { length: 16 }).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    data: json('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_created_idx').on(t.createdAt)],
);
