import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { campaignContacts, messages, suppressions, conversations } from '../../db/schema.ts';
import { audit, type Actor } from '../../core/audit.ts';
import { ACTIVE_PARTICIPATION_STATUSES } from '@aero/shared';
import { conflict } from '../../core/errors.ts';

export async function suppressPhone(
  tx: Tx,
  input: { phoneId: number; reason: string; detail?: string | null; actor: Actor; now: Date; campaignId?: number | null; sourceMessageId?: number | null },
): Promise<void> {
  const [existing] = await tx
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.phoneId, input.phoneId), isNull(suppressions.liftedAt))).for('update');
  if (!existing) {
    await tx.insert(suppressions).values({
      phoneId: input.phoneId,
      reason: input.reason,
      detail: input.detail ?? null,
      campaignId: input.campaignId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    });
  } else if (input.actor === 'contact' || input.sourceMessageId) {
    // A later refusal must permanently supersede an earlier reversible manual block.
    await tx.update(suppressions).set({ reason: 'recusa', detail: input.detail ?? null, sourceMessageId: input.sourceMessageId ?? null, campaignId: input.campaignId ?? null }).where(eq(suppressions.id, existing.id));
  }

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

  const convs = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneId, input.phoneId));
  if (convs.length) {
    await tx
      .update(messages)
      .set({ status: 'cancelled', error: `Cancelada: ${input.reason}` })
      .where(and(inArray(messages.conversationId, convs.map((c) => c.id)), eq(messages.status, 'scheduled')));
  }
  await audit(tx, input.actor, 'phone.suppress', 'phone', input.phoneId, { reason: input.reason, cancelledParticipations: parts.length });
}

export async function liftManualSuppression(tx: Tx, phoneId: number, reason: string, now: Date) {
  const rows = await tx.select().from(suppressions).where(and(eq(suppressions.phoneId, phoneId), isNull(suppressions.liftedAt))).for('update');
  if (rows.some((row) => row.reason !== 'manual' || row.sourceMessageId !== null)) {
    throw conflict('permanent_suppression', 'Recusa/descadastro e supressões permanentes não podem ser removidos. Somente bloqueios com motivo manual podem ser corrigidos.');
  }
  await tx.update(suppressions).set({ liftedAt: now, liftedReason: reason }).where(and(eq(suppressions.phoneId, phoneId), isNull(suppressions.liftedAt)));
  await audit(tx, 'owner', 'phone.unsuppress', 'phone', phoneId, { reason });
}
