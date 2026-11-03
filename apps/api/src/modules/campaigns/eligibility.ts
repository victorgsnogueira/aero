import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { campaignContacts, conversations, phones, suppressions } from '../../db/schema.ts';
import { ACTIVE_PARTICIPATION_STATUSES } from '@aero/shared';
import { isValidationCurrent } from '../validation/service.ts';

export type IneligibleReason =
  | 'invalid_format'
  | 'validation_pending'
  | 'validation_stale'
  | 'whatsapp_not_found'
  | 'validation_inconclusive'
  | 'suppressed'
  | 'conflict_other_campaign'
  | 'human_handling'
  | 'not_in_allowlist';

export const INELIGIBLE_LABELS: Record<IneligibleReason, string> = {
  invalid_format: 'Telefone com formato inválido ou em revisão',
  validation_pending: 'WhatsApp ainda não validado',
  validation_stale: 'Validação vencida; revalidar antes do envio',
  whatsapp_not_found: 'WhatsApp não encontrado',
  validation_inconclusive: 'Validação inconclusiva',
  suppressed: 'Contato recusou ou foi descadastrado',
  conflict_other_campaign: 'Contato em abordagem ativa em outra campanha',
  human_handling: 'Conversa em atendimento humano',
  not_in_allowlist: 'Fora da lista de teste (SEND_ALLOWLIST)',
};

export const TRANSIENT_REASONS: IneligibleReason[] = ['validation_pending', 'validation_stale', 'validation_inconclusive'];

export interface EligibilityInput {
  phoneId: number;
  campaignId: number;
  sessionId: number | null;
  revalidateDays: number;
  allowlist: string[];
  now: Date;
}

export async function checkEligibility(db: DbOrTx, input: EligibilityInput): Promise<IneligibleReason[]> {
  const reasons: IneligibleReason[] = [];
  const [phone] = await db.select().from(phones).where(eq(phones.id, input.phoneId));
  if (!phone || phone.formatStatus !== 'valid' || !phone.e164) return ['invalid_format'];

  if (phone.waStatus === 'not_found') reasons.push('whatsapp_not_found');
  else if (phone.waStatus === 'inconclusive') reasons.push('validation_inconclusive');
  else if (phone.waStatus === 'pending' || phone.waStatus === 'invalid_format') reasons.push('validation_pending');
  else if (!isValidationCurrent(phone, input.revalidateDays, input.now)) reasons.push('validation_stale');

  const [sup] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.phoneId, input.phoneId), isNull(suppressions.liftedAt)))
    .limit(1);
  if (sup) reasons.push('suppressed');

  const [other] = await db
    .select({ id: campaignContacts.id })
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.phoneId, input.phoneId),
        ne(campaignContacts.campaignId, input.campaignId),
        inArray(campaignContacts.status, [...ACTIVE_PARTICIPATION_STATUSES]),
      ),
    )
    .limit(1);
  if (other) reasons.push('conflict_other_campaign');

  if (input.sessionId) {
    const [conv] = await db
      .select({ state: conversations.state, paused: conversations.automationPaused })
      .from(conversations)
      .where(and(eq(conversations.phoneId, input.phoneId), eq(conversations.sessionId, input.sessionId)));
    if (conv && (conv.paused || conv.state === 'human' || conv.state === 'awaiting_human')) reasons.push('human_handling');
  }

  if (input.allowlist.length > 0 && !input.allowlist.includes(phone.e164)) reasons.push('not_in_allowlist');
  return reasons;
}

export async function overlapCount(db: DbOrTx, campaignId: number): Promise<number> {
  const [rows] = await db.execute(sql`
    SELECT COUNT(DISTINCT cc.phone_id) AS n FROM campaign_contacts cc
    JOIN campaign_contacts o ON o.phone_id = cc.phone_id AND o.campaign_id <> cc.campaign_id
    WHERE cc.campaign_id = ${campaignId}`);
  return Number((rows as unknown as { n: string }[])[0]?.n ?? 0);
}
