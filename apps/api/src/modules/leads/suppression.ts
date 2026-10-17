import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { campaignContacts, messages, suppressions, conversations } from '../../db/schema.ts';
import { audit, type Actor } from '../../core/audit.ts';
import { ACTIVE_PARTICIPATION_STATUSES } from '@aero/shared';

/**
 * Registra supressão persistente do telefone (recusa, descadastro ou bloqueio manual)
 * e cancela tudo que estiver pendente para ele. Vale para novas campanhas e
 * sobrevive a reimportações (a supressão é ligada ao telefone, não à coleta).
 */
export async function suppressPhone(
  tx: Tx,
  input: { phoneId: number; reason: string; detail?: string | null; actor: Actor; now: Date; campaignId?: number | null; sourceMessageId?: number | null },
): Promise<void> {
  const [existing] = await tx
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.phoneId, input.phoneId), isNull(suppressions.liftedAt)));
  if (!existing) {
    await tx.insert(suppressions).values({
      phoneId: input.phoneId,
      reason: input.reason,
      detail: input.detail ?? null,
      campaignId: input.campaignId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    });
  }

  // Encerra participações em andamento
  const parts = await tx
    .select({ id: campaignContacts.id, status: campaignContacts.status })
    .from(campaignContacts)
    .where(and(eq(campaignContacts.phoneId, input.phoneId), inArray(campaignContacts.status, ['selected', ...ACTIVE_PARTICIPATION_STATUSES])));
  for (const p of parts) {
    await tx
      .update(campaignContacts)
      .set({ status: 'declined', statusReason: input.reason, closedAt: input.now })
      .where(eq(campaignContacts.id, p.id));
  }

  // Cancela envios automáticos agendados para o telefone
  const convs = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneId, input.phoneId));
  if (convs.length) {
    await tx
      .update(messages)
      .set({ status: 'cancelled', error: `Cancelada: ${input.reason}` })
      .where(and(inArray(messages.conversationId, convs.map((c) => c.id)), eq(messages.status, 'scheduled')));
  }
  await audit(tx, input.actor, 'phone.suppress', 'phone', input.phoneId, { reason: input.reason, cancelledParticipations: parts.length });
}
