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
} from './enums.ts';

export const SERVICE_LABELS: Record<Service, string> = {
  landing_page: 'Landing page',
  micro_saas: 'Sistema sob medida (micro SaaS)',
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  fixed: 'Preço fixo',
  starting_at: 'A partir de',
  custom_quote: 'Orçamento personalizado',
};

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  collect_only: 'Somente coletar',
  collect_and_validate: 'Coletar e validar WhatsApp',
};

export const SCAN_TARGET_LABELS: Record<ScanTargetKind, string> = {
  unique_phones: 'Números únicos coletados',
  whatsapp_confirmed: 'WhatsApps confirmados',
};

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  running: 'Em execução',
  pausing: 'Pausando',
  paused: 'Pausada',
  cancelling: 'Cancelando',
  cancelled: 'Cancelada',
  completed: 'Concluída',
  partial: 'Concluída parcialmente',
  failed: 'Falhou',
};

export const SCAN_UNIT_STATUS_LABELS: Record<ScanUnitStatus, string> = {
  pending: 'Pendente',
  submitted: 'Enviada ao coletor',
  running: 'Coletando',
  importing: 'Importando',
  done: 'Concluída',
  failed: 'Falhou',
  skipped: 'Não executada',
  abandoned: 'Descartada',
};

export const WA_STATUS_LABELS: Record<WaStatus, string> = {
  pending: 'Pendente',
  invalid_format: 'Formato inválido',
  found: 'WhatsApp encontrado',
  not_found: 'WhatsApp não encontrado',
  inconclusive: 'Verificação inconclusiva',
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const PARTICIPATION_STATUS_LABELS: Record<ParticipationStatus, string> = {
  selected: 'Selecionado',
  excluded: 'Removido manualmente',
  blocked: 'Bloqueado (inelegível)',
  scheduled: 'Envio agendado',
  sent: 'Abordagem enviada',
  awaiting_reply: 'Aguardando resposta',
  replied: 'Respondeu',
  qualifying: 'Em qualificação',
  qualified: 'Qualificado',
  handed_off: 'Com atendimento humano',
  declined: 'Recusou',
  closed_no_reply: 'Encerrado sem resposta',
  cancelled: 'Cancelado',
};

export const CONVERSATION_STATE_LABELS: Record<ConversationState, string> = {
  awaiting_reply: 'Aguardando resposta',
  awaiting_human: 'Aguardando atendimento',
  human: 'Em atendimento humano',
  closed: 'Encerrada',
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  scheduled: 'Agendada',
  processing: 'Em processamento',
  accepted: 'Aceita pelo gateway',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falhou',
  unknown: 'Resultado desconhecido',
  cancelled: 'Cancelada',
  received: 'Recebida',
};

export const MESSAGE_ORIGIN_LABELS: Record<MessageOrigin, string> = {
  automatic: 'Automática',
  manual: 'Manual (aero)',
  phone: 'Enviada pelo celular',
  contact: 'Contato',
};

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  presentation: 'Apresentação',
  qualification: 'Qualificação',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  accepted: 'Aceita',
  rejected: 'Recusada',
  expired: 'Expirada',
  withdrawn: 'Retirada',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  confirmed: 'Confirmado',
};

export const WA_SESSION_STATUS_LABELS: Record<WaSessionStatus, string> = {
  unknown: 'Desconhecido',
  not_created: 'Sessão não criada',
  connecting: 'Conectando',
  scan_qr: 'Aguardando leitura do QR code',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  stopped: 'Parado',
  logged_out: 'Desconectado do aparelho (novo pareamento necessário)',
  gateway_unreachable: 'Gateway indisponível',
};
