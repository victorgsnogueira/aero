import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/server.ts';
import { createApi, type ApiError } from '../src/api.ts';
import { createFiles } from '../src/files.ts';

test('invalid edits, financial records and session actions never reach the API', async () => {
  let count = 0;
  const server = createServer({ async request() { count++; return {}; } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'validation', version: '1' });
  await server.connect(st);
  await client.connect(ct);
  try {
    const invalid: [string, Record<string, unknown>][] = [
      ['aero_settings_update', { patch: {} }], ['aero_settings_update', { patch: { sendingEnabled: true } }],
      ['aero_settings_update', { patch: { sendMinIntervalSeconds: 1 } }],
      ['aero_lead_update', { id: 1, patch: { waStatus: 'found' } }],
      ['aero_lead_create', { name: 'Empresa', clientKey: 'company-01', latitude: 0 }],
      ['aero_offer_create', { service: 'landing_page', name: 'Oferta', priceType: 'fixed' }],
      ['aero_offer_create', { service: 'landing_page', name: 'Oferta', priceType: 'fixed', priceCents: 1.5 }],
      ['aero_offer_update', { id: 1, offer: { name: 'Sem os outros campos' } }],
      ['aero_proposal_update', { id: 1, proposal: { title: 'Sem os outros campos' } }],
      ['aero_payment_create', { id: 1, amountCents: 0, currency: 'BRL', receivedAt: '2026-10-17T10:00:00Z' }],
      ['aero_payment_create', { id: 1, amountCents: 100, currency: 'BRL', receivedAt: '2026-10-17T10:00:00' }],
      ['aero_message_send', { id: 1, text: '   ', clientKey: 'message-01' }],
      ['aero_message_send', { id: 1, text: 'Mensagem', clientKey: 'abc' }],
      ['aero_whatsapp_session_action', { action: 'logout' }],
      ['aero_campaign_add_audience_by_filter', { id: 1, filters: {} }],
    ];
    for (const [name, args] of invalid) {
      assert.equal((await client.callTool({ name, arguments: args })).isError, true, `${name}: ${JSON.stringify(args)}`);
    }
    assert.equal(count, 0);
  } finally { await client.close(); await server.close(); }
});

test('file access stays inside configured root and excludes hidden paths, secrets and oversized attachments', async () => {
  const taskRoot = await mkdtemp(path.join(os.tmpdir(), 'aero-mcp-files-'));
  try {
    const root = path.join(taskRoot, 'allowed');
    await mkdir(root);
    const files = createFiles(root);
    await writeFile(path.join(root, 'proposta.txt'), 'Conteúdo');
    assert.equal((await files.read('proposta.txt')).data.toString(), 'Conteúdo');
    await writeFile(path.join(taskRoot, 'outside.txt'), 'Não deve ser enviado');
    await assert.rejects(files.read('../outside.txt'), (e: ApiError) => e.code === 'file_not_allowed');
    await mkdir(path.join(root, '.codex'));
    await writeFile(path.join(root, '.codex', 'secret.txt'), 'Não deve ser enviado');
    await assert.rejects(files.read('.codex/secret.txt'), (e: ApiError) => e.code === 'file_not_allowed');
    await writeFile(path.join(root, '.env'), 'Não deve ser enviado');
    await assert.rejects(files.read('.env'), (e: ApiError) => e.code === 'file_not_allowed');
    const huge = await open(path.join(root, 'huge.txt'), 'w');
    await huge.truncate(16 * 1024 * 1024 + 1);
    await huge.close();
    await assert.rejects(files.read('huge.txt'), (e: ApiError) => e.code === 'file_too_large');
    const saved = await files.save('Exportação', 'csv');
    assert.equal(await readFile(saved, 'utf8'), 'Exportação');
    assert.equal(path.dirname(saved), path.join(root, 'exports', 'mcp'));
  } finally {
    if (path.dirname(taskRoot) === os.tmpdir() && path.basename(taskRoot).startsWith('aero-mcp-files-')) await rm(taskRoot, { recursive: true, force: true });
  }
});

test('HTTP bridge supports DELETE, multipart, CSV and binary without weakening read-only mode', async () => {
  const calls: RequestInit[] = [];
  const api = createApi({ fetch: async (_, init) => {
    calls.push(init!);
    if (init!.method === 'DELETE') return Response.json({ ok: true });
    const accept = new Headers(init!.headers).get('accept');
    if (accept === 'text/csv') return new Response('id,nome\n1,Teste', { headers: { 'content-type': 'text/csv' } });
    if (accept === '*/*') return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
    return Response.json({ ok: true });
  } });
  assert.deepEqual(await api.request('/opportunities/payments/1', { method: 'DELETE' }), { ok: true });
  const form = new FormData();
  form.set('clientKey', 'attachment-01');
  form.set('file', new Blob(['documento'], { type: 'text/plain' }), 'proposta.txt');
  await api.request('/inbox/conversations/1/attachments', { method: 'POST', body: form });
  assert.equal(new Headers(calls[1]?.headers).has('content-type'), false);
  assert.equal(calls[1]?.body, form);
  assert.equal(await api.request('/leads/export.csv', { responseType: 'text' }), 'id,nome\n1,Teste');
  assert.deepEqual(await api.request('/inbox/messages/1/media', { responseType: 'binary' }), { mimeType: 'image/png', data: new Uint8Array([1, 2]) });
  const readonly = createApi({ readOnly: true, fetch: async () => { throw new Error('I/O inesperado'); } });
  await assert.rejects(readonly.request('/opportunities/payments/1', { method: 'DELETE' }), (e: ApiError) => e.code === 'read_only');
  await assert.rejects(readonly.request('/inbox/conversations/1/attachments', { method: 'POST', body: form }), (e: ApiError) => e.code === 'read_only');
});
