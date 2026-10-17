import {
  CAMPAIGN_STATUS_LABELS,
  CONVERSATION_STATE_LABELS,
  MESSAGE_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  PARTICIPATION_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PROPOSAL_STATUS_LABELS,
  SCAN_STATUS_LABELS,
  SCAN_UNIT_STATUS_LABELS,
  WA_SESSION_STATUS_LABELS,
  WA_STATUS_LABELS,
  type CampaignStatus,
  type ConversationState,
  type MessageStatus,
  type OpportunityStage,
  type ParticipationStatus,
  type PaymentStatus,
  type ProposalStatus,
  type ScanStatus,
  type ScanUnitStatus,
  type WaSessionStatus,
  type WaStatus,
} from '@aero/shared';
import { Badge } from './ui';

type Tone = Parameters<typeof Badge>[0]['tone'];

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const tone: Tone = { running: 'info', queued: 'info', completed: 'success', partial: 'warning', failed: 'error', cancelled: 'ghost', cancelling: 'warning', pausing: 'warning', paused: 'neutral', draft: 'ghost' }[status] as Tone;
  return <Badge tone={tone}>{SCAN_STATUS_LABELS[status]}</Badge>;
}

export function UnitStatusBadge({ status }: { status: ScanUnitStatus }) {
  const tone: Tone = ({ done: 'success', failed: 'error', running: 'info', submitted: 'info', importing: 'info', abandoned: 'warning' } as Record<string, Tone>)[status] ?? 'ghost';
  return <Badge tone={tone}>{SCAN_UNIT_STATUS_LABELS[status]}</Badge>;
}

export function WaBadge({ status }: { status: WaStatus | null }) {
  if (!status) return <Badge>Sem telefone</Badge>;
  const tone: Tone = { found: 'success', not_found: 'neutral', inconclusive: 'warning', invalid_format: 'error', pending: 'ghost' }[status] as Tone;
  return <Badge tone={tone}>{WA_STATUS_LABELS[status]}</Badge>;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const tone: Tone = { active: 'success', paused: 'warning', draft: 'ghost', completed: 'neutral', cancelled: 'error' }[status] as Tone;
  return <Badge tone={tone}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

export function ParticipationBadge({ status }: { status: ParticipationStatus }) {
  const map: Partial<Record<ParticipationStatus, Tone>> = {
    scheduled: 'info',
    awaiting_reply: 'info',
    replied: 'primary',
    qualifying: 'primary',
    qualified: 'success',
    handed_off: 'warning',
    declined: 'error',
    blocked: 'error',
    closed_no_reply: 'neutral',
  };
  return <Badge tone={map[status] ?? 'ghost'}>{PARTICIPATION_STATUS_LABELS[status]}</Badge>;
}

export function ConversationBadge({ state }: { state: ConversationState }) {
  const tone: Tone = { awaiting_reply: 'info', awaiting_human: 'warning', human: 'primary', closed: 'ghost' }[state] as Tone;
  return <Badge tone={tone}>{CONVERSATION_STATE_LABELS[state]}</Badge>;
}

export function MessageStatusLabel({ status }: { status: MessageStatus }) {
  const tone: Tone = ({ failed: 'error', unknown: 'warning', read: 'success', delivered: 'success', accepted: 'neutral', scheduled: 'info', processing: 'info', cancelled: 'ghost' } as Record<string, Tone>)[status] ?? 'ghost';
  return <Badge tone={tone}>{MESSAGE_STATUS_LABELS[status]}</Badge>;
}

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  const tone: Tone = { presentation: 'ghost', qualification: 'info', proposal: 'primary', negotiation: 'warning', won: 'success', lost: 'error' }[stage] as Tone;
  return <Badge tone={tone}>{OPPORTUNITY_STAGE_LABELS[stage]}</Badge>;
}

export function ProposalBadge({ status }: { status: ProposalStatus }) {
  const tone: Tone = { draft: 'ghost', sent: 'info', accepted: 'success', rejected: 'error', expired: 'neutral', withdrawn: 'neutral' }[status] as Tone;
  return <Badge tone={tone}>{PROPOSAL_STATUS_LABELS[status]}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone: Tone = { pending: 'warning', partial: 'info', confirmed: 'success' }[status] as Tone;
  return <Badge tone={tone}>Pagamento: {PAYMENT_STATUS_LABELS[status]}</Badge>;
}

export function SessionBadge({ status }: { status: WaSessionStatus }) {
  const tone: Tone = ({ connected: 'success', scan_qr: 'warning', connecting: 'info', gateway_unreachable: 'error', logged_out: 'error' } as Record<string, Tone>)[status] ?? 'neutral';
  return <Badge tone={tone}>{WA_SESSION_STATUS_LABELS[status]}</Badge>;
}
