import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { campaignContacts, companies, companyPhones, conversations, messages, offers, opportunities, phones, suppressions, webhookEvents } from '../src/db/schema.ts';
import { dispatchTick } from '../src/modules/messaging/dispatcher.ts';
import { recoverStuckProcessing, reconcileUnknown } from '../src/modules/messaging/sender.ts';
import { processWebhookEvent } from '../src/modules/automation/inbound.ts';
import { closeNoReply } from '../src/modules/automation/maintenance.ts';
import { importPlaces } from '../src/modules/scans/importer.ts';
import { parseScraperCsv } from '../src/integrations/scraper/csv.ts';
import { signWebhookBody } from '../src/integrations/wa/webhook.ts';
import { createTestEnv, seedBasics, timeoutError, fixture, type TestEnv } from './helpers.ts';

const H = { 'x-aero-request': '1', host: 'localhost', 'content-type': 'application/json' };

let env: TestEnv;
let app: FastifyInstance;
let offerIds: { landingOfferId: number; saasOfferId: number };

async function api<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await app.inject({ method, url: `/api${url}`, headers: method === 'GET' ? { host: 'localhost' } : H, payload: body === undefined ? (method === 'GET' ? undefined : {}) : (body as object) });
  return { status: res.statusCode, body: res.json() as T };
}

/** Empresa com telefone validado (WhatsApp encontrado agora). */
async function lead(name: string, e164: string, opts: { validated?: boolean } = {}): Promise<{ companyId: number; phoneId: number }> {
  const [c] = await env.ctx.db.insert(companies).values({ name, sourcePlaceId: `test:${name}`, city: 'São Paulo', category: 'Dentista', latitude: '-23.5', longitude: '-46.6' }).$returningId();
  await env.ctx.db
    .insert(phones)
    .values({ e164, dedupeKey: e164, rawSample: e164, countryCode: 'BR', formatStatus: 'valid', waStatus: opts.validated === false ? 'pending' : 'found', waCheckedAt: opts.validated === false ? null : env.clock.now })
    .onDuplicateKeyUpdate({ set: { e164 } });
  const [p] = await env.ctx.db.select().from(phones).where(eq(phones.dedupeKey, e164));
  await env.ctx.db.insert(companyPhones).values({ companyId: c!.id, phoneId: p!.id, rawValue: e164 });
  return { companyId: c!.id, phoneId: p!.id };
}

async function campaign(name: string, service: 'landing_page' | 'micro_saas', offerId: number): Promise<number> {
  const r = await api<{ id: number }>('POST', '/campaigns', { name, service, offerId });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

async function addAndActivate(campaignId: number, companyIds: number[]) {
  const add = await api('POST', `/campaigns/${campaignId}/contacts`, { companyIds });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const act = await api('POST', `/campaigns/${campaignId}/status`, { to: 'active' });
  assert.equal(act.status, 200, JSON.stringify(act.body));
}

async function sendAll(maxTicks = 20) {
  for (let i = 0; i < maxTicks; i++) {
    const r = await dispatchTick(env.ctx);
    env.clock.now = new Date(env.clock.now.getTime() + Math.max(r.nextInMs, 1000));
    if (r.reason === 'Nada pendente') return;
  }
}

/** Envia um webhook assinado como o gateway faria e processa o evento. */
async function webhook(event: string, data: Record<string, unknown>) {
  const payload = JSON.stringify({ event, sessionId: 'aero-test', timestamp: new Date().toISOString(), data });
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/wa',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signWebhookBody(payload, 'segredo-de-teste') },
    payload,
  });
  assert.equal(res.statusCode, 200, res.body);
  const pending = await env.ctx.db.select().from(webhookEvents).where(sql`${webhookEvents.processedAt} IS NULL`);
  for (const e of pending) await processWebhookEvent(env.ctx, e.id);
  return res.json() as { ok: boolean; duplicate: boolean };
}

let msgSeq = 0;
const inbound = (e164: string, text: string, id = `IN${++msgSeq}`) =>
  webhook('message.received', { key: { id, remoteJid: `${e164.slice(1)}@s.whatsapp.net`, fromMe: false }, from: `${e164.slice(1)}@s.whatsapp.net`, chatType: 'PERSONAL', isGroup: false, type: 'TEXT', content: text, messageTimestamp: Math.floor(Date.now() / 1000) });

const ccOf = async (campaignId: number, phoneId: number) =>
  (await env.ctx.db.select().from(campaignContacts).where(and(eq(campaignContacts.campaignId, campaignId), eq(campaignContacts.phoneId, phoneId))))[0]!;
const convOf = async (phoneId: number) => (await env.ctx.db.select().from(conversations).where(eq(conversations.phoneId, phoneId)))[0]!;
const msgsOf = async (convId: number) => env.ctx.db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.id);

describe('campanhas, envio e automação', () => {
  before(async () => {
    env = await createTestEnv();
  });
  after(async () => {
    await app?.close();
    await env.close();
  });
  beforeEach(async () => {
    await app?.close();
    await env.close();
    env = await createTestEnv();
    offerIds = await seedBasics(env);
    app = await buildApp(env.ctx, { logger: false });
  });

  test('ativação bloqueada sem configuração obrigatória', async () => {
    await env.ctx.db.execute(sql`UPDATE operator_settings SET sender_name = NULL`);
    const id = await campaign('Sem remetente', 'landing_page', offerIds.landingOfferId);
    const r = await api('POST', `/campaigns/${id}/status`, { to: 'active' });
    assert.equal(r.status, 412);
    assert.equal(r.body.error, 'settings_incomplete');
  });

  test('cenários 5 e 16: campanhas simultâneas preservam ofertas próprias; editar preço não muda o já apresentado', async () => {
    const a = await lead('Clínica A', '+5511911110001');
    const b = await lead('Restaurante B', '+5511911110002');
    const c1 = await campaign('LP clínicas', 'landing_page', offerIds.landingOfferId);
    const [o2] = await env.ctx.db.insert(offers).values({ service: 'landing_page', name: 'LP Restaurantes', priceType: 'fixed', priceCents: 79000, currency: 'BRL' }).$returningId();
    const c2 = await campaign('LP restaurantes', 'landing_page', o2!.id);
    await addAndActivate(c1, [a.companyId]);
    await addAndActivate(c2, [b.companyId]);
    await sendAll();
    assert.equal(env.wa.sent.length, 2);
    const cc1 = await ccOf(c1, a.phoneId);
    const cc2 = await ccOf(c2, b.phoneId);
    assert.equal(cc1.offerSnapshot?.priceCents, 99000);
    assert.equal(cc2.offerSnapshot?.priceCents, 79000);
    assert.match(env.wa.sent.find((s) => s.jid.startsWith('5511911110001'))!.text, /Clínica A/);

    // Edita o preço da oferta da campanha 1
    const upd = await api('PUT', `/offers/${offerIds.landingOfferId}`, { service: 'landing_page', name: 'Landing Essencial', description: null, scope: null, priceType: 'fixed', priceCents: 150000, setupCents: null, monthlyCents: null, currency: 'BRL', conditions: null, validUntil: null });
    assert.equal(upd.status, 200);
    assert.equal((await ccOf(c1, a.phoneId)).offerSnapshot?.priceCents, 99000, 'snapshot não muda');

    // Interessado: oportunidade e proposta usam a oferta apresentada
    await inbound('+5511911110001', 'Pode mandar');
    const [opp] = await env.ctx.db.select().from(opportunities).where(eq(opportunities.campaignContactId, cc1.id));
    assert.equal(opp!.offerSnapshot?.priceCents, 99000);
  });

  test('cenário 6: o mesmo telefone não recebe abordagens simultâneas conflitantes', async () => {
    const x = await lead('Empresa X', '+5511922220001');
    const c1 = await campaign('C1', 'landing_page', offerIds.landingOfferId);
    const c2 = await campaign('C2', 'micro_saas', offerIds.saasOfferId);
    await addAndActivate(c1, [x.companyId]);
    await addAndActivate(c2, [x.companyId]);
    const p2 = await ccOf(c2, x.phoneId);
    assert.equal(p2.status, 'blocked');
    assert.match(p2.statusReason ?? '', /outra campanha/);
    await sendAll();
    assert.equal(env.wa.sent.length, 1);

    // Duas empresas com o mesmo telefone em uma campanha: um único envio
    const y1 = await lead('Matriz Y', '+5511922220002');
    const [y2c] = await env.ctx.db.insert(companies).values({ name: 'Filial Y', sourcePlaceId: 'test:filial' }).$returningId();
    await env.ctx.db.insert(companyPhones).values({ companyId: y2c!.id, phoneId: y1.phoneId, rawValue: '+5511922220002' });
    const c3 = await campaign('C3', 'landing_page', offerIds.landingOfferId);
    const add = await api<{ added: number; skipped: number }>('POST', `/campaigns/${c3}/contacts`, { companyIds: [y1.companyId, y2c!.id] });
    assert.equal(add.body.added, 1);
  });

  test('cenários 7, 8 e 13: webhook reprocessado não duplica; resposta suspende pendências; estados verdadeiros', async () => {
    const a = await lead('Clínica Z', '+5511933330001');
    const b = await lead('Clínica W', '+5511933330002');
    const c = await campaign('Z', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId, b.companyId]);
    // Antes do envio para W, W escreve: a abordagem pendente é suspensa
    await inbound('+5511933330002', 'Oi, quem é?');
    await sendAll();
    assert.equal(env.wa.sent.length, 1, 'somente Z recebe a abordagem');
    const convW = await convOf(b.phoneId);
    const firstW = (await msgsOf(convW.id)).find((m) => m.purpose === 'first_contact')!;
    assert.equal(firstW.status, 'cancelled');

    // Mesmo webhook duas vezes
    const r1 = await inbound('+5511933330001', 'Pode mandar', 'DUP-1');
    const r2 = await inbound('+5511933330001', 'Pode mandar', 'DUP-1');
    assert.equal(r1.duplicate, false);
    assert.equal(r2.duplicate, true);
    const convZ = await convOf(a.phoneId);
    const ins = (await msgsOf(convZ.id)).filter((m) => m.direction === 'in');
    assert.equal(ins.length, 1);
    const opps = await env.ctx.db.select().from(opportunities).where(eq(opportunities.conversationId, convZ.id));
    assert.equal(opps.length, 1, 'uma oportunidade');

    // Estados: aceito -> lido chega antes de entregue (fora de ordem) -> não rebaixa
    const first = (await msgsOf(convZ.id)).find((m) => m.purpose === 'first_contact')!;
    assert.equal(first.status, 'accepted', 'aceito pelo gateway não é entrega');
    await webhook('message.status', { keyId: first.externalId, remoteJid: 'x', status: 'READ' });
    await webhook('message.status', { keyId: first.externalId, remoteJid: 'x', status: 'DELIVERED' });
    const after = (await msgsOf(convZ.id)).find((m) => m.id === first.id)!;
    assert.equal(after.status, 'read');
  });

  test('cenário 9: sem resposta não há follow-up; participação encerra no prazo', async () => {
    const a = await lead('Silenciosa', '+5511944440001');
    const c = await campaign('S', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    const before = await env.ctx.db.select({ n: sql<number>`COUNT(*)` }).from(messages);
    env.clock.now = new Date(env.clock.now.getTime() + 80 * 3600_000);
    assert.equal(await closeNoReply(env.ctx), 1);
    await sendAll();
    const after = await env.ctx.db.select({ n: sql<number>`COUNT(*)` }).from(messages);
    assert.equal(Number(after[0]!.n), Number(before[0]!.n), 'nenhuma mensagem nova');
    assert.equal((await ccOf(c, a.phoneId)).status, 'closed_no_reply');
    assert.equal(env.wa.sent.length, 1);
  });

  test('cenário 10: recusa cancela pendências e continua válida após reimportação', async () => {
    const a = await lead('Recusa', '+5511955550001');
    const c = await campaign('R', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    await inbound('+5511955550001', 'Não tenho interesse, obrigado');
    assert.equal((await ccOf(c, a.phoneId)).status, 'declined');
    const sup = await env.ctx.db.select().from(suppressions).where(eq(suppressions.phoneId, a.phoneId));
    assert.equal(sup.length, 1);

    // Reimporta um CSV que contém o mesmo telefone
    const csv = fixture('scraper-sample.csv').replace('(11) 91234-5678', '(11) 95555-0001');
    await env.ctx.db.transaction((tx) => importPlaces(tx, { scanId: 999, scanUnitId: 999, countryCode: 'BR', phoneTarget: null, countedPhones: 0, now: env.clock.now }, parseScraperCsv(csv)));
    assert.equal((await env.ctx.db.select().from(suppressions).where(eq(suppressions.phoneId, a.phoneId))).length, 1, 'supressão mantida');

    // Nova campanha não aborda
    const c2 = await campaign('R2', 'micro_saas', offerIds.saasOfferId);
    await addAndActivate(c2, [a.companyId]);
    const p = await ccOf(c2, a.phoneId);
    assert.equal(p.status, 'blocked');
    assert.match(p.statusReason ?? '', /recusou/);
    const sentBefore = env.wa.sent.length;
    await sendAll();
    assert.equal(env.wa.sent.length, sentBefore + 1, 'só a confirmação de recusa (configurada) foi enviada');
    assert.match(env.wa.sent.at(-1)!.text, /Não enviaremos mais/);
    assert.equal((await convOf(a.phoneId)).state, 'closed', 'confirmação não reabre a conversa');
  });

  test('cenário 11: assumir pausa a automação; só retoma por ação explícita', async () => {
    const a = await lead('Humana', '+5511966660001');
    const c = await campaign('H', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    await inbound('+5511966660001', 'Sim, pode mandar');
    const conv = await convOf(a.phoneId);
    const pending = (await msgsOf(conv.id)).filter((m) => m.status === 'scheduled');
    assert.ok(pending.length >= 1, 'apresentação/pergunta agendada');
    const t = await api('POST', `/inbox/conversations/${conv.id}/takeover`);
    assert.equal(t.status, 200);
    assert.equal((await msgsOf(conv.id)).filter((m) => m.status === 'scheduled').length, 0, 'pendências canceladas');
    const sent = env.wa.sent.length;
    await inbound('+5511966660001', 'Quero receber pedidos de orçamento');
    await sendAll();
    assert.equal(env.wa.sent.length, sent, 'nenhuma automação após assumir');
    assert.equal((await convOf(a.phoneId)).automationPaused, true);
    const r = await api('POST', `/inbox/conversations/${conv.id}/resume-automation`);
    assert.equal(r.status, 200);
    assert.equal((await convOf(a.phoneId)).automationPaused, false);
  });

  test('cenários 12 e 13: alterar modelo preserva o histórico; envio manual funciona', async () => {
    const a = await lead('Modelo', '+5511977770001');
    const c = await campaign('M', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    const conv = await convOf(a.phoneId);
    const original = (await msgsOf(conv.id)).find((m) => m.purpose === 'first_contact')!.body!;
    const detail = await api<{ campaign: Record<string, unknown> }>('GET', `/campaigns/${c}`);
    const cfg = detail.body.campaign;
    const put = await api('PUT', `/campaigns/${c}`, {
      name: cfg.name, objective: null, offerId: cfg.offerId, firstMessageTemplate: 'Texto totalmente novo {{empresa_lead}}', presentationTemplate: cfg.presentationTemplate,
      qualificationQuestions: cfg.qualificationQuestions, questionsPerMessage: 1, qualificationDoneTemplate: cfg.qualificationDoneTemplate, declineAckTemplate: cfg.declineAckTemplate,
      timezone: cfg.timezone, sendDays: cfg.sendDays, sendWindowStart: cfg.sendWindowStart, sendWindowEnd: cfg.sendWindowEnd, dailyLimit: cfg.dailyLimit, noReplyCloseHours: cfg.noReplyCloseHours, audienceFilters: null,
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal((await msgsOf(conv.id)).find((m) => m.purpose === 'first_contact')!.body, original);

    const manual = await api<{ status: string; origin: string }>('POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Olá, aqui é a Ana.', clientKey: 'manual-key-0001' });
    assert.equal(manual.status, 200);
    assert.equal(manual.body.status, 'accepted');
    assert.equal(manual.body.origin, 'manual');
    // Idempotência do envio manual (duplo clique / reenvio da requisição)
    await api('POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Olá, aqui é a Ana.', clientKey: 'manual-key-0001' });
    assert.equal(env.wa.sent.filter((s) => s.text === 'Olá, aqui é a Ana.').length, 1);
    const view = await api<{ messages: { origin: string; status: string }[] }>('GET', `/inbox/conversations/${conv.id}`);
    assert.ok(view.body.messages.some((m) => m.origin === 'automatic') && view.body.messages.some((m) => m.origin === 'manual'));
  });

  test('cenários 17 e 18: resultado desconhecido não é reenviado; recuperação após interrupção', async () => {
    const a = await lead('Timeout', '+5511988880001');
    const c = await campaign('T', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    env.wa.sendImpl = async () => {
      throw timeoutError();
    };
    await sendAll();
    const conv = await convOf(a.phoneId);
    const m = (await msgsOf(conv.id)).find((x) => x.purpose === 'first_contact')!;
    assert.equal(m.status, 'unknown');
    env.wa.sendImpl = async () => ({ externalId: 'NEVER', remoteJid: null });
    await sendAll();
    assert.equal(env.wa.sent.length, 0, 'sem reenvio cego');

    // Reconciliação encontra a mensagem no histórico do gateway
    env.wa.history = [{ keyId: 'RECON-1', remoteJid: conv.jid, fromMe: true, content: m.body, status: 'SENT', timestamp: env.clock.now.toISOString() }];
    env.clock.now = new Date(m.sentAt!.getTime() + 60_000);
    assert.equal(await reconcileUnknown(env.ctx), 1);
    assert.equal((await msgsOf(conv.id)).find((x) => x.id === m.id)!.status, 'accepted');

    // Envio preso em "processing" (worker caiu no meio) vira desconhecido
    await env.ctx.db.update(messages).set({ status: 'processing', lockedAt: new Date(env.clock.now.getTime() - 10 * 60_000) }).where(eq(messages.id, m.id));
    assert.equal(await recoverStuckProcessing(env.ctx), 1);
  });

  test('envio desabilitado e lista de teste bloqueiam saída', async () => {
    const a = await lead('Bloqueio', '+5511999990001');
    const c = await campaign('B', 'landing_page', offerIds.landingOfferId);
    env.ctx.config.sending.allowlist = ['+5511999990009'];
    await addAndActivate(c, [a.companyId]);
    assert.equal((await ccOf(c, a.phoneId)).status, 'blocked');
    env.ctx.config.sending.allowlist = [];
    env.ctx.config.sending.enabled = false;
    const r = await dispatchTick(env.ctx);
    assert.equal(r.sent, 0);
    assert.equal(env.wa.sent.length, 0);
  });

  test('qualificação: perguntas em sequência, respostas guardadas, dúvida vai para humano', async () => {
    const a = await lead('Qualifica', '+5511912340001');
    const c = await campaign('Q', 'micro_saas', offerIds.saasOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    await inbound('+5511912340001', 'Pode mandar');
    await sendAll();
    assert.equal((await ccOf(c, a.phoneId)).status, 'qualifying');
    await inbound('+5511912340001', 'Controlar agendamentos da clínica');
    await sendAll();
    const cc = await ccOf(c, a.phoneId);
    assert.equal(cc.answers?.problema, 'Controlar agendamentos da clínica');
    assert.equal(cc.qualificationIndex, 1);
    await inbound('+5511912340001', 'E quanto custa a mensalidade?');
    const after = await ccOf(c, a.phoneId);
    assert.equal(after.status, 'handed_off');
    assert.equal((await convOf(a.phoneId)).state, 'awaiting_human');
  });

  test('JID confirmado sem o nono dígito: envio e resposta caem na mesma conversa', async () => {
    const a = await lead('Nono Dígito', '+5511987650001');
    await env.ctx.db.update(phones).set({ waJid: '551187650001@s.whatsapp.net' }).where(eq(phones.id, a.phoneId));
    const c = await campaign('N', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    assert.equal(env.wa.sent[0]?.jid, '551187650001@s.whatsapp.net', 'envia para o JID confirmado');
    await webhook('message.received', { key: { id: 'NONO-1' }, from: '551187650001@s.whatsapp.net', chatType: 'PERSONAL', type: 'TEXT', content: 'Pode mandar' });
    const convs = await env.ctx.db.select().from(conversations);
    assert.equal(convs.length, 1, 'resposta não cria conversa paralela');
    assert.equal((await ccOf(c, a.phoneId)).status, 'qualifying');
  });

  test('mensagens de sistema e conversa consigo mesmo não entram na caixa de entrada', async () => {
    const own = '5512981647076@s.whatsapp.net';
    // Sincronização de histórico ao parear (conteúdo vazio, protocolMessage)
    await webhook('message.received', {
      key: { id: 'SYS-1', remoteJid: '105681998839873@lid' },
      from: '105681998839873@lid',
      receiver: own,
      chatType: 'PERSONAL',
      type: 'TEXT',
      content: '',
      raw: { key: { id: 'SYS-1', remoteJid: '105681998839873@lid', addressingMode: 'lid' }, message: { protocolMessage: { type: 'HISTORY_SYNC_NOTIFICATION' }, messageContextInfo: {} } },
    });
    // Mensagem do próprio número para si mesmo
    await webhook('message.received', { key: { id: 'SELF-1' }, from: own, receiver: own, chatType: 'PERSONAL', type: 'TEXT', content: 'nota para mim', raw: { message: { conversation: 'nota para mim' } } });
    assert.equal((await env.ctx.db.select().from(conversations)).length, 0);
    assert.equal((await env.ctx.db.select().from(messages)).length, 0);
  });

  test('LID com telefone alternativo cai na conversa do número', async () => {
    const a = await lead('Contato LID', '+5512991810649');
    await webhook('message.received', {
      key: { id: 'LID-1', remoteJid: '200000000000001@lid' },
      from: '200000000000001@lid',
      chatType: 'PERSONAL',
      type: 'TEXT',
      content: 'Olá',
      raw: { key: { id: 'LID-1', remoteJid: '200000000000001@lid', remoteJidAlt: '5512991810649@s.whatsapp.net', addressingMode: 'lid' }, message: { conversation: 'Olá' } },
    });
    const conv = await convOf(a.phoneId);
    assert.ok(conv, 'conversa associada ao telefone cadastrado');
    assert.equal((await env.ctx.db.select().from(conversations)).length, 1);
  });

  test('lista de teste bloqueia envio manual para contato sem número (somente LID)', async () => {
    env.ctx.config.sending.allowlist = ['+5512991810649'];
    await webhook('message.received', {
      key: { id: 'LID-2', remoteJid: '300000000000001@lid' },
      from: '300000000000001@lid',
      chatType: 'PERSONAL',
      type: 'TEXT',
      content: 'Oi',
      raw: { key: { id: 'LID-2', remoteJid: '300000000000001@lid' }, message: { conversation: 'Oi' } },
    });
    const [conv] = await env.ctx.db.select().from(conversations);
    const r = await api<{ status: string }>('POST', `/inbox/conversations/${conv!.id}/messages`, { text: 'teste', clientKey: 'manual-lid-0001' });
    assert.equal(r.body.status, 'failed');
    assert.equal(env.wa.sent.length, 0, 'nada enviado');
    env.ctx.config.sending.allowlist = [];
  });

  test('nova conversa manual: usa o JID confirmado e respeita a lista de teste', async () => {
    env.ctx.config.sending.allowlist = ['+5512991810649'];
    env.wa.checkImpl = async (numbers) => numbers.map((n) => ({ number: n, outcome: 'found' as const, jid: '551291810649@s.whatsapp.net', error: null }));
    const r = await api<{ id: number; whatsapp: string }>('POST', '/inbox/conversations', { phone: '+55 12 99181-0649' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.whatsapp, 'found');
    const sent = await api<{ status: string }>('POST', `/inbox/conversations/${r.body.id}/messages`, { text: 'Olá, teste', clientKey: 'start-conv-0001' });
    assert.equal(sent.body.status, 'accepted');
    assert.equal(env.wa.sent[0]?.jid, '551291810649@s.whatsapp.net', 'envia ao JID confirmado pelo gateway');

    const other = await api<{ id: number }>('POST', '/inbox/conversations', { phone: '+55 11 98888-7777' });
    const blocked = await api<{ status: string }>('POST', `/inbox/conversations/${other.body.id}/messages`, { text: 'x', clientKey: 'start-conv-0002' });
    assert.equal(blocked.body.status, 'failed', 'fora da lista de teste');
    assert.equal(env.wa.sent.length, 1);

    const invalid = await api('POST', '/inbox/conversations', { phone: '12345' });
    assert.equal(invalid.status, 400);
    env.ctx.config.sending.allowlist = [];
  });

  test('mensagem automática do destinatário não avança a abordagem', async () => {
    const a = await lead('Auto', '+5511912340002');
    const c = await campaign('A', 'landing_page', offerIds.landingOfferId);
    await addAndActivate(c, [a.companyId]);
    await sendAll();
    await inbound('+5511912340002', 'Olá! Obrigado por entrar em contato. Em breve retornaremos.');
    assert.equal((await ccOf(c, a.phoneId)).status, 'awaiting_reply');
    assert.equal((await env.ctx.db.select().from(opportunities)).length, 0);
  });
});
