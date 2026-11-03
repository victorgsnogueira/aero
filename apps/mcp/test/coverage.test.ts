import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/server.ts';
import type { ApiRequest } from '../src/api.ts';

test('every MCP tool has a checked route and all business API operations are reachable', async () => {
  const filesRoot = await mkdtemp(path.join(os.tmpdir(), 'aero-mcp-coverage-'));
  await writeFile(path.join(filesRoot, 'anexo.txt'), 'Anexo simulado');
  const calls: { path: string; options: ApiRequest }[] = [];
  const server = createServer({ async request(route, options = {}) {
    calls.push({ path: route, options });
    if (options.responseType === 'text') return 'id,empresa\n1,Teste\n';
    if (options.responseType === 'binary') return { mimeType: 'text/plain', data: new TextEncoder().encode('Anexo simulado') };
    if (route === '/leads/map') return { mode: 'points', total: 0, withoutCoords: 0, points: [], cells: [] };
    if (route === '/whatsapp/session/qr') return { image: 'data:image/png;base64,aGVsbG8=', reason: null };
    return { ok: true };
  } }, { filesRoot });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'coverage', version: '1' });
  await server.connect(st);
  await client.connect(ct);
  const campaign = { name: 'Campanha', objective: null, offerId: 1, firstMessageTemplate: 'Olá', presentationTemplate: null, qualificationQuestions: [], questionsPerMessage: 1, qualificationDoneTemplate: null, declineAckTemplate: null, timezone: 'America/Sao_Paulo', sendDays: [1], sendWindowStart: '09:00', sendWindowEnd: '18:00', dailyLimit: 10, noReplyCloseHours: 24, audienceFilters: null };
  const offer = { service: 'landing_page', name: 'Oferta', description: null, scope: null, priceType: 'fixed', priceCents: 10000, setupCents: null, monthlyCents: null, currency: 'BRL', conditions: null, validUntil: null };
  const proposal = { title: 'Proposta', scope: null, amountCents: 10000, setupCents: null, monthlyCents: null, currency: 'BRL', conditions: null, validUntil: null, origin: 'mcp' };
  type Case = [string, Record<string, unknown>, string, string];
  const cases: Case[] = [
    ['aero_status', {}, 'GET', '/health/ready'], ['aero_whatsapp_status', {}, 'GET', '/whatsapp/session'],
    ['aero_metrics', {}, 'GET', '/metrics/overview'], ['aero_attention', {}, 'GET', '/metrics/attention'],
    ['aero_leads_list', {}, 'GET', '/leads/'], ['aero_lead_get', { id: 1 }, 'GET', '/leads/1'],
    ['aero_lead_notes', { id: 1, notes: null }, 'PATCH', '/leads/1'],
    ['aero_map_analyze', { west: 170, east: -170, south: -10, north: 10 }, 'GET', '/leads/map'],
    ['aero_whatsapp_validate', { scanId: 1 }, 'POST', '/leads/validate'],
    ['aero_phone_suppress', { phoneId: 1, reason: 'manual' }, 'POST', '/leads/phones/1/suppress'],
    ['aero_scans_list', {}, 'GET', '/scans/'], ['aero_scan_get', { id: 1 }, 'GET', '/scans/1'],
    ['aero_scan_create', { name: 'Varredura', keywords: ['dentista'], city: 'São Paulo' }, 'POST', '/scans/'],
    ['aero_offers_list', { includeArchived: true }, 'GET', '/offers/'],
    ['aero_campaigns_list', {}, 'GET', '/campaigns/'], ['aero_campaign_get', { id: 1 }, 'GET', '/campaigns/1'],
    ['aero_campaign_create', { name: 'Campanha', service: 'landing_page' }, 'POST', '/campaigns/'],
    ['aero_campaign_configure', { id: 1, config: campaign }, 'PUT', '/campaigns/1'],
    ['aero_campaign_add_audience', { id: 1, companyIds: [1] }, 'POST', '/campaigns/1/contacts'],
    ['aero_campaign_contacts', { id: 1 }, 'GET', '/campaigns/1/contacts'],
    ['aero_campaign_eligibility', { id: 1 }, 'GET', '/campaigns/1/eligibility'],
    ['aero_campaign_preview', { id: 1, template: 'Olá' }, 'POST', '/campaigns/1/preview'],
    ['aero_campaign_pending', { id: 1 }, 'GET', '/campaigns/1/pending'],
    ['aero_conversations_list', {}, 'GET', '/inbox/conversations'], ['aero_conversation_get', { id: 1 }, 'GET', '/inbox/conversations/1'],
    ['aero_opportunities_list', {}, 'GET', '/opportunities/'], ['aero_opportunity_get', { id: 1 }, 'GET', '/opportunities/1'],
    ['aero_settings_get', {}, 'GET', '/settings/'], ['aero_settings_update', { patch: { senderName: 'Ana' } }, 'PATCH', '/settings/'],
    ['aero_offer_get', { id: 1 }, 'GET', '/offers/1'], ['aero_offer_create', { service: 'landing_page', name: 'Oferta', priceType: 'fixed', priceCents: 10000 }, 'POST', '/offers/'],
    ['aero_offer_update', { id: 1, offer }, 'PUT', '/offers/1'], ['aero_offer_archive', { id: 1 }, 'POST', '/offers/1/archive'],
    ['aero_lead_create', { name: 'Cliente', clientKey: 'manual-client-01' }, 'POST', '/leads/'], ['aero_lead_update', { id: 1, patch: { name: 'Editado' } }, 'PATCH', '/leads/1'],
    ['aero_lead_add_phone', { id: 1, phone: '+5511987654321' }, 'POST', '/leads/1/phones'],
    ['aero_lead_facets', {}, 'GET', '/leads/facets'], ['aero_leads_export', {}, 'GET', '/leads/export.csv'],
    ['aero_phone_unsuppress', { phoneId: 1, reason: 'Correção manual' }, 'POST', '/leads/phones/1/unsuppress'],
    ['aero_scan_recount', { id: 1 }, 'POST', '/scans/1/recount'],
    ['aero_campaign_remove_audience', { id: 1, ids: [2] }, 'POST', '/campaigns/1/contacts/remove'],
    ['aero_campaign_apply_template', { id: 1, messageIds: [2] }, 'POST', '/campaigns/1/pending/apply-template'],
    ['aero_campaign_add_audience_by_filter', { id: 1, filters: { city: 'São Paulo' } }, 'POST', '/campaigns/1/contacts'],
    ['aero_whatsapp_provision', {}, 'POST', '/whatsapp/session/provision'], ['aero_whatsapp_qr', {}, 'GET', '/whatsapp/session/qr'],
    ['aero_whatsapp_session_action', { action: 'logout', confirm: true }, 'POST', '/whatsapp/session/logout'], ['aero_whatsapp_diagnostics', {}, 'GET', '/whatsapp/diagnostics'],
    ['aero_conversation_open', { phoneId: 1 }, 'POST', '/inbox/conversations'],
    ['aero_conversation_update', { id: 1, patch: { notes: 'Notas' } }, 'PATCH', '/inbox/conversations/1'],
    ['aero_message_send', { id: 1, text: 'Mensagem', clientKey: 'message-01' }, 'POST', '/inbox/conversations/1/messages'],
    ['aero_attachment_send', { id: 1, filePath: 'anexo.txt', mimeType: 'text/plain', clientKey: 'attachment-01' }, 'POST', '/inbox/conversations/1/attachments'],
    ['aero_message_update', { id: 1, body: 'Texto' }, 'PATCH', '/inbox/messages/1'], ['aero_message_cancel', { id: 1 }, 'POST', '/inbox/messages/1/cancel'],
    ['aero_message_resolve_unknown', { id: 1, as: 'not_sent' }, 'POST', '/inbox/messages/1/resolve-unknown'], ['aero_message_media', { id: 1 }, 'GET', '/inbox/messages/1/media'],
    ['aero_opportunity_create', { companyId: 1, service: 'landing_page', title: 'Projeto' }, 'POST', '/opportunities/'],
    ['aero_opportunity_update', { id: 1, patch: { title: 'Projeto editado' } }, 'PATCH', '/opportunities/1'], ['aero_opportunity_stage', { id: 1, stage: 'negotiation' }, 'POST', '/opportunities/1/stage'],
    ['aero_proposals_list', {}, 'GET', '/opportunities/proposals'], ['aero_proposal_create', { id: 1, proposal: { title: 'Proposta', amountCents: 10000 } }, 'POST', '/opportunities/1/proposals'],
    ['aero_proposal_update', { id: 1, proposal }, 'PUT', '/opportunities/proposals/1'], ['aero_proposal_status', { id: 1, status: 'accepted' }, 'POST', '/opportunities/proposals/1/status'],
    ['aero_payment_create', { id: 1, amountCents: 10000, currency: 'BRL', receivedAt: '2026-10-17T12:00:00-03:00' }, 'POST', '/opportunities/proposals/1/payments'],
    ['aero_payment_delete', { id: 1 }, 'DELETE', '/opportunities/payments/1'], ['aero_metrics_campaigns', {}, 'GET', '/metrics/campaigns'],
  ];
  for (const action of ['start', 'pause', 'resume', 'cancel']) cases.push([`aero_scan_${action}`, { id: 1 }, 'POST', `/scans/1/${action}`]);
  for (const action of ['activate', 'pause', 'complete', 'cancel']) cases.push([`aero_campaign_${action}`, { id: 1 }, 'POST', '/campaigns/1/status']);
  for (const [action, route] of [['read', 'read'], ['takeover', 'takeover'], ['resume_automation', 'resume-automation']]) cases.push([`aero_conversation_${action}`, { id: 1 }, 'POST', `/inbox/conversations/1/${route}`]);
  try {
    const catalog = (await client.listTools()).tools;
    assert.deepEqual(new Set(catalog.map((x) => x.name)), new Set(cases.map((x) => x[0])), 'Toda ferramenta precisa de um caso de contrato');
    const observed = new Set<string>();
    const normalize = (route: string) => route.replace(/\/$/, '').replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/session\/(start|stop|restart|logout)$/, '/session/{action}');
    for (const [name, args, method, route] of cases) {
      const count = calls.length;
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, `${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
      assert.equal(calls.length, count + 1, name);
      const call = calls.at(-1)!;
      assert.equal(call.options.method ?? 'GET', method, name);
      assert.equal(call.path, route, name);
      observed.add(`${method} ${normalize(`/api${route}`)}`);
      if (name === 'aero_whatsapp_qr') assert.ok(result.content.some((x) => x.type === 'image'));
      if (name === 'aero_attachment_send') assert.ok(call.options.body instanceof FormData);
    }
    const spec = JSON.parse(await readFile(new URL('../../../docs/openapi.json', import.meta.url), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const excluded = new Set(['GET /api/health/live', 'POST /api/webhooks/wa']);
    for (const [route, verbs] of Object.entries(spec.paths)) {
      for (const method of Object.keys(verbs).filter((x) => ['get', 'post', 'put', 'patch', 'delete'].includes(x))) {
        const operation = `${method.toUpperCase()} ${normalize(route)}`;
        if (!excluded.has(operation)) assert.ok(observed.has(operation), `Operação da API sem ferramenta MCP: ${operation}`);
      }
    }
    for (const name of ['aero_settings_update', 'aero_offer_create', 'aero_lead_create', 'aero_message_send', 'aero_payment_delete']) assert.equal(catalog.find((x) => x.name === name)?.annotations?.readOnlyHint, false);
  } finally {
    await client.close();
    await server.close();
    if (path.dirname(filesRoot) === os.tmpdir() && path.basename(filesRoot).startsWith('aero-mcp-coverage-')) await rm(filesRoot, { recursive: true, force: true });
  }
});
