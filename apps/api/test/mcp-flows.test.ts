import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '@aero/mcp/server';
import { createApi } from '@aero/mcp/api';
import { buildApp } from '../src/app.ts';
import { companies, companyPhones, conversations, messages, outbox, phones } from '../src/db/schema.ts';
import { runValidation } from '../src/modules/validation/service.ts';
import { suppressPhone } from '../src/modules/leads/suppression.ts';
import { createTestEnv, type TestEnv } from './helpers.ts';

describe('MCP opera os fluxos completos pela API real com integrações falsas', () => {
  let env: TestEnv;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let server: ReturnType<typeof createServer>;
  let client: Client;
  let filesRoot: string;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
    return (result.structuredContent as { data: unknown }).data as Record<string, unknown>;
  };
  before(async () => {
    env = await createTestEnv();
    filesRoot = await mkdtemp(path.join(os.tmpdir(), 'aero-mcp-flow-'));
    app = await buildApp(env.ctx, { logger: false });
    const api = createApi({ fetch: async (input, init) => {
      const req = new Request(String(input), init);
      const response = await app.inject({
        method: req.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        url: new URL(req.url).pathname + new URL(req.url).search,
        headers: { ...Object.fromEntries(req.headers), host: 'localhost' },
        ...(req.method !== 'GET' ? { payload: Buffer.from(await req.arrayBuffer()) } : {}),
      });
      return new Response(new Uint8Array(response.rawPayload), { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, String(value)])) });
    } });
    server = createServer(api, { filesRoot });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'integration-test', version: '1' });
    await server.connect(st);
    await client.connect(ct);
  });
  after(async () => {
    await client?.close();
    await server?.close();
    await app?.close();
    await env?.close();
    // mkdtemp returns a verified task-owned directory under the OS temporary directory.
    if (filesRoot && path.dirname(filesRoot) === os.tmpdir() && path.basename(filesRoot).startsWith('aero-mcp-flow-')) await rm(filesRoot, { recursive: true, force: true });
  });

  test('cadastro manual é idempotente, preserva validação/supressão e não envia nem enfileira coleta', async () => {
    const lead = await call('aero_lead_create', { name: 'Clínica MCP', countryCode: 'BR', city: 'São Paulo', latitude: -23.5, longitude: -46.6, website: 'https://www.exemplo.test', phones: ['+55 11 98765-4321'], clientKey: 'manual-company-01' });
    const id = Number(lead.id);
    const details = await call('aero_lead_get', { id });
    const phone = (details.phones as { id: number }[])[0]!;
    await env.ctx.db.update(phones).set({ waStatus: 'found', waJid: '5511987654321@s.whatsapp.net', waCheckedAt: env.ctx.now() }).where(eq(phones.id, phone.id));
    await call('aero_phone_suppress', { phoneId: phone.id, reason: 'recusa' });
    const retry = await call('aero_lead_create', { name: 'Não sobrescrever', countryCode: 'BR', phones: ['+55 12 99876-5432'], clientKey: 'manual-company-01' });
    assert.equal(retry.id, id);
    assert.equal((await env.ctx.db.select().from(companies).where(eq(companies.id, id)))[0]?.name, 'Clínica MCP');
    assert.equal((await env.ctx.db.select().from(companyPhones).where(eq(companyPhones.companyId, id))).length, 1);
    const branch = await call('aero_lead_create', { name: 'Filial MCP', countryCode: 'BR', phones: ['(11) 98765-4321'], clientKey: 'manual-company-02' });
    assert.equal((await call('aero_lead_add_phone', { id: Number(branch.id), phone: '(11) 98765-4321' })).phoneId, phone.id);
    const retained = (await env.ctx.db.select().from(phones).where(eq(phones.id, phone.id)))[0]!;
    assert.equal(retained.waStatus, 'found');
    assert.equal(retained.waJid, '5511987654321@s.whatsapp.net');
    await call('aero_lead_update', { id, patch: { name: 'Clínica Editada', notes: 'Prioridade', website: null } });
    const updated = (await env.ctx.db.select().from(companies).where(eq(companies.id, id)))[0]!;
    assert.equal(updated.domain, null);
    assert.equal(updated.website, null);
    assert.equal(updated.city, 'São Paulo');
    const badCoords = await client.callTool({ name: 'aero_lead_update', arguments: { id, patch: { latitude: null } } });
    assert.equal(badCoords.isError, true);
    assert.equal((await env.ctx.db.select().from(companies).where(eq(companies.id, id)))[0]?.latitude, '-23.5000000');
    await call('aero_lead_update', { id, patch: { latitude: 0, longitude: 0, rating: 0 } });
    assert.equal((await env.ctx.db.select().from(companies).where(eq(companies.id, id)))[0]?.latitude, '0.0000000');
    await call('aero_lead_update', { id, patch: { latitude: null, longitude: null, rating: null } });
    const cleared = (await env.ctx.db.select().from(companies).where(eq(companies.id, id)))[0]!;
    assert.equal(cleared.latitude, null);
    assert.equal(cleared.longitude, null);
    assert.equal(cleared.rating, null);
    assert.equal(env.wa.sent.length, 0);
    assert.equal((await env.ctx.db.select().from(outbox)).length, 0);
    const blocked = await client.callTool({ name: 'aero_phone_unsuppress', arguments: { phoneId: phone.id, reason: 'Tentar remover' } });
    assert.equal(blocked.isError, true);
    assert.equal((blocked.structuredContent as { error: string }).error, 'permanent_suppression');
  });

  test('cadastros de operação, oferta, oportunidade, proposta e pagamentos mantêm estados independentes', async () => {
    await call('aero_settings_update', { patch: { senderName: 'Operador MCP', companyName: 'Empresa MCP', sendDailyLimit: 10 } });
    assert.equal((await call('aero_settings_get')).senderName, 'Operador MCP');
    const offer = await call('aero_offer_create', { service: 'landing_page', name: 'Landing MCP', priceType: 'fixed', priceCents: 150000 });
    const offerId = Number(offer.id);
    assert.equal(offer.currency, 'BRL');
    const { id: _id, archived: _archived, createdAt: _created, updatedAt: _updated, ...body } = await call('aero_offer_get', { id: offerId });
    await call('aero_offer_update', { id: offerId, offer: { ...body, priceCents: 170000 } });
    const lead = await call('aero_lead_create', { name: 'Cliente Comercial', clientKey: 'commercial-company', countryCode: 'BR' });
    const opportunity = await call('aero_opportunity_create', { companyId: lead.id, service: 'landing_page', title: 'Projeto MCP' });
    const opportunityId = Number(opportunity.id);
    await call('aero_opportunity_update', { id: opportunityId, patch: { nextAction: 'Apresentar proposta', nextActionDueAt: '2026-10-20T10:00:00-03:00', notes: 'Cliente pediu orçamento' } });
    const proposal = await call('aero_proposal_create', { id: opportunityId, proposal: { title: 'Landing completa', amountCents: 170000 } });
    const proposalId = Number(proposal.id);
    const proposalBody = { title: 'Landing revisada', scope: null, amountCents: 150000, setupCents: null, monthlyCents: null, currency: 'BRL', conditions: null, validUntil: null, origin: 'mcp' };
    await call('aero_proposal_update', { id: proposalId, proposal: proposalBody });
    await call('aero_proposal_status', { id: proposalId, status: 'sent' });
    assert.equal(env.wa.sent.length, 0, 'registrar proposta enviada não manda mensagem');
    await call('aero_proposal_status', { id: proposalId, status: 'accepted' });
    let details = await call('aero_opportunity_get', { id: opportunityId });
    assert.equal((details.opportunity as { stage: string }).stage, 'won');
    assert.equal((details.proposals as { paymentStatus: string }[])[0]?.paymentStatus, 'pending');
    const wrongCurrency = await client.callTool({ name: 'aero_payment_create', arguments: { id: proposalId, amountCents: 1, currency: 'USD', receivedAt: '2026-10-17T12:00:00-03:00' } });
    assert.equal(wrongCurrency.isError, true);
    const payment = await call('aero_payment_create', { id: proposalId, amountCents: 150000, currency: 'BRL', receivedAt: '2026-10-17T12:00:00-03:00', method: 'pix' });
    assert.equal(payment.status, 'confirmed');
    await call('aero_payment_delete', { id: payment.id });
    details = await call('aero_opportunity_get', { id: opportunityId });
    assert.equal((details.proposals as { paymentStatus: string }[])[0]?.paymentStatus, 'pending');
    await call('aero_offer_archive', { id: offerId });
    assert.ok(((await call('aero_offers_list', { includeArchived: true })) as unknown as { id: number }[]).some((x) => x.id === offerId));
  });

  test('atendimento, mensagem idempotente, anexos e correção de envio desconhecido usam o gateway falso', async () => {
    const lead = await call('aero_lead_create', { name: 'Cliente Atendimento', countryCode: 'BR', phones: ['+55 12 99876-5432'], clientKey: 'inbox-company-01' });
    const phone = (await call('aero_lead_get', { id: lead.id })).phones as { id: number }[];
    assert.equal((await client.callTool({ name: 'aero_conversation_open', arguments: { phoneId: phone[0]!.id } })).isError, true);
    await call('aero_whatsapp_validate', { phoneIds: [phone[0]!.id] });
    await runValidation(env.ctx, { kind: 'phones', phoneIds: [phone[0]!.id] }, { sleep: async () => {} });
    await call('aero_whatsapp_provision');
    const id = Number((await call('aero_conversation_open', { phoneId: phone[0]!.id })).id);
    assert.equal((await call('aero_conversation_open', { phoneId: phone[0]!.id })).id, id);
    await call('aero_conversation_takeover', { id });
    await call('aero_conversation_update', { id, patch: { notes: 'Atendimento MCP', nextAction: 'Retornar amanhã' } });
    const before = env.wa.sent.length;
    const sent = await call('aero_message_send', { id, text: 'Mensagem de teste', clientKey: 'mcp-message-0001' });
    assert.equal(sent.status, 'accepted');
    await call('aero_message_send', { id, text: 'Mensagem de teste', clientKey: 'mcp-message-0001' });
    assert.equal(env.wa.sent.length, before + 1);
    await writeFile(path.join(filesRoot, 'proposta.txt'), 'Proposta de teste');
    const attachment = await call('aero_attachment_send', { id, filePath: 'proposta.txt', mimeType: 'text/plain', caption: 'Segue a proposta', clientKey: 'mcp-attachment-01' });
    assert.equal(attachment.status, 'accepted');
    const media = await call('aero_message_media', { id: attachment.id });
    assert.equal(await readFile(String(media.filePath), 'utf8'), 'Proposta de teste');
    const [unknown] = await env.ctx.db.insert(messages).values({ conversationId: id, direction: 'out', origin: 'manual', status: 'unknown', kind: 'text', body: 'Resultado incerto', idempotencyKey: 'test:unknown', occurredAt: env.ctx.now() }).$returningId();
    const sentBeforeResolve = env.wa.sent.length;
    await call('aero_message_resolve_unknown', { id: unknown!.id, as: 'not_sent' });
    assert.equal(env.wa.sent.length, sentBeforeResolve);
    const [pending] = await env.ctx.db.insert(messages).values({ conversationId: id, direction: 'out', origin: 'manual', status: 'scheduled', kind: 'text', body: 'A revisar', idempotencyKey: 'test:pending', occurredAt: env.ctx.now() }).$returningId();
    await call('aero_message_update', { id: pending!.id, body: 'Revisado' });
    await call('aero_message_cancel', { id: pending!.id });
    await call('aero_conversation_read', { id });
    await call('aero_conversation_resume_automation', { id });
    assert.equal((await env.ctx.db.select().from(conversations).where(eq(conversations.id, id)))[0]?.automationPaused, false);
    // Manual blocks can be corrected, while a later contact refusal makes them permanent.
    await call('aero_phone_suppress', { phoneId: phone[0]!.id, reason: 'manual' });
    await call('aero_phone_unsuppress', { phoneId: phone[0]!.id, reason: 'Bloqueio incorreto' });
    await call('aero_phone_suppress', { phoneId: phone[0]!.id, reason: 'manual' });
    await env.ctx.db.transaction((tx) => suppressPhone(tx, { phoneId: phone[0]!.id, reason: 'recusa', actor: 'contact', now: env.ctx.now() }));
    assert.equal((await client.callTool({ name: 'aero_phone_unsuppress', arguments: { phoneId: phone[0]!.id, reason: 'Não pode liberar' } })).isError, true);
    assert.equal((await client.callTool({ name: 'aero_conversation_open', arguments: { phoneId: phone[0]!.id } })).isError, true);
  });
});
