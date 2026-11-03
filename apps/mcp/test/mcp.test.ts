import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ApiError, createApi, type ApiRequest } from '../src/api.ts';
import { createServer, summarizeMap } from '../src/server.ts';

async function connect(readOnly = false) {
  const calls: { path: string; options: ApiRequest }[] = [];
  const server = createServer({ async request(path, options = {}) {
    calls.push({ path, options });
    if (path === '/leads/999') throw new ApiError('not_found', 'Empresa não encontrada', 404);
    return { ok: true, queued: path === '/leads/validate' };
  } }, { readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'aero-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { calls, client, close: async () => { await client.close(); await server.close(); } };
}

test('MCP exposes actionable tools and forwards only validated, scoped requests', async () => {
  const env = await connect();
  try {
    const { tools } = await env.client.listTools();
    assert.ok(tools.length >= 30);
    assert.equal(tools.find((t) => t.name === 'aero_campaign_activate')?.annotations?.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === 'aero_campaign_activate')?.annotations?.openWorldHint, true);
    assert.equal(tools.find((t) => t.name === 'aero_map_analyze')?.annotations?.readOnlyHint, true);
    await env.client.callTool({ name: 'aero_campaign_activate', arguments: { id: 7 } });
    assert.equal(env.calls[0]?.path, '/campaigns/7/status');
    assert.deepEqual(env.calls[0]?.options.body, { to: 'active' });
    await env.client.callTool({ name: 'aero_campaign_create', arguments: { name: 'Teste', service: 'landing_page' } });
    assert.deepEqual(env.calls[1]?.options.body, { name: 'Teste', service: 'landing_page', offerId: null });
    await env.client.callTool({ name: 'aero_campaign_add_audience', arguments: { id: 7, companyIds: [1, 2] } });
    assert.deepEqual(env.calls[2]?.options.body, { companyIds: [1, 2] });
    const validation = await env.client.callTool({ name: 'aero_whatsapp_validate', arguments: { phoneIds: [3] } });
    assert.deepEqual(validation.structuredContent, { data: { ok: true, queued: true } });
    assert.equal(env.calls.filter((x) => x.path.includes('/status')).length, 1);
  } finally { await env.close(); }
});

test('MCP rejects ambiguous validation, oversized batches, bad IDs and invalid regions before I/O', async () => {
  const env = await connect();
  try {
    for (const args of [{}, { scanId: 1, phoneIds: [1] }, { phoneIds: [] }, { phoneIds: Array.from({ length: 501 }, () => 1) }]) {
      const result = await env.client.callTool({ name: 'aero_whatsapp_validate', arguments: args });
      assert.equal(result.isError, true);
    }
    assert.equal((await env.client.callTool({ name: 'aero_campaign_activate', arguments: { id: '../settings' } })).isError, true);
    assert.equal((await env.client.callTool({ name: 'aero_map_analyze', arguments: { west: -50, east: -40, south: 5, north: -5 } })).isError, true);
    for (const args of [{ name: 'Teste', keywords: ['dentista'] }, { name: 'Teste', keywords: ['dentista'], city: 'São Paulo', targetKind: 'whatsapp_confirmed' }]) {
      assert.equal((await env.client.callTool({ name: 'aero_scan_create', arguments: args })).isError, true);
    }
    assert.equal(env.calls.length, 0);
    await env.client.callTool({ name: 'aero_scan_create', arguments: { name: 'Teste', keywords: ['dentista'], city: 'São Paulo' } });
    const body = env.calls[0]?.options.body as Record<string, unknown>;
    assert.equal(body.startNow, false);
    assert.equal(body.mode, 'collect_only');
    assert.equal(body.campaignId, null);
  } finally { await env.close(); }
});

test('read-only catalog excludes mutations but keeps previews; API errors are MCP errors', async () => {
  const env = await connect(true);
  try {
    const { tools } = await env.client.listTools();
    assert.ok(tools.every((x) => x.annotations?.readOnlyHint));
    assert.ok(!tools.some((x) => x.name === 'aero_campaign_activate'));
    assert.ok(tools.some((x) => x.name === 'aero_campaign_preview'));
    const result = await env.client.callTool({ name: 'aero_lead_get', arguments: { id: 999 } });
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, { error: 'not_found', message: 'Empresa não encontrada', status: 404 });
  } finally { await env.close(); }
});

test('HTTP bridge enforces local destination, headers, query encoding, no redirects and no retries', async () => {
  for (const baseUrl of ['http://example.com', 'http://127.0.0.1.evil.test', 'http://0.0.0.0', 'http://127.0.0.1@evil.test', 'file:///etc/passwd', 'http://127.0.0.1/other', 'http://127.0.0.1?target=bad']) {
    assert.throws(() => createApi({ baseUrl }));
  }
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createApi({ fetch: async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return Response.json({ error: 'sending_disabled', message: 'Envios desabilitados' }, { status: 409 });
  } });
  await assert.rejects(api.request('/campaigns/7/status', { method: 'POST', body: { to: 'active' } }), (e: ApiError) => e.code === 'sending_disabled' && e.status === 409);
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0]?.init.headers).get('x-aero-request'), '1');
  assert.equal(calls[0]?.init.redirect, 'error');
  await assert.rejects(api.request('/leads/', { query: { q: 'A&B + C', suppressed: false, page: 2, scanId: undefined } }));
  const url = new URL(calls[1]!.url);
  assert.equal(url.searchParams.get('q'), 'A&B + C');
  assert.equal(url.searchParams.get('suppressed'), 'false');
  assert.equal(url.searchParams.has('scanId'), false);
  await assert.rejects(api.request('/../settings'));
  let attempts = 0;
  const unavailable = createApi({ fetch: async () => { attempts++; throw new Error('secret upstream detail'); } });
  await assert.rejects(unavailable.request('/scans/', { method: 'POST', body: {} }), /operação pode ter sido aplicada/);
  assert.equal(attempts, 1);
  const readonly = createApi({ readOnly: true, fetch: async () => Response.json({ text: 'Prévia' }) });
  await assert.rejects(readonly.request('/scans/', { method: 'POST' }), (e: ApiError) => e.code === 'read_only');
  assert.deepEqual(await readonly.request('/campaigns/1/preview', { method: 'POST', body: { template: 'Oi' } }), { text: 'Prévia' });
});

test('map reports whole returned set separately from page and flags incomplete grid coverage', () => {
  const points = Array.from({ length: 205 }, (_, i) => ({ id: 205 - i, lat: -23, lng: -46, name: `Empresa ${i}`, waStatus: 'found', stage: null }));
  const result = summarizeMap({ mode: 'points', total: 205, withoutCoords: 9, points, cells: [] }, 2, 200);
  assert.equal(result.items.length, 5);
  assert.equal((result.items[0] as { id: number }).id, 201);
  assert.equal(result.summary?.whatsapp.found, 205);
  assert.equal(result.hasMore, false);
  assert.equal(result.coverageComplete, true);
  const grid = summarizeMap({ mode: 'grid', total: 9000, withoutCoords: 2, points: [], cells: [{ lat: 0, lng: 0, count: 5000 }] }, 1, 50);
  assert.equal(grid.summary, null);
  assert.equal(grid.coverageComplete, false);
});

test('stdio process completes handshake and calls a local fake API without database/gateway', async () => {
  const requests: string[] = [];
  const http = createHttpServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ready' }));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    env: { AERO_MCP_API_URL: `http://127.0.0.1:${address.port}`, AERO_MCP_READ_ONLY: 'true' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1' });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.length > 10);
    const result = await client.callTool({ name: 'aero_status', arguments: {} });
    assert.deepEqual(result.structuredContent, { data: { status: 'ready' } });
    assert.deepEqual(requests, ['/api/health/ready']);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close((err) => err ? reject(err) : resolve()));
  }
});
