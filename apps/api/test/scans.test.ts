import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { companies, messages, phones, suppressions, opportunities } from '../src/db/schema.ts';
import { createScan, getScan, startScan } from '../src/modules/scans/service.ts';
import { scanTick } from '../src/modules/scans/orchestrator.ts';
import { runValidation } from '../src/modules/validation/service.ts';
import { suppressPhone } from '../src/modules/leads/suppression.ts';
import { createOpportunity } from '../src/modules/opportunities/service.ts';
import { createTestEnv, seedBasics, timeoutError, type TestEnv } from './helpers.ts';

const baseScan = {
  name: 'Teste Pinheiros',
  segment: 'Saúde',
  category: 'Dentista',
  keywords: ['dentista'],
  neighborhood: 'Pinheiros',
  city: 'São Paulo',
  state: 'SP',
  country: 'Brasil',
  countryCode: 'BR',
  language: 'pt',
  mode: 'collect_only' as const,
  targetKind: 'unique_phones' as const,
  targetCount: 100,
  campaignId: null,
  depth: 5,
  unitMaxSeconds: 180,
  maxUnits: 2,
  maxDurationMinutes: 60,
};

async function runToEnd(env: TestEnv, scanId: number, max = 30) {
  for (let i = 0; i < max; i++) {
    const r = await scanTick(env.ctx, scanId);
    if (r.nextInMs === null) return;
  }
  throw new Error('varredura não terminou');
}

const count = async (env: TestEnv, table: typeof companies | typeof messages | typeof phones) =>
  Number((await env.ctx.db.select({ n: sql<number>`COUNT(*)` }).from(table))[0]!.n);

describe('varreduras e importação', () => {
  let env: TestEnv;
  before(async () => {
    env = await createTestEnv();
  });
  after(async () => {
    await env.close();
  });
  beforeEach(async () => {
    await env.close();
    env = await createTestEnv();
    await seedBasics(env);
  });

  test('cenário 1: reimportar a mesma coleta não duplica nem apaga histórico comercial', async () => {
    const s1 = await createScan(env.ctx.db, baseScan);
    await startScan(env.ctx.db, s1, env.clock.now);
    await runToEnd(env, s1);
    const companiesAfterFirst = await count(env, companies);
    assert.equal(companiesAfterFirst, 7, '8 linhas no CSV, uma repetida (mesmo place_id)');

    // Histórico comercial: anotação, oportunidade e supressão
    const [p1] = await env.ctx.db.select().from(companies).where(eq(companies.sourcePlaceId, 'ChIJ_test_p1'));
    await env.ctx.db.update(companies).set({ notes: 'Falar com a Dra. Paula' }).where(eq(companies.id, p1!.id));
    await createOpportunity(env.ctx.db, { companyId: p1!.id, service: 'landing_page', title: 'Opp teste', stage: 'qualification', actor: 'owner' });
    const [ph] = await env.ctx.db.select().from(phones).where(eq(phones.e164, '+5511912345678'));
    await env.ctx.db.transaction((tx) => suppressPhone(tx, { phoneId: ph!.id, reason: 'recusa', actor: 'contact', now: env.clock.now }));

    // Nova varredura com a mesma consulta, sem reaproveitar (força nova coleta)
    env.clock.now = new Date(env.clock.now.getTime() + 48 * 3600_000);
    const s2 = await createScan(env.ctx.db, { ...baseScan, name: 'Reimportação' });
    await startScan(env.ctx.db, s2, env.clock.now);
    await runToEnd(env, s2);

    assert.equal(await count(env, companies), companiesAfterFirst, 'nenhuma empresa duplicada');
    const [p1b] = await env.ctx.db.select().from(companies).where(eq(companies.id, p1!.id));
    assert.equal(p1b!.notes, 'Falar com a Dra. Paula', 'anotação preservada');
    const opps = await env.ctx.db.select().from(opportunities).where(eq(opportunities.companyId, p1!.id));
    assert.equal(opps.length, 1, 'oportunidade preservada');
    const sup = await env.ctx.db.select().from(suppressions).where(eq(suppressions.phoneId, ph!.id));
    assert.equal(sup.length, 1, 'supressão preservada');
    const scan2 = await getScan(env.ctx.db, s2);
    assert.equal(scan2.newRecords, 0, 'segunda coleta não tem novos registros');
    assert.ok(scan2.duplicates >= 7);
  });

  test('telefone compartilhado entre empresas vira um único registro de telefone', async () => {
    const s = await createScan(env.ctx.db, baseScan);
    await startScan(env.ctx.db, s, env.clock.now);
    await runToEnd(env, s);
    const shared = await env.ctx.db.select().from(phones).where(eq(phones.e164, '+5511987654321'));
    assert.equal(shared.length, 1);
    const [links] = await env.ctx.db.execute(sql`SELECT COUNT(*) AS n FROM company_phones WHERE phone_id = ${shared[0]!.id}`);
    assert.equal(Number((links as unknown as { n: number }[])[0]!.n), 2, 'duas empresas, um telefone');
  });

  test('cenário 2: meta de números únicos ≠ meta de WhatsApps confirmados; excedente preservado', async () => {
    // Números válidos únicos no fixture: +5511987654321 (compartilhado), +551133334444, +5511912345678 => 3
    const s = await createScan(env.ctx.db, { ...baseScan, targetCount: 2 });
    await startScan(env.ctx.db, s, env.clock.now);
    await runToEnd(env, s);
    const scan = await getScan(env.ctx.db, s);
    assert.equal(scan.status, 'completed');
    assert.equal(scan.uniquePhones, 2, 'conta exatamente até a meta');
    assert.ok(scan.surplus >= 1, 'excedente marcado e salvo');
    assert.equal(await count(env, companies), 7, 'excedente também fica na base');

    // Meta de WhatsApp confirmado: um número inexistente, outro inconclusivo
    env.wa.checkImpl = async (numbers) =>
      numbers.map((n) =>
        n === '551133334444'
          ? { number: n, outcome: 'not_found' as const, jid: null, error: null }
          : n === '5511912345678'
            ? { number: n, outcome: 'inconclusive' as const, jid: null, error: 'Invalid number format' }
            : { number: n, outcome: 'found' as const, jid: `${n}@s.whatsapp.net`, error: null },
      );
    const w = await createScan(env.ctx.db, { ...baseScan, name: 'Meta WA', mode: 'collect_and_validate', targetKind: 'whatsapp_confirmed', targetCount: 3, maxUnits: 2 });
    env.clock.now = new Date(env.clock.now.getTime() + 48 * 3600_000);
    await startScan(env.ctx.db, w, env.clock.now);
    await runToEnd(env, w);
    const ws = await getScan(env.ctx.db, w);
    assert.equal(ws.waConfirmed, 1, 'apenas um WhatsApp confirmado');
    assert.equal(ws.uniquePhones, 3);
    assert.equal(ws.status, 'partial', 'meta impossível termina parcial');
    assert.match(ws.statusReason ?? '', /sem atingir a meta/);
  });

  test('cenário 3: falha de consulta nunca classifica como inexistente', async () => {
    const s = await createScan(env.ctx.db, baseScan);
    await startScan(env.ctx.db, s, env.clock.now);
    await runToEnd(env, s);
    env.wa.checkImpl = async () => {
      throw timeoutError();
    };
    const res = await runValidation(env.ctx, { kind: 'scan', scanId: s }, { maxBatches: 1, sleep: async () => {} });
    assert.ok(res.inconclusive > 0);
    const rows = await env.ctx.db.select().from(phones).where(eq(phones.formatStatus, 'valid'));
    assert.ok(rows.every((p) => p.waStatus === 'inconclusive'), 'timeout => inconclusivo');
    assert.ok(rows.every((p) => p.waStatus !== 'not_found'));

    // Sessão desconectada: não consulta e não altera estados
    env.wa.sessionStatus = 'disconnected';
    env.clock.now = new Date(env.clock.now.getTime() + 3600_000);
    const r2 = await runValidation(env.ctx, { kind: 'scan', scanId: s }, { sleep: async () => {} });
    assert.match(r2.stoppedReason ?? '', /Sessão WhatsApp indisponível/);
    assert.equal(r2.checked, 0);
  });

  test('cenário 4: coletar e validar não envia mensagens', async () => {
    const s = await createScan(env.ctx.db, { ...baseScan, mode: 'collect_and_validate', targetKind: 'whatsapp_confirmed', targetCount: 50 });
    await startScan(env.ctx.db, s, env.clock.now);
    await runToEnd(env, s);
    assert.equal(await count(env, messages), 0);
    assert.equal(env.wa.sent.length, 0);
  });

  test('cancelamento e limites de esforço encerram com motivo', async () => {
    env.scraper.autoComplete = false; // jobs ficam pendentes no coletor
    const s = await createScan(env.ctx.db, { ...baseScan, maxDurationMinutes: 5 });
    await startScan(env.ctx.db, s, env.clock.now);
    await scanTick(env.ctx, s); // submete a unidade
    env.clock.now = new Date(env.clock.now.getTime() + 10 * 60_000);
    await runToEnd(env, s);
    const scan = await getScan(env.ctx.db, s);
    assert.equal(scan.status, 'partial');
    assert.match(scan.statusReason ?? '', /Tempo máximo/);
  });
});
