import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { companies } from '../src/db/schema.ts';
import { signWebhookBody } from '../src/integrations/wa/webhook.ts';
import { createTestEnv, seedBasics, type TestEnv } from './helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let env: TestEnv;
let app: FastifyInstance;

describe('rotas, segurança e mapa', () => {
  before(async () => {
    env = await createTestEnv();
    await seedBasics(env);
    app = await buildApp(env.ctx, { logger: false });
  });
  after(async () => {
    await app.close();
    await env.close();
  });

  test('proteção de origem, Host e CSRF', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/settings', headers: { host: 'localhost:8080' } });
    assert.equal(ok.statusCode, 200);
    const badHost = await app.inject({ method: 'GET', url: '/api/settings', headers: { host: 'evil.example' } });
    assert.equal(badHost.statusCode, 421, 'DNS rebinding bloqueado');
    const noHeader = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { host: 'localhost', 'content-type': 'application/json' }, payload: { senderName: 'X' } });
    assert.equal(noHeader.statusCode, 403);
    const badOrigin = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { host: 'localhost', origin: 'https://evil.example', 'x-aero-request': '1', 'content-type': 'application/json' }, payload: { senderName: 'X' } });
    assert.equal(badOrigin.statusCode, 403);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/settings', headers: { host: 'localhost', origin: 'https://evil.example', 'access-control-request-method': 'PATCH' } });
    assert.notEqual(preflight.headers['access-control-allow-origin'], 'https://evil.example');
    const good = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { host: 'localhost', origin: 'http://localhost:5173', 'x-aero-request': '1', 'content-type': 'application/json' }, payload: { senderName: 'Ana' } });
    assert.equal(good.statusCode, 200);
  });

  test('webhook exige assinatura válida', async () => {
    const body = JSON.stringify({ event: 'message.received', sessionId: 'aero-test', timestamp: 't', data: { key: { id: 'X1' } } });
    const noSig = await app.inject({ method: 'POST', url: '/api/webhooks/wa', headers: { 'content-type': 'application/json' }, payload: body });
    assert.equal(noSig.statusCode, 401);
    const wrong = await app.inject({ method: 'POST', url: '/api/webhooks/wa', headers: { 'content-type': 'application/json', 'x-webhook-signature': signWebhookBody(body, 'errado') }, payload: body });
    assert.equal(wrong.statusCode, 401);
    const right = await app.inject({ method: 'POST', url: '/api/webhooks/wa', headers: { 'content-type': 'application/json', 'x-webhook-signature': signWebhookBody(body, 'segredo-de-teste') }, payload: body });
    assert.equal(right.statusCode, 200);
  });

  test('validação de entrada (JSON Schema)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/scans', headers: { host: 'localhost', 'x-aero-request': '1', 'content-type': 'application/json' }, payload: { name: '' } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'validation');
    const meta = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { host: 'localhost', 'x-aero-request': '1', 'content-type': 'application/json' },
      payload: { name: 'x', segment: null, category: null, keywords: ['dentista'], neighborhood: null, city: 'Campinas', state: null, country: null, countryCode: 'BR', language: 'pt', mode: 'collect_only', targetKind: 'whatsapp_confirmed', targetCount: 10, campaignId: null, maxUnits: 2, maxDurationMinutes: 30 },
    });
    assert.equal(meta.statusCode, 400, 'meta de WhatsApp exige modo com validação');
  });

  test('cenário 14: mapa usa coordenadas coletadas e conta registros sem localização', async () => {
    await env.ctx.db.insert(companies).values([
      { name: 'Com coordenada', sourcePlaceId: 'm1', latitude: '-23.5500000', longitude: '-46.6300000' },
      { name: 'Outra com coordenada', sourcePlaceId: 'm2', latitude: '-23.5600000', longitude: '-46.6400000' },
      { name: 'Sem coordenada', sourcePlaceId: 'm3', latitude: null, longitude: null },
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/leads/map?west=-47&south=-24&east=-46&north=-23&zoom=10', headers: { host: 'localhost' } });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.mode, 'points');
    assert.equal(body.points.length, 2);
    assert.equal(body.withoutCoords, 1);
    assert.ok(body.points.every((p: { lat: number }) => p.lat !== 0));
    const out = await app.inject({ method: 'GET', url: '/api/leads/map?west=10&south=10&east=11&north=11&zoom=10', headers: { host: 'localhost' } });
    assert.equal(out.json().points.length, 0, 'consulta por área visível');
  });

  test('cenário 15: proposta aceita e pagamento confirmado são eventos distintos', async () => {
    const H = { host: 'localhost', 'x-aero-request': '1', 'content-type': 'application/json' };
    const [c] = await env.ctx.db.insert(companies).values({ name: 'Cliente P', sourcePlaceId: 'p-x' }).$returningId();
    const opp = await app.inject({ method: 'POST', url: '/api/opportunities', headers: H, payload: { companyId: c!.id, service: 'landing_page', title: 'LP Cliente P', conversationId: null } });
    const oppId = opp.json().id as number;
    const won = await app.inject({ method: 'POST', url: `/api/opportunities/${oppId}/stage`, headers: H, payload: { stage: 'won', reason: null } });
    assert.equal(won.statusCode, 409, 'ganho exige proposta aceita');
    const lost = await app.inject({ method: 'POST', url: `/api/opportunities/${oppId}/stage`, headers: H, payload: { stage: 'lost', reason: null } });
    assert.equal(lost.statusCode, 400, 'perda exige motivo');
    const prop = await app.inject({
      method: 'POST',
      url: `/api/opportunities/${oppId}/proposals`,
      headers: H,
      payload: { title: 'Proposta', scope: null, amountCents: 100000, setupCents: 20000, monthlyCents: null, currency: 'BRL', conditions: null, validUntil: null, origin: null },
    });
    const pid = prop.json().id as number;
    const earlyPay = await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/payments`, headers: H, payload: { amountCents: 1000, currency: 'BRL', receivedAt: new Date().toISOString(), method: null, note: null } });
    assert.equal(earlyPay.statusCode, 409);
    await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/status`, headers: H, payload: { status: 'sent', reason: null } });
    await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/status`, headers: H, payload: { status: 'accepted', reason: null } });
    let detail = (await app.inject({ method: 'GET', url: `/api/opportunities/${oppId}`, headers: { host: 'localhost' } })).json();
    assert.equal(detail.opportunity.stage, 'won', 'aceite move para ganho');
    assert.equal(detail.proposals[0].paymentStatus, 'pending', 'pagamento continua pendente');
    const pay = await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/payments`, headers: H, payload: { amountCents: 50000, currency: 'BRL', receivedAt: new Date().toISOString(), method: 'Pix', note: null } });
    assert.equal(pay.json().status, 'partial');
    const wrongCurrency = await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/payments`, headers: H, payload: { amountCents: 70000, currency: 'USD', receivedAt: new Date().toISOString(), method: null, note: null } });
    assert.equal(wrongCurrency.statusCode, 400);
    await app.inject({ method: 'POST', url: `/api/opportunities/proposals/${pid}/payments`, headers: H, payload: { amountCents: 70000, currency: 'BRL', receivedAt: new Date().toISOString(), method: 'Pix', note: null } });
    detail = (await app.inject({ method: 'GET', url: `/api/opportunities/${oppId}`, headers: { host: 'localhost' } })).json();
    assert.equal(detail.proposals[0].paymentStatus, 'confirmed');
    const m = (await app.inject({ method: 'GET', url: '/api/metrics/overview', headers: { host: 'localhost' } })).json();
    assert.deepEqual(m.money.received, { BRL: 120000 });
    assert.equal(m.proposals.fullyPaid, 1);
  });

  test('OpenAPI publicado', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/docs/json', headers: { host: 'localhost' } });
    assert.equal(r.statusCode, 200);
    assert.ok(Object.keys(r.json().paths).length > 40);
  });
});

describe('cenários 19 e 20: exposição de rede (configuração)', () => {
  /** Itens de lista dentro de blocos `ports:` de um arquivo compose. */
  function publishedPorts(yaml: string): string[] {
    const out: string[] = [];
    let indent = -1;
    for (const line of yaml.split('\n')) {
      const m = /^(\s*)ports:\s*(.*)$/.exec(line);
      if (m) {
        indent = m[1]!.length;
        const inline = m[2]!.match(/"[^"]+"/g);
        if (inline) out.push(...inline);
        continue;
      }
      if (indent >= 0) {
        const item = /^(\s*)- (.+)$/.exec(line);
        if (item && item[1]!.length > indent) out.push(item[2]!.trim());
        else if (line.trim() && !/^\s*#/.test(line)) indent = -1;
      }
    }
    return out;
  }

  test('somente o serviço web publica porta, e apenas em 127.0.0.1', () => {
    const ports = publishedPorts(readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'));
    assert.equal(ports.length, 1, `portas publicadas: ${ports.join(' | ')}`);
    assert.match(ports[0]!, /^"127\.0\.0\.1:/);
    const devPorts = publishedPorts(readFileSync(path.join(root, 'compose.dev.yml'), 'utf8'));
    assert.ok(devPorts.length > 0);
    for (const p of devPorts) assert.match(p, /^"127\.0\.0\.1:/);
  });
  test('configuração de produção mantém a mesma fronteira (proxy único em loopback para o Tailscale)', () => {
    const prod = readFileSync(path.join(root, 'infra/vps/compose.vps.yml'), 'utf8');
    assert.doesNotMatch(prod, /0\.0\.0\.0:/);
    const ports = publishedPorts(prod);
    assert.equal(ports.length, 1);
    assert.match(ports[0]!, /^"127\.0\.0\.1:/);
  });
});
