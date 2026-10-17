import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import type { Tx } from '../../db/client.ts';
import { campaignContacts, campaigns, conversations, messages, phones, suppressions } from '../../db/schema.ts';
import { HttpError } from '../../lib/http.ts';
import { getSettings } from '../settings/service.ts';
import { isValidationCurrent } from '../validation/service.ts';
import { getSessionKey } from '../whatsapp/session.ts';
import { setParticipationStatus } from '../campaigns/service.ts';
import { readMedia } from './media.ts';

export type Message = typeof messages.$inferSelect;

export type SendOutcome =
  | { kind: 'accepted'; externalId: string }
  | { kind: 'cancelled'; reason: string }
  | { kind: 'deferred'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'unknown'; reason: string };

const MAX_CONNECT_RETRIES = 3;

/**
 * Reverifica, com bloqueio da conversa, todas as regras antes de um envio AUTOMÁTICO.
 * Retorna motivo de cancelamento (definitivo) ou adiamento (temporário).
 */
async function guardAutomatic(ctx: AppContext, tx: Tx, msg: Message): Promise<{ cancel?: string; defer?: string }> {
  const [conv] = await tx.select().from(conversations).where(eq(conversations.id, msg.conversationId)).for('update');
  if (!conv) return { cancel: 'Conversa inexistente' };
  if (conv.automationPaused || conv.state === 'human') return { cancel: 'Automação pausada: atendimento humano' };

  // Resposta recebida depois do agendamento: suspende ações pendentes
  if (conv.lastInboundAt && conv.lastInboundAt > msg.createdAt && msg.purpose === 'first_contact') {
    return { cancel: 'Contato respondeu antes do envio' };
  }

  const [sup] = await tx
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.phoneId, conv.phoneId), isNull(suppressions.liftedAt)))
    .limit(1);
  // Única exceção: a confirmação (opcional) da própria recusa.
  if (sup && msg.purpose !== 'decline_ack') return { cancel: 'Contato suprimido (recusa/descadastro)' };

  const [phone] = await tx.select().from(phones).where(eq(phones.id, conv.phoneId));
  if (!phone?.e164) return { cancel: 'Telefone sem número válido' };
  if (ctx.config.sending.allowlist.length && !ctx.config.sending.allowlist.includes(phone.e164)) {
    return { cancel: 'Número fora da lista de teste (SEND_ALLOWLIST)' };
  }

  if (msg.campaignId) {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, msg.campaignId));
    if (!campaign) return { cancel: 'Campanha inexistente' };
    if (campaign.status === 'cancelled' || campaign.status === 'completed') return { cancel: `Campanha ${campaign.status}` };
    if (campaign.status !== 'active') return { defer: 'Campanha pausada' };
  }

  if (msg.campaignContactId) {
    const [cc] = await tx.select().from(campaignContacts).where(eq(campaignContacts.id, msg.campaignContactId)).for('update');
    if (!cc) return { cancel: 'Participação inexistente' };
    if (msg.purpose === 'first_contact' && cc.status !== 'scheduled') return { cancel: `Participação em estado ${cc.status}` };
    if (msg.purpose !== 'first_contact' && !['qualifying', 'qualified', 'declined'].includes(cc.status)) {
      return { cancel: `Participação em estado ${cc.status}` };
    }
  }

  if (msg.purpose === 'first_contact') {
    const settings = await getSettings(tx);
    if (!isValidationCurrent(phone, settings.validationRevalidateDays, ctx.now())) return { cancel: 'Validação de WhatsApp ausente ou vencida' };
  }
  return {};
}

async function applyOutcome(ctx: AppContext, msg: Message, outcome: SendOutcome): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    switch (outcome.kind) {
      case 'accepted': {
        // O webhook pode ter registrado o status antes; nunca rebaixa.
        await tx
          .update(messages)
          .set({ status: sql`CASE WHEN ${messages.status} IN ('delivered','read') THEN ${messages.status} ELSE 'accepted' END`, externalId: outcome.externalId, sentAt: now, error: null, lockedAt: null })
          .where(eq(messages.id, msg.id));
        // Só a primeira abordagem altera a situação da conversa (abaixo); respostas
        // automáticas — como a confirmação de recusa — não reabrem uma conversa encerrada.
        await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, msg.conversationId));
        if (msg.purpose === 'first_contact' && msg.campaignContactId) {
          const [cc] = await tx.select().from(campaignContacts).where(eq(campaignContacts.id, msg.campaignContactId));
          if (cc && cc.status === 'scheduled') await setParticipationStatus(tx, cc, 'awaiting_reply', 'system', null, { firstSentAt: now });
          await tx.update(conversations).set({ activeCampaignContactId: msg.campaignContactId, state: 'awaiting_reply' }).where(eq(conversations.id, msg.conversationId));
          if (msg.campaignId) await tx.update(campaigns).set({ lastDispatchAt: now }).where(eq(campaigns.id, msg.campaignId));
        }
        break;
      }
      case 'cancelled':
        await tx.update(messages).set({ status: 'cancelled', error: outcome.reason.slice(0, 500), lockedAt: null }).where(eq(messages.id, msg.id));
        if (msg.purpose === 'first_contact' && msg.campaignContactId) {
          const [cc] = await tx.select().from(campaignContacts).where(eq(campaignContacts.id, msg.campaignContactId));
          if (cc && cc.status === 'scheduled') await setParticipationStatus(tx, cc, 'cancelled', 'system', outcome.reason);
        }
        break;
      case 'deferred':
        await tx
          .update(messages)
          .set({ status: 'scheduled', error: outcome.reason.slice(0, 500), lockedAt: null, scheduledFor: new Date(now.getTime() + 5 * 60_000) })
          .where(eq(messages.id, msg.id));
        break;
      case 'failed':
        await tx.update(messages).set({ status: 'failed', error: outcome.reason.slice(0, 500), lockedAt: null }).where(eq(messages.id, msg.id));
        break;
      case 'unknown':
        // Sem reenvio automático: pode ter sido entregue ao WhatsApp.
        await tx.update(messages).set({ status: 'unknown', error: outcome.reason.slice(0, 500), sentAt: now, lockedAt: null }).where(eq(messages.id, msg.id));
        break;
    }
  });
  await ctx.events.publish({ type: 'message.updated', conversationId: msg.conversationId, messageId: msg.id });
  await ctx.events.publish({ type: 'conversation.updated', conversationId: msg.conversationId });
}

/**
 * Envia uma mensagem já registrada (status `scheduled`). Fluxo:
 *  1) transação curta: reverificação + `processing` (impede envio duplo);
 *  2) chamada ao gateway fora da transação;
 *  3) registro do resultado. Timeout/erro 5xx => `unknown` (sem reenvio cego).
 */
export async function sendMessage(ctx: AppContext, messageId: number): Promise<SendOutcome> {
  const prep = await ctx.db.transaction(async (tx) => {
    const [msg] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
    if (!msg) return { msg: null, outcome: { kind: 'cancelled', reason: 'Mensagem inexistente' } as SendOutcome };
    if (msg.status !== 'scheduled') return { msg: null, outcome: { kind: 'cancelled', reason: `Estado atual: ${msg.status}` } as SendOutcome };
    if (!ctx.config.sending.enabled) return { msg, outcome: { kind: 'deferred', reason: 'Envio desabilitado (SENDING_ENABLED=false)' } as SendOutcome };
    if (msg.origin === 'automatic') {
      const g = await guardAutomatic(ctx, tx, msg);
      if (g.cancel) return { msg, outcome: { kind: 'cancelled', reason: g.cancel } as SendOutcome };
      if (g.defer) return { msg, outcome: { kind: 'deferred', reason: g.defer } as SendOutcome };
    } else {
      const [conv] = await tx.select().from(conversations).where(eq(conversations.id, msg.conversationId)).for('update');
      const [phone] = conv ? await tx.select().from(phones).where(eq(phones.id, conv.phoneId)) : [];
      if (phone?.e164 && ctx.config.sending.allowlist.length && !ctx.config.sending.allowlist.includes(phone.e164)) {
        return { msg, outcome: { kind: 'failed', reason: 'Número fora da lista de teste (SEND_ALLOWLIST)' } as SendOutcome };
      }
    }
    await tx.update(messages).set({ status: 'processing', lockedAt: ctx.now(), attempts: sql`${messages.attempts} + 1` }).where(eq(messages.id, msg.id));
    return { msg: { ...msg, attempts: msg.attempts + 1 }, outcome: null };
  });

  if (!prep.msg) return prep.outcome!;
  if (prep.outcome) {
    await applyOutcome(ctx, prep.msg, prep.outcome);
    return prep.outcome;
  }
  const msg = prep.msg;
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
  let outcome: SendOutcome;
  try {
    const sessionKey = getSessionKey(ctx);
    const res = msg.media
      ? await ctx.wa.sendMedia(sessionKey, conv!.jid, await readMedia(ctx, msg.media), msg.body ?? '')
      : await ctx.wa.sendText(sessionKey, conv!.jid, msg.body ?? '');
    outcome = { kind: 'accepted', externalId: res.externalId };
  } catch (err) {
    if (err instanceof HttpError && err.kind === 'connect') {
      // Não chegou ao gateway: seguro tentar de novo depois
      outcome =
        msg.attempts < MAX_CONNECT_RETRIES
          ? { kind: 'deferred', reason: `Gateway inacessível: ${err.message}` }
          : { kind: 'failed', reason: `Gateway inacessível após ${msg.attempts} tentativas` };
    } else if (err instanceof HttpError && err.outcomeUnknown) {
      outcome = { kind: 'unknown', reason: `Resultado desconhecido: ${err.message}` };
    } else if (err instanceof HttpError && err.kind === 'http') {
      outcome = { kind: 'failed', reason: err.message };
    } else {
      outcome = { kind: 'unknown', reason: `Erro inesperado após chamada: ${(err as Error).message}` };
    }
  }
  await applyOutcome(ctx, msg, outcome);
  ctx.log.info({ messageId: msg.id, outcome: outcome.kind }, 'Envio processado');
  return outcome;
}

/** Mensagens presas em `processing` (ex.: worker reiniciado no meio do envio) viram `unknown`. */
export async function recoverStuckProcessing(ctx: AppContext, olderThanMs = 120_000): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - olderThanMs);
  const res = await ctx.db
    .update(messages)
    .set({ status: 'unknown', error: 'Envio interrompido; resultado desconhecido (verifique antes de reenviar)', lockedAt: null })
    .where(and(eq(messages.status, 'processing'), sql`${messages.lockedAt} < ${cutoff}`));
  return (res[0] as { affectedRows: number }).affectedRows;
}

/**
 * Reconciliação de envios com resultado desconhecido: procura no histórico do
 * gateway uma mensagem nossa com o mesmo conteúdo enviada perto do horário.
 */
export async function reconcileUnknown(ctx: AppContext, limit = 20): Promise<number> {
  const rows = await ctx.db
    .select({ m: messages, jid: conversations.jid })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.status, 'unknown'), isNull(messages.externalId), gt(messages.sentAt, new Date(ctx.now().getTime() - 7 * 86400_000))))
    .limit(limit);
  let resolved = 0;
  for (const { m, jid } of rows) {
    try {
      const history = await ctx.wa.getChatMessages(getSessionKey(ctx), jid);
      const sentAt = m.sentAt?.getTime() ?? 0;
      const match = history.find(
        (h) => h.fromMe && (h.content ?? '').trim() === (m.body ?? '').trim() && Math.abs(new Date(h.timestamp).getTime() - sentAt) < 10 * 60_000,
      );
      if (!match) continue;
      const [taken] = await ctx.db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, m.conversationId), eq(messages.externalId, match.keyId)));
      if (taken) continue;
      await applyOutcome(ctx, m, { kind: 'accepted', externalId: match.keyId });
      await ctx.db.update(messages).set({ error: 'Confirmada por reconciliação com o histórico do gateway' }).where(eq(messages.id, m.id));
      resolved++;
    } catch (err) {
      ctx.log.debug({ err: (err as Error).message }, 'Reconciliação adiada');
    }
  }
  return resolved;
}

export const _test = { guardAutomatic, applyOutcome };
