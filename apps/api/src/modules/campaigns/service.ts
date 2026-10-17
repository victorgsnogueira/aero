import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../../core/context.ts';
import type { Db, DbOrTx, Tx } from '../../db/client.ts';
import { campaignContactEvents, campaignContacts, campaigns, companies, companyPhones, messages, phones } from '../../db/schema.ts';
import { CAMPAIGN_TRANSITIONS, type CampaignStatus, type ParticipationStatus } from '@aero/shared';
import { badRequest, conflict, notFound, precondition } from '../../core/errors.ts';
import { audit, type Actor } from '../../core/audit.ts';
import { enqueue } from '../../core/outbox.ts';
import { assertOutreachReady, getSettings } from '../settings/service.ts';
import { getOffer, snapshotOffer } from '../offers/service.ts';
import { checkEligibility, INELIGIBLE_LABELS, TRANSIENT_REASONS } from './eligibility.ts';
import { renderFor } from './render.ts';
import { ensureConversation } from '../inbox/conversations.ts';
import { ensureSessionRow, getSessionKey } from '../whatsapp/session.ts';
import { e164ToJid } from '../../lib/phone.ts';
import { leadWhere, type LeadFilters } from '../leads/queries.ts';

export type Campaign = typeof campaigns.$inferSelect;

export async function getCampaign(db: DbOrTx, id: number): Promise<Campaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw notFound('Campanha');
  return row;
}

export async function setParticipationStatus(
  tx: DbOrTx,
  cc: { id: number; status: ParticipationStatus },
  to: ParticipationStatus,
  actor: Actor,
  reason: string | null,
  extra: Partial<typeof campaignContacts.$inferInsert> = {},
): Promise<void> {
  await tx
    .update(campaignContacts)
    .set({ status: to, statusReason: reason, ...extra })
    .where(eq(campaignContacts.id, cc.id));
  if (cc.status !== to) {
    await tx.insert(campaignContactEvents).values({ campaignContactId: cc.id, fromStatus: cc.status, toStatus: to, reason, actor });
  }
}

/**
 * Adiciona empresas ao público da campanha (um registro por telefone).
 * Telefones já presentes na campanha não são duplicados. Telefones compartilhados
 * por várias empresas entram uma única vez.
 */
export async function addAudience(db: Db, campaignId: number, sel: { companyIds?: number[]; filters?: LeadFilters }, limit = 5000): Promise<{ added: number; skipped: number }> {
  const campaign = await getCampaign(db, campaignId);
  if (campaign.status === 'completed' || campaign.status === 'cancelled') throw conflict('campaign_closed', 'Campanha encerrada');
  let companyIds = sel.companyIds ?? [];
  if (sel.filters) {
    const [rows] = await db.execute(sql`SELECT c.id FROM companies c WHERE ${leadWhere(sel.filters)} ORDER BY c.id LIMIT ${limit}`);
    companyIds = [...new Set([...companyIds, ...(rows as unknown as { id: number }[]).map((r) => Number(r.id))])];
  }
  if (companyIds.length === 0) return { added: 0, skipped: 0 };
  return db.transaction(async (tx) => {
    const links = await tx
      .select({ companyId: companyPhones.companyId, phoneId: companyPhones.phoneId, formatStatus: phones.formatStatus })
      .from(companyPhones)
      .innerJoin(phones, eq(phones.id, companyPhones.phoneId))
      .where(inArray(companyPhones.companyId, companyIds));
    let added = 0;
    let skipped = 0;
    const seen = new Set<number>();
    for (const l of links) {
      if (seen.has(l.phoneId) || l.formatStatus !== 'valid') {
        skipped++;
        continue;
      }
      seen.add(l.phoneId);
      const res = await tx.insert(campaignContacts).ignore().values({ campaignId, companyId: l.companyId, phoneId: l.phoneId, status: 'selected' });
      if ((res[0] as { affectedRows: number }).affectedRows > 0) added++;
      else skipped++;
    }
    await audit(tx, 'owner', 'campaign.audience.add', 'campaign', campaignId, { added, skipped });
    return { added, skipped };
  });
}

export async function removeFromAudience(db: Db, campaignId: number, ids: number[]): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(campaignContacts)
      .where(and(eq(campaignContacts.campaignId, campaignId), inArray(campaignContacts.id, ids), inArray(campaignContacts.status, ['selected', 'blocked', 'scheduled'])));
    for (const r of rows) {
      await setParticipationStatus(tx, r, 'excluded', 'owner', 'Removido manualmente');
      await tx
        .update(messages)
        .set({ status: 'cancelled', error: 'Contato removido da campanha' })
        .where(and(eq(messages.campaignContactId, r.id), eq(messages.status, 'scheduled')));
    }
    return rows.length;
  });
}

/** Pré-condições para acionar uma campanha. */
export async function assertCampaignReady(ctx: AppContext, c: Campaign): Promise<void> {
  const settings = await getSettings(ctx.db);
  assertOutreachReady(settings);
  if (!c.offerId) throw precondition('offer_required', 'Selecione a oferta da campanha');
  if (!c.firstMessageTemplate?.trim()) throw precondition('template_required', 'Escreva a mensagem de primeira abordagem');
  const offer = snapshotOffer(await getOffer(ctx.db, c.offerId), ctx.now());
  const preview = renderFor(c.firstMessageTemplate, settings, { name: 'Empresa Exemplo', category: 'Categoria', city: 'Cidade' }, offer);
  if (preview.unknown.length) throw precondition('template_unknown_vars', `Variáveis desconhecidas no modelo: ${preview.unknown.join(', ')}`);
  if (preview.missing.length) throw precondition('template_missing_vars', `Variáveis sem valor configurado: ${preview.missing.join(', ')}`);
}

/**
 * Agenda a primeira abordagem para os contatos selecionados que estiverem elegíveis.
 * Usado ao ativar e periodicamente enquanto a campanha estiver ativa (contatos que
 * terminaram a validação). Nunca agenda dois envios para o mesmo telefone.
 */
export async function scheduleEligible(ctx: AppContext, campaignId: number, limit = 200): Promise<{ scheduled: number; blocked: number; waiting: number }> {
  const settings = await getSettings(ctx.db);
  const result = { scheduled: 0, blocked: 0, waiting: 0 };
  const campaign = await getCampaign(ctx.db, campaignId);
  if (campaign.status !== 'active' || !campaign.offerId || !campaign.firstMessageTemplate) return result;
  const session = await ensureSessionRow(ctx.db, getSessionKey(ctx));
  const offer = snapshotOffer(await getOffer(ctx.db, campaign.offerId), ctx.now());

  const selected = await ctx.db
    .select({ cc: campaignContacts, company: companies, phone: phones })
    .from(campaignContacts)
    .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
    .innerJoin(phones, eq(phones.id, campaignContacts.phoneId))
    .where(and(eq(campaignContacts.campaignId, campaignId), eq(campaignContacts.status, 'selected')))
    .limit(limit);

  let needsValidation = false;
  for (const row of selected) {
    await ctx.db.transaction(async (tx) => {
      // Revalida com bloqueio da participação para evitar agendamento concorrente
      const [cc] = await tx.select().from(campaignContacts).where(eq(campaignContacts.id, row.cc.id)).for('update');
      if (!cc || cc.status !== 'selected') return;
      // Bloqueio por telefone: serializa campanhas concorrentes disputando o mesmo número
      await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, cc.phoneId)).for('update');
      const reasons = await checkEligibility(tx, {
        phoneId: cc.phoneId,
        campaignId,
        sessionId: session.id,
        revalidateDays: settings.validationRevalidateDays,
        allowlist: ctx.config.sending.allowlist,
        now: ctx.now(),
      });
      if (reasons.length) {
        const transient = reasons.every((r) => TRANSIENT_REASONS.includes(r));
        if (transient) {
          needsValidation = true;
          result.waiting++;
          await tx.update(campaignContacts).set({ statusReason: reasons.map((r) => INELIGIBLE_LABELS[r]).join('; ') }).where(eq(campaignContacts.id, cc.id));
        } else {
          result.blocked++;
          await setParticipationStatus(tx, cc, 'blocked', 'system', reasons.map((r) => INELIGIBLE_LABELS[r]).join('; '));
        }
        return;
      }
      const rendered = renderFor(campaign.firstMessageTemplate!, settings, row.company, offer);
      if (rendered.missing.length || rendered.unknown.length) {
        result.blocked++;
        await setParticipationStatus(tx, cc, 'blocked', 'system', `Variáveis sem valor: ${[...rendered.missing, ...rendered.unknown].join(', ')}`);
        return;
      }
      const conv = await ensureConversation(tx, { sessionId: session.id, phoneId: cc.phoneId, jid: e164ToJid(row.phone.e164!), displayName: row.company.name });
      const [msg] = await tx
        .insert(messages)
        .values({
          conversationId: conv.id,
          direction: 'out',
          origin: 'automatic',
          status: 'scheduled',
          body: rendered.text,
          campaignId,
          campaignContactId: cc.id,
          purpose: 'first_contact',
          idempotencyKey: `first:${cc.id}`,
          scheduledFor: ctx.now(),
          occurredAt: ctx.now(),
        })
        .$returningId();
      await setParticipationStatus(tx, cc, 'scheduled', 'system', null, { offerSnapshot: offer, firstMessageId: msg!.id });
      result.scheduled++;
    });
  }
  if (needsValidation) {
    await ctx.db.transaction((tx) => enqueue(tx, 'validation.run', { scope: { kind: 'campaign', campaignId } }, { dedupeKey: `validation:campaign:${campaignId}` }));
  }
  if (result.scheduled) {
    await ctx.db.transaction((tx) => enqueue(tx, 'dispatch.tick', {}, { dedupeKey: 'dispatch.tick' }));
  }
  await ctx.events.publish({ type: 'campaign.updated', campaignId });
  return result;
}

export async function transitionCampaign(ctx: AppContext, id: number, to: CampaignStatus): Promise<Campaign> {
  const c = await getCampaign(ctx.db, id);
  if (!CAMPAIGN_TRANSITIONS[c.status].includes(to)) {
    throw conflict('invalid_transition', `Transição inválida: ${c.status} → ${to}`);
  }
  if (to === 'active') await assertCampaignReady(ctx, c);
  await ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const patch: Partial<Campaign> = { status: to };
    if (to === 'active') {
      patch.startedAt = c.startedAt ?? now;
      patch.pausedAt = null;
    }
    if (to === 'paused') patch.pausedAt = now;
    if (to === 'completed' || to === 'cancelled') patch.endedAt = now;
    await tx.update(campaigns).set(patch).where(eq(campaigns.id, id));
    if (to === 'completed' || to === 'cancelled') await closeCampaignPending(tx, id, to);
    await audit(tx, 'owner', `campaign.${to}`, 'campaign', id, { from: c.status });
  });
  if (to === 'active') await scheduleEligible(ctx, id);
  await ctx.events.publish({ type: 'campaign.updated', campaignId: id });
  return getCampaign(ctx.db, id);
}

/**
 * Efeitos de concluir/cancelar: envios automáticos pendentes são cancelados e
 * participações que ainda não receberam a abordagem são encerradas. Conversas em
 * andamento e oportunidades permanecem (passam a depender de ação humana).
 */
async function closeCampaignPending(tx: Tx, campaignId: number, to: 'completed' | 'cancelled'): Promise<void> {
  await tx
    .update(messages)
    .set({ status: 'cancelled', error: to === 'cancelled' ? 'Campanha cancelada' : 'Campanha concluída' })
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'scheduled'), eq(messages.origin, 'automatic')));
  const pending = await tx
    .select()
    .from(campaignContacts)
    .where(and(eq(campaignContacts.campaignId, campaignId), inArray(campaignContacts.status, ['selected', 'scheduled'])));
  for (const p of pending) await setParticipationStatus(tx, p, 'cancelled', 'system', to === 'cancelled' ? 'Campanha cancelada' : 'Campanha concluída');
  const qualifying = await tx
    .select()
    .from(campaignContacts)
    .where(and(eq(campaignContacts.campaignId, campaignId), inArray(campaignContacts.status, ['qualifying'])));
  for (const p of qualifying) await setParticipationStatus(tx, p, 'handed_off', 'system', 'Campanha encerrada durante a qualificação');
}

/** Envios pendentes cujo texto difere do modelo atual (para revisão explícita). */
export async function pendingDivergence(ctx: AppContext, campaignId: number): Promise<{ messageId: number; current: string; updated: string; companyName: string }[]> {
  const campaign = await getCampaign(ctx.db, campaignId);
  if (!campaign.firstMessageTemplate) return [];
  const settings = await getSettings(ctx.db);
  const rows = await ctx.db
    .select({ m: messages, cc: campaignContacts, company: companies })
    .from(messages)
    .innerJoin(campaignContacts, eq(campaignContacts.id, messages.campaignContactId))
    .innerJoin(companies, eq(companies.id, campaignContacts.companyId))
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'scheduled'), eq(messages.purpose, 'first_contact')))
    .limit(500);
  const out = [];
  for (const r of rows) {
    const updated = renderFor(campaign.firstMessageTemplate, settings, r.company, r.cc.offerSnapshot ?? null);
    if (updated.text !== r.m.body && !updated.missing.length && !updated.unknown.length) {
      out.push({ messageId: r.m.id, current: r.m.body ?? '', updated: updated.text, companyName: r.company.name });
    }
  }
  return out;
}

/** Aplica o modelo atual aos envios pendentes escolhidos (nunca automaticamente). */
export async function applyTemplateToPending(ctx: AppContext, campaignId: number, messageIds: number[]): Promise<number> {
  const div = await pendingDivergence(ctx, campaignId);
  const chosen = div.filter((d) => messageIds.includes(d.messageId));
  await ctx.db.transaction(async (tx) => {
    for (const d of chosen) {
      await tx
        .update(messages)
        .set({ body: d.updated })
        .where(and(eq(messages.id, d.messageId), eq(messages.status, 'scheduled')));
    }
    await audit(tx, 'owner', 'campaign.pending.rerender', 'campaign', campaignId, { count: chosen.length });
  });
  return chosen.length;
}

export function validateWindow(w: { sendWindowStart: string; sendWindowEnd: string; sendDays: number[] }): void {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!re.test(w.sendWindowStart) || !re.test(w.sendWindowEnd)) throw badRequest('invalid_window', 'Horário no formato HH:mm');
  if (w.sendWindowStart >= w.sendWindowEnd) throw badRequest('invalid_window', 'O início da janela deve ser antes do fim');
  if (!w.sendDays.length || w.sendDays.some((d) => d < 0 || d > 6)) throw badRequest('invalid_days', 'Selecione ao menos um dia válido');
}
