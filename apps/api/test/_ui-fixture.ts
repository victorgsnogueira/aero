// Cenário fictício no banco aero_test para inspeção visual da interface.
// Usa os mesmos fakes dos testes (nenhuma integração real é chamada).
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { companies, companyPhones, phones, webhookEvents } from '../src/db/schema.ts';
import { dispatchTick } from '../src/modules/messaging/dispatcher.ts';
import { processWebhookEvent } from '../src/modules/automation/inbound.ts';
import { signWebhookBody } from '../src/integrations/wa/webhook.ts';
import { createTestEnv, seedBasics } from './helpers.ts';

const env = await createTestEnv();
env.ctx.config.gateway.sessionId = 'aero-main';
const { landingOfferId, saasOfferId } = await seedBasics(env);
const app = await buildApp(env.ctx, { logger: false });
const H = { 'x-aero-request': '1', host: 'localhost', 'content-type': 'application/json' };
const call = async (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: object = {}) => (await app.inject({ method, url: `/api${url}`, headers: H, payload })).json();

const names = ['Clínica Sorriso (fictícia)', 'Pizzaria Bella (fictícia)', 'Studio Fit (fictícia)', 'Pet Amigo (fictícia)', 'Contábil Alfa (fictícia)'];
const ids: number[] = [];
for (let i = 0; i < names.length; i++) {
  const e164 = `+551199000000${i + 1}`;
  const [c] = await env.ctx.db.insert(companies).values({ name: names[i]!, sourcePlaceId: `ui-${i}`, city: 'São Paulo', state: 'SP', category: i % 2 ? 'Restaurante' : 'Saúde', latitude: (-23.56 - i * 0.01).toFixed(7), longitude: (-46.65 - i * 0.01).toFixed(7) }).$returningId();
  await env.ctx.db.insert(phones).values({ e164, dedupeKey: e164, rawSample: e164, countryCode: 'BR', formatStatus: 'valid', waStatus: 'found', waCheckedAt: env.clock.now });
  const [p] = await env.ctx.db.select().from(phones).where(sql`${phones.dedupeKey} = ${e164}`);
  await env.ctx.db.insert(companyPhones).values({ companyId: c!.id, phoneId: p!.id, rawValue: e164 });
  ids.push(c!.id);
}
const c1 = (await call('POST', '/campaigns', { name: 'Landing pages — saúde', service: 'landing_page', offerId: landingOfferId })).id;
const c2 = (await call('POST', '/campaigns', { name: 'Sistemas — comércio', service: 'micro_saas', offerId: saasOfferId })).id;
await call('POST', `/campaigns/${c1}/contacts`, { companyIds: ids.slice(0, 3) });
await call('POST', `/campaigns/${c2}/contacts`, { companyIds: ids.slice(2) });
await call('POST', `/campaigns/${c1}/status`, { to: 'active' });
await call('POST', `/campaigns/${c2}/status`, { to: 'active' });
for (let i = 0; i < 12; i++) {
  const r = await dispatchTick(env.ctx);
  env.clock.now = new Date(env.clock.now.getTime() + Math.max(r.nextInMs, 1000));
}
let n = 0;
async function inbound(e164: string, text: string) {
  const payload = JSON.stringify({ event: 'message.received', sessionId: 'aero-main', timestamp: new Date().toISOString(), data: { key: { id: `UI${++n}` }, from: `${e164.slice(1)}@s.whatsapp.net`, chatType: 'PERSONAL', type: 'TEXT', content: text, pushName: 'Contato' } });
  await app.inject({ method: 'POST', url: '/api/webhooks/wa', headers: { 'content-type': 'application/json', 'x-webhook-signature': signWebhookBody(payload, 'segredo-de-teste') }, payload });
  for (const e of await env.ctx.db.select().from(webhookEvents).where(sql`${webhookEvents.processedAt} IS NULL`)) await processWebhookEvent(env.ctx, e.id);
  for (let i = 0; i < 3; i++) {
    const r = await dispatchTick(env.ctx);
    env.clock.now = new Date(env.clock.now.getTime() + Math.max(r.nextInMs, 1000));
  }
}
await inbound('+5511990000001', 'Pode mandar sim');
await inbound('+5511990000001', 'Quero receber pedidos de orçamento pelo WhatsApp');
await inbound('+5511990000002', 'Não tenho interesse');
await inbound('+5511990000004', 'Quem passou meu número?');
const [opp] = (await env.ctx.db.execute(sql`SELECT id FROM opportunities LIMIT 1`))[0] as unknown as { id: number }[];
if (opp) {
  const prop = await call('POST', `/opportunities/${opp.id}/proposals`, { title: 'Landing page — Clínica Sorriso', scope: 'Página única com serviços, galeria e botão de WhatsApp', amountCents: 99000, setupCents: null, monthlyCents: null, currency: 'BRL', conditions: '50% na aprovação', validUntil: null, origin: 'campanha' });
  await call('POST', `/opportunities/proposals/${prop.id}/status`, { status: 'sent', reason: null });
  await call('POST', `/opportunities/proposals/${prop.id}/status`, { status: 'accepted', reason: null });
  await call('POST', `/opportunities/proposals/${prop.id}/payments`, { amountCents: 49500, currency: 'BRL', receivedAt: new Date().toISOString(), method: 'Pix', note: 'Entrada' });
}
console.log('Cenário de inspeção criado em aero_test.');
await app.close();
await env.close();
