import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import type { Tx } from '../../db/client.ts';
import { campaignContacts, campaigns, conversations, messages, phones, webhookEvents, waSessions } from '../../db/schema.ts';
import type { WaWebhookPayload } from '../../integrations/wa/webhook.ts';
import { mapSessionStatus } from '../../integrations/wa/client.ts';
import { isLidJid, jidToE164, normalizePhone } from '../../lib/phone.ts';
import { ensureConversation } from '../inbox/conversations.ts';
import { ensureSessionRow, getSessionKey } from '../whatsapp/session.ts';
import { classifyReply, type Classification } from './classifier.ts';
import { suppressPhone } from '../leads/suppression.ts';
import { setParticipationStatus } from '../campaigns/service.ts';
import { renderFor } from '../campaigns/render.ts';
import { getSettings } from '../settings/service.ts';
import { changeStage, createOpportunity } from '../opportunities/service.ts';
import { enqueue } from '../../core/outbox.ts';
import { audit } from '../../core/audit.ts';
import { SERVICE_LABELS, type MessageStatus } from '@aero/shared';

// Processamento dos eventos do gateway (executado pelo worker).
// Idempotência: cada evento é processado uma vez (webhook_events.processed_at) e
// mensagens são únicas por (conversa, id externo). Eventos fora de ordem não
// rebaixam estados (ex.: "lida" não volta para "entregue").

type Data = Record<string, unknown>;

const STATUS_RANK: Partial<Record<MessageStatus, number>> = { processing: 1, unknown: 1, accepted: 2, delivered: 3, read: 4 };

export class RetryLater extends Error {}

async function phoneForJid(tx: Tx, jid: string, pushName: string | null): Promise<{ id: number; jid: string; lid: string | null }> {
  const e164 = jidToE164(jid);
  if (e164) {
    const n = normalizePhone(e164, null);
    const key = n.e164 ?? `raw:XX:${e164.replace(/\D/g, '')}`;
    await tx
      .insert(phones)
      .values({ e164: n.e164, dedupeKey: key, rawSample: e164, countryCode: n.countryCode, formatStatus: n.formatStatus, formatNote: n.note, waStatus: 'found', waJid: jid })
      .onDuplicateKeyUpdate({ set: { waJid: sql`COALESCE(${phones.waJid}, ${jid})` } });
    const [row] = await tx.select({ id: phones.id }).from(phones).where(eq(phones.dedupeKey, key));
    return { id: row!.id, jid, lid: null };
  }
  // LID não resolvido para telefone: mantém a conversa identificada pelo LID, para revisão.
  const key = `lid:${jid}`.slice(0, 64);
  await tx
    .insert(phones)
    .values({ e164: null, dedupeKey: key, rawSample: (pushName ?? jid).slice(0, 64), formatStatus: 'needs_review', formatNote: 'Contato identificado apenas por LID', waStatus: 'found', waJid: jid })
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  const [row] = await tx.select({ id: phones.id }).from(phones).where(eq(phones.dedupeKey, key));
  return { id: row!.id, jid, lid: isLidJid(jid) ? jid : null };
}

function messageText(d: Data): string | null {
  const content = typeof d.content === 'string' ? d.content : null;
  const caption = typeof d.caption === 'string' ? d.caption : null;
  return (content || caption || '').trim() || null;
}

function occurredAt(d: Data, fallback: Date): Date {
  const ts = d.messageTimestamp ?? d.timestamp;
  const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
  if (!Number.isFinite(n)) return fallback;
  return new Date(n > 1e12 ? n : n * 1000);
}

async function scheduleAutomatic(
  tx: Tx,
  ctx: AppContext,
  input: { conversationId: number; campaignId: number | null; campaignContactId: number | null; purpose: string; body: string; key: string },
): Promise<void> {
  await tx
    .insert(messages)
    .ignore()
    .values({
      conversationId: input.conversationId,
      direction: 'out',
      origin: 'automatic',
      status: 'scheduled',
      body: input.body,
      campaignId: input.campaignId,
      campaignContactId: input.campaignContactId,
      purpose: input.purpose,
      idempotencyKey: input.key.slice(0, 128),
      scheduledFor: ctx.now(),
      occurredAt: ctx.now(),
    });
}

function questionBlock(questions: { key: string; text: string }[], from: number, perMessage: number): { text: string; keys: string[] } {
  const block = questions.slice(from, from + perMessage);
  return { text: block.map((q) => q.text).join('\n\n'), keys: block.map((q) => q.key) };
}

/** Decide o próximo passo após uma mensagem do contato (regras da seção 17). */
async function applyAutomation(tx: Tx, ctx: AppContext, convId: number, inboundMessageId: number, text: string | null): Promise<string> {
  const [conv] = await tx.select().from(conversations).where(eq(conversations.id, convId)).for('update');
  if (!conv) return 'sem conversa';

  // Regra 4: qualquer resposta suspende as ações automáticas pendentes
  await tx
    .update(messages)
    .set({ status: 'cancelled', error: 'Suspensa: contato respondeu' })
    .where(and(eq(messages.conversationId, convId), eq(messages.status, 'scheduled'), eq(messages.origin, 'automatic')));

  const [cc] = await tx
    .select()
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.phoneId, conv.phoneId),
        inArray(campaignContacts.status, ['sent', 'awaiting_reply', 'replied', 'qualifying', 'qualified', 'handed_off']),
      ),
    )
    .orderBy(desc(campaignContacts.firstSentAt), desc(campaignContacts.id))
    .limit(1)
    .for('update');

  const context = cc?.status === 'qualifying' ? 'qualification' : 'first_contact';
  const cls: Classification = classifyReply(text, context);
  await tx.update(messages).set({ purpose: `reply:${cls.kind}` }).where(eq(messages.id, inboundMessageId));

  // Recusa tem prioridade sobre qualquer estado (inclusive atendimento humano)
  if (cls.kind === 'refusal') {
    await suppressPhone(tx, { phoneId: conv.phoneId, reason: 'recusa', detail: cls.reason, actor: 'contact', now: ctx.now(), campaignId: cc?.campaignId ?? null, sourceMessageId: inboundMessageId });
    const opps = await tx.execute(sql`SELECT id FROM opportunities WHERE conversation_id = ${convId} AND stage NOT IN ('won','lost')`);
    for (const o of (opps[0] as unknown as { id: number }[]) ?? []) await changeStage(tx, Number(o.id), 'lost', 'contact', 'Contato recusou', ctx.now());
    await tx.update(conversations).set({ state: 'closed', automationPaused: false }).where(eq(conversations.id, convId));
    if (cc?.campaignId && !conv.automationPaused) {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, cc.campaignId));
      if (campaign?.declineAckTemplate?.trim()) {
        await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'decline_ack', body: campaign.declineAckTemplate.trim(), key: `ack:${inboundMessageId}` });
      }
    }
    return 'recusa registrada';
  }

  // Atendimento humano: automação pausada até ação explícita
  if (conv.automationPaused || conv.state === 'human') return 'atendimento humano';

  if (!cc || ['qualified', 'handed_off'].includes(cc.status)) {
    await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
    return 'aguardando atendimento';
  }

  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, cc.campaignId));
  if (!campaign || campaign.status === 'cancelled') {
    await setParticipationStatus(tx, cc, 'handed_off', 'system', 'Campanha indisponível');
    await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
    return 'aguardando atendimento';
  }

  if (cls.kind === 'auto_reply') {
    // Não avança nem encaminha: aguarda uma resposta de pessoa.
    return 'resposta automática ignorada';
  }

  const settings = await getSettings(tx);
  const questions = campaign.qualificationQuestions ?? [];
  const company = await tx.execute(sql`SELECT c.name, c.category, c.city, c.id FROM companies c WHERE c.id = ${cc.companyId}`);
  const companyRow = (company[0] as unknown as { name: string; category: string | null; city: string | null; id: number }[])[0] ?? null;

  if (cc.status === 'awaiting_reply' || cc.status === 'sent' || cc.status === 'replied') {
    if (cls.kind !== 'affirmative') {
      await setParticipationStatus(tx, cc, 'handed_off', 'system', `Resposta para revisão: ${cls.reason}`, { repliedAt: ctx.now() });
      await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
      return 'encaminhada para atendimento';
    }
    // Afirmativa: oportunidade em qualificação com a oferta apresentada
    await createOpportunity(tx, {
      companyId: cc.companyId,
      service: campaign.service,
      title: `${companyRow?.name ?? 'Contato'} — ${SERVICE_LABELS[campaign.service]}`,
      stage: 'qualification',
      conversationId: convId,
      campaignId: campaign.id,
      campaignContactId: cc.id,
      offerSnapshot: cc.offerSnapshot ?? null,
      actor: 'system',
      reason: 'Contato aceitou continuar',
    });
    const parts: string[] = [];
    if (campaign.presentationTemplate?.trim()) {
      const r = renderFor(campaign.presentationTemplate, settings, companyRow, cc.offerSnapshot ?? null);
      if (!r.missing.length && !r.unknown.length) parts.push(r.text);
    }
    if (questions.length === 0) {
      await setParticipationStatus(tx, cc, 'qualified', 'system', 'Sem perguntas configuradas', { repliedAt: ctx.now() });
      await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
      if (parts.length) await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'presentation', body: parts.join('\n\n'), key: `pres:${cc.id}` });
      return 'qualificação dispensada';
    }
    const block = questionBlock(questions, 0, campaign.questionsPerMessage);
    await setParticipationStatus(tx, cc, 'qualifying', 'system', null, { repliedAt: ctx.now(), qualificationIndex: 0 });
    await tx.update(conversations).set({ state: 'awaiting_reply' }).where(eq(conversations.id, convId));
    if (parts.length) await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'presentation', body: parts.join('\n\n'), key: `pres:${cc.id}` });
    await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'qualification', body: block.text, key: `q:${cc.id}:0` });
    return 'qualificação iniciada';
  }

  if (cc.status === 'qualifying') {
    const answers = { ...(cc.answers ?? {}) };
    const block = questionBlock(questions, cc.qualificationIndex, campaign.questionsPerMessage);
    if (cls.kind === 'question') {
      // Dúvidas e negociação vão para atendimento humano (respostas já obtidas são preservadas)
      await setParticipationStatus(tx, cc, 'handed_off', 'system', `Dúvida fora do roteiro: ${cls.reason}`, { answers });
      await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
      await tx.execute(sql`UPDATE opportunities SET qualification_answers = ${JSON.stringify(answers)} WHERE campaign_contact_id = ${cc.id}`);
      return 'dúvida encaminhada';
    }
    const key = block.keys.length === 1 ? block.keys[0]! : block.keys.join('+');
    if (key) answers[key] = answers[key] ? `${answers[key]}\n${text ?? ''}` : (text ?? '');
    const nextIndex = cc.qualificationIndex + campaign.questionsPerMessage;
    await tx.execute(sql`UPDATE opportunities SET qualification_answers = ${JSON.stringify(answers)} WHERE campaign_contact_id = ${cc.id}`);
    if (nextIndex >= questions.length) {
      await setParticipationStatus(tx, cc, 'qualified', 'system', 'Perguntas respondidas', { answers, qualificationIndex: nextIndex });
      await tx.update(conversations).set({ state: 'awaiting_human' }).where(eq(conversations.id, convId));
      if (campaign.qualificationDoneTemplate?.trim()) {
        await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'qualification_done', body: campaign.qualificationDoneTemplate.trim(), key: `qdone:${cc.id}` });
      }
      return 'qualificação concluída';
    }
    await tx.update(campaignContacts).set({ answers, qualificationIndex: nextIndex }).where(eq(campaignContacts.id, cc.id));
    const next = questionBlock(questions, nextIndex, campaign.questionsPerMessage);
    await scheduleAutomatic(tx, ctx, { conversationId: convId, campaignId: campaign.id, campaignContactId: cc.id, purpose: 'qualification', body: next.text, key: `q:${cc.id}:${nextIndex}` });
    return 'próxima pergunta';
  }
  return 'sem ação';
}

async function handleReceived(tx: Tx, ctx: AppContext, sessionId: number, d: Data): Promise<{ conversationId: number | null; note: string }> {
  if (d.isGroup === true || (typeof d.chatType === 'string' && d.chatType !== 'PERSONAL')) return { conversationId: null, note: 'ignorado (não pessoal)' };
  const key = (d.key ?? {}) as { id?: string; remoteJid?: string };
  const from = (typeof d.from === 'string' && d.from) || key.remoteJid;
  if (!key.id || !from) return { conversationId: null, note: 'sem identificadores' };
  const pushName = typeof d.pushName === 'string' ? d.pushName : null;
  const phone = await phoneForJid(tx, from, pushName);
  const conv = await ensureConversation(tx, { sessionId, phoneId: phone.id, jid: phone.lid ? from : from.replace(/:\d+@/, '@'), displayName: pushName, lid: phone.lid });
  const text = messageText(d);
  const at = occurredAt(d, ctx.now());
  const ins = await tx
    .insert(messages)
    .ignore()
    .values({
      conversationId: conv.id,
      direction: 'in',
      origin: 'contact',
      status: 'received',
      kind: typeof d.type === 'string' ? d.type.toLowerCase() : 'text',
      body: text,
      externalId: key.id,
      occurredAt: at,
      media: typeof d.fileUrl === 'string' && d.fileUrl ? { kind: String(d.type ?? 'file').toLowerCase(), mimeType: '', fileName: '', size: 0, storageKey: null, gatewayUrl: String(d.fileUrl) } : null,
    });
  if ((ins[0] as { affectedRows: number }).affectedRows === 0) return { conversationId: conv.id, note: 'duplicada' };
  const msgId = (ins[0] as { insertId: number }).insertId;
  await tx
    .update(conversations)
    .set({ unreadCount: sql`${conversations.unreadCount} + 1`, lastInboundAt: ctx.now(), lastMessageAt: at })
    .where(eq(conversations.id, conv.id));
  const note = await applyAutomation(tx, ctx, conv.id, msgId, text);
  await enqueue(tx, 'dispatch.tick', {}, { dedupeKey: 'dispatch.tick' });
  return { conversationId: conv.id, note };
}

async function handleSent(tx: Tx, ctx: AppContext, sessionId: number, d: Data): Promise<{ conversationId: number | null; note: string }> {
  const key = (d.key ?? {}) as { id?: string; remoteJid?: string };
  const to = (typeof d.receiver === 'string' && d.receiver) || key.remoteJid;
  if (!key.id || !to || d.isGroup === true || (typeof d.chatType === 'string' && d.chatType !== 'PERSONAL')) return { conversationId: null, note: 'ignorado' };

  // Já registrada (envio feito pelo aero)?
  const [known] = await tx.select({ id: messages.id, conversationId: messages.conversationId }).from(messages).where(eq(messages.externalId, key.id)).limit(1);
  if (known) return { conversationId: known.conversationId, note: 'envio do aero confirmado' };

  const phone = await phoneForJid(tx, to, null);
  const conv = await ensureConversation(tx, { sessionId, phoneId: phone.id, jid: to.replace(/:\d+@/, '@'), lid: phone.lid });
  const text = messageText(d);

  // Corrida: o webhook chegou antes de o aero gravar o id externo do próprio envio
  const [inflight] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), inArray(messages.status, ['processing', 'unknown']), isNull(messages.externalId), sql`${messages.body} <=> ${text}`))
    .limit(1);
  if (inflight) {
    await tx.update(messages).set({ externalId: key.id, status: 'accepted' }).where(eq(messages.id, inflight.id));
    return { conversationId: conv.id, note: 'envio do aero vinculado' };
  }

  // Mensagem enviada pelo próprio celular: registra e assume como atendimento humano
  await tx
    .insert(messages)
    .ignore()
    .values({ conversationId: conv.id, direction: 'out', origin: 'phone', status: 'accepted', body: text, externalId: key.id, occurredAt: occurredAt(d, ctx.now()), sentAt: ctx.now() });
  await tx
    .update(messages)
    .set({ status: 'cancelled', error: 'Suspensa: você enviou mensagem pelo celular' })
    .where(and(eq(messages.conversationId, conv.id), eq(messages.status, 'scheduled'), eq(messages.origin, 'automatic')));
  await tx.update(conversations).set({ automationPaused: true, state: 'human', lastMessageAt: ctx.now() }).where(eq(conversations.id, conv.id));
  return { conversationId: conv.id, note: 'mensagem do celular registrada; automação pausada' };
}

async function handleStatus(tx: Tx, d: Data): Promise<{ conversationId: number | null; note: string }> {
  const keyId = typeof d.keyId === 'string' ? d.keyId : null;
  const raw = String(d.status ?? '').toUpperCase();
  const target: MessageStatus | null = raw === 'DELIVERED' ? 'delivered' : raw === 'READ' ? 'read' : raw === 'SENT' ? 'accepted' : null;
  if (!keyId || !target) return { conversationId: null, note: 'status ignorado' };
  const [msg] = await tx.select().from(messages).where(and(eq(messages.externalId, keyId), eq(messages.direction, 'out'))).limit(1).for('update');
  if (!msg) {
    // Pode ter chegado antes do registro do envio: tenta de novo mais tarde
    throw new RetryLater(`Mensagem ${keyId} ainda não registrada`);
  }
  const current = STATUS_RANK[msg.status] ?? 0;
  if ((STATUS_RANK[target] ?? 0) <= current) return { conversationId: msg.conversationId, note: 'status já registrado' };
  const now = new Date();
  await tx
    .update(messages)
    .set({ status: target, deliveredAt: target === 'delivered' || target === 'read' ? (msg.deliveredAt ?? now) : msg.deliveredAt, readAt: target === 'read' ? now : msg.readAt })
    .where(eq(messages.id, msg.id));
  return { conversationId: msg.conversationId, note: `status ${target}` };
}

export async function processWebhookEvent(ctx: AppContext, eventId: number): Promise<string> {
  const [evt] = await ctx.db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (!evt) return 'evento inexistente';
  if (evt.processedAt) return 'já processado';
  const payload = evt.payload as WaWebhookPayload;
  const d = (payload.data ?? {}) as Data;
  const session = await ensureSessionRow(ctx.db, getSessionKey(ctx));

  try {
    const result = await ctx.db.transaction(async (tx) => {
      // Reivindica o evento (processamento único mesmo com jobs duplicados)
      const [locked] = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).for('update');
      if (!locked || locked.processedAt) return { conversationId: null, note: 'já processado' };
      let r: { conversationId: number | null; note: string };
      switch (payload.event) {
        case 'message.received':
          r = await handleReceived(tx, ctx, session.id, d);
          break;
        case 'message.sent':
          r = await handleSent(tx, ctx, session.id, d);
          break;
        case 'message.status':
          r = await handleStatus(tx, d);
          break;
        case 'connection.update': {
          const status = mapSessionStatus(String(d.status ?? ''));
          await tx.update(waSessions).set({ status, lastEventAt: new Date() }).where(eq(waSessions.id, session.id));
          await audit(tx, 'system', 'wa.connection', 'wa_session', session.id, { status });
          r = { conversationId: null, note: `sessão ${status}` };
          break;
        }
        default:
          r = { conversationId: null, note: 'evento ignorado' };
      }
      await tx.update(webhookEvents).set({ processedAt: new Date(), error: null, attempts: sql`${webhookEvents.attempts} + 1` }).where(eq(webhookEvents.id, eventId));
      return r;
    });
    if (result.conversationId) await ctx.events.publish({ type: 'conversation.updated', conversationId: result.conversationId });
    if (payload.event === 'connection.update') await ctx.events.publish({ type: 'wa.session', status: String(d.status ?? '') });
    return result.note;
  } catch (err) {
    await ctx.db
      .update(webhookEvents)
      .set({ error: (err as Error).message.slice(0, 2000), attempts: sql`${webhookEvents.attempts} + 1` })
      .where(eq(webhookEvents.id, eventId));
    throw err;
  }
}

export const _test = { applyAutomation, handleReceived, handleSent, handleStatus };
