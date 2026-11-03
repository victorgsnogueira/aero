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
import { Icon, type IconName } from './Icon';

function stateIcon(value: string): IconName {
  if (['completed', 'done', 'found', 'connected', 'accepted', 'confirmed', 'won', 'qualified', 'read'].includes(value)) return 'complete';
  if (['failed', 'cancelled', 'not_found', 'invalid_format', 'rejected', 'lost', 'blocked', 'logged_out', 'declined'].includes(value)) return 'cancelled';
  if (['unknown', 'partial', 'inconclusive', 'gateway_unreachable', 'scan_qr', 'awaiting_human'].includes(value)) return 'alert';
  if (['paused', 'pausing', 'withdrawn'].includes(value)) return 'pause';
  if (['running', 'queued', 'scheduled', 'processing', 'connecting', 'qualifying', 'awaiting_reply', 'submitted', 'importing'].includes(value)) return 'clock';
  if (['human', 'handed_off', 'replied'].includes(value)) return 'message';
  if (['sent', 'delivered'].includes(value)) return 'check';
  return 'circle';
}

function StateLabel({ value, label }: { value: string; label: string }) {
  return (
    <span className="status-label" data-status={value}>
      <Icon name={stateIcon(value)} />
      <span>{label}</span>
    </span>
  );
}

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  return <StateLabel value={status} label={SCAN_STATUS_LABELS[status]} />;
}

export function UnitStatusBadge({ status }: { status: ScanUnitStatus }) {
  return <StateLabel value={status} label={SCAN_UNIT_STATUS_LABELS[status]} />;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <StateLabel value={status} label={CAMPAIGN_STATUS_LABELS[status]} />;
}

export function ParticipationBadge({ status }: { status: ParticipationStatus }) {
  return <StateLabel value={status} label={PARTICIPATION_STATUS_LABELS[status]} />;
}

export function ConversationBadge({ state }: { state: ConversationState }) {
  return <StateLabel value={state} label={CONVERSATION_STATE_LABELS[state]} />;
}

export function MessageStatusLabel({ status }: { status: MessageStatus }) {
  return <StateLabel value={status} label={MESSAGE_STATUS_LABELS[status]} />;
}

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  return <StateLabel value={stage} label={OPPORTUNITY_STAGE_LABELS[stage]} />;
}

export function ProposalBadge({ status }: { status: ProposalStatus }) {
  return <StateLabel value={status} label={PROPOSAL_STATUS_LABELS[status]} />;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <StateLabel value={status} label={`Pagamento: ${PAYMENT_STATUS_LABELS[status]}`} />;
}

export function SessionBadge({ status }: { status: WaSessionStatus }) {
  return <StateLabel value={status} label={WA_SESSION_STATUS_LABELS[status]} />;
}

export function WaBadge({ status }: { status: WaStatus | null }) {
  return <StateLabel value={status ?? 'no_phone'} label={status ? WA_STATUS_LABELS[status] : 'Sem telefone'} />;
}
