import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { opportunities, opportunityStageHistory, payments, proposals, type OfferSnapshot } from '../../db/schema.ts';
import type { OpportunityStage, PaymentStatus, Service } from '@aero/shared';
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { audit, type Actor } from '../../core/audit.ts';

export type Opportunity = typeof opportunities.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;

export async function getOpportunity(db: DbOrTx, id: number): Promise<Opportunity> {
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id));
  if (!row) throw notFound('Oportunidade');
  return row;
}

export async function createOpportunity(
  tx: DbOrTx,
  input: {
    companyId: number;
    service: Service;
    title: string;
    stage: OpportunityStage;
    conversationId?: number | null;
    campaignId?: number | null;
    campaignContactId?: number | null;
    offerSnapshot?: OfferSnapshot | null;
    actor: Actor;
    reason?: string;
  },
): Promise<number> {
  if (input.campaignContactId) {
    // Uma oportunidade por participação: reprocessar eventos não duplica.
    const [existing] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.campaignContactId, input.campaignContactId));
    if (existing) return existing.id;
  }
  const [res] = await tx
    .insert(opportunities)
    .values({
      companyId: input.companyId,
      service: input.service,
      title: input.title.slice(0, 255),
      stage: input.stage,
      conversationId: input.conversationId ?? null,
      campaignId: input.campaignId ?? null,
      campaignContactId: input.campaignContactId ?? null,
      offerSnapshot: input.offerSnapshot ?? null,
    })
    .$returningId();
  await tx.insert(opportunityStageHistory).values({ opportunityId: res!.id, fromStage: null, toStage: input.stage, reason: input.reason ?? 'Criada', actor: input.actor });
  await audit(tx, input.actor, 'opportunity.create', 'opportunity', res!.id, { stage: input.stage, service: input.service });
  return res!.id;
}

/**
 * Mudança de etapa com histórico. "Perdido" exige motivo. "Ganho" exige proposta
 * aceita (aceite e pagamento são registros independentes).
 */
export async function changeStage(tx: DbOrTx, id: number, to: OpportunityStage, actor: Actor, reason: string | null, now: Date): Promise<void> {
  const [opp] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).for('update');
  if (!opp) throw notFound('Oportunidade');
  if (opp.stage === to) return;
  if (to === 'lost' && !reason?.trim()) throw badRequest('lost_reason_required', 'Informe o motivo da perda');
  if (to === 'won') {
    const [accepted] = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.opportunityId, id), eq(proposals.status, 'accepted')))
      .limit(1);
    if (!accepted) throw conflict('accepted_proposal_required', 'Marque uma proposta como aceita antes de mover para "Ganho"');
  }
  await tx
    .update(opportunities)
    .set({
      stage: to,
      lostReason: to === 'lost' ? reason : opp.lostReason,
      wonAt: to === 'won' ? now : to === 'lost' ? null : opp.wonAt,
      lostAt: to === 'lost' ? now : null,
    })
    .where(eq(opportunities.id, id));
  await tx.insert(opportunityStageHistory).values({ opportunityId: id, fromStage: opp.stage, toStage: to, reason, actor });
  await audit(tx, actor, 'opportunity.stage', 'opportunity', id, { from: opp.stage, to, reason });
}

export async function getProposal(db: DbOrTx, id: number): Promise<Proposal> {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!row) throw notFound('Proposta');
  return row;
}

/** Situação do pagamento derivada dos valores recebidos (na moeda da proposta). */
export async function paymentStatus(db: DbOrTx, proposal: Proposal): Promise<{ status: PaymentStatus; receivedCents: number }> {
  const [r] = await db
    .select({ total: sql<string | null>`SUM(${payments.amountCents})` })
    .from(payments)
    .where(and(eq(payments.proposalId, proposal.id), eq(payments.currency, proposal.currency)));
  const received = Number(r?.total ?? 0);
  const due = proposal.amountCents + (proposal.setupCents ?? 0);
  const status: PaymentStatus = received <= 0 ? 'pending' : received >= due ? 'confirmed' : 'partial';
  return { status, receivedCents: received };
}
