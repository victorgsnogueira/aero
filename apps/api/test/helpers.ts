import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { createMemoryEventBus } from '../src/core/events.ts';
import type { AppContext } from '../src/core/context.ts';
import type { AppConfig } from '../src/config.ts';
import type { ScraperClient } from '../src/integrations/scraper/client.ts';
import type { CheckResult, WaGatewayClient } from '../src/integrations/wa/client.ts';
import { HttpError } from '../src/lib/http.ts';
import { updateSettings } from '../src/modules/settings/service.ts';
import { offers } from '../src/db/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Defina TEST_DATABASE_URL ou DATABASE_URL (o banco de teste será <nome>_test)');
  const u = new URL(base);
  u.pathname = `${u.pathname.replace(/\/$/, '')}_test`;
  if (!u.pathname.endsWith('_test')) throw new Error('Banco de teste precisa terminar em _test');
  return u.toString();
}

export interface FakeWa extends WaGatewayClient {
  sent: { jid: string; text: string }[];
  sessionStatus: 'connected' | 'disconnected';
  checkImpl: (numbers: string[]) => Promise<CheckResult[]>;
  sendImpl: (jid: string, text: string) => Promise<{ externalId: string; remoteJid: string | null }>;
  history: { keyId: string; remoteJid: string; fromMe: boolean; content: string | null; status: string; timestamp: string }[];
}

export function createFakeWa(): FakeWa {
  let n = 0;
  const fake: FakeWa = {
    sent: [],
    history: [],
    sessionStatus: 'connected',
    checkImpl: async (numbers) => numbers.map((number) => ({ number, outcome: 'found', jid: `${number}@s.whatsapp.net`, error: null })),
    sendImpl: async () => ({ externalId: `FAKE${++n}`, remoteJid: null }),
    async getSession() {
      return { status: fake.sessionStatus, rawStatus: fake.sessionStatus.toUpperCase(), ownJid: '5511900000000@s.whatsapp.net', exists: true };
    },
    async createSession() {},
    async getQr() {
      return { qr: null, image: null, reason: 'already_connected' };
    },
    async sessionAction() {},
    async disableBuiltInBot() {},
    async checkNumbers(_s, numbers) {
      return fake.checkImpl(numbers);
    },
    async sendText(_s, jid, text) {
      const r = await fake.sendImpl(jid, text);
      fake.sent.push({ jid, text });
      return r;
    },
    async sendMedia(_s, jid, _f, caption) {
      const r = await fake.sendImpl(jid, caption);
      fake.sent.push({ jid, text: caption });
      return r;
    },
    async getChatMessages() {
      return fake.history;
    },
    async listWebhooks() {
      return [];
    },
    async upsertWebhook() {},
    async ping() {
      return { ok: true, detail: 'fake' };
    },
  };
  return fake;
}

export interface FakeScraper extends ScraperClient {
  jobs: Map<string, { status: 'pending' | 'working' | 'ok' | 'failed'; csv: string; query: string }>;
  csvForQuery: (query: string) => string;
  autoComplete: boolean;
}

export function createFakeScraper(): FakeScraper {
  let n = 0;
  const fake: FakeScraper = {
    jobs: new Map(),
    csvForQuery: () => fixture('scraper-sample.csv'),
    autoComplete: true,
    async createJob(input) {
      const id = `job-${++n}`;
      fake.jobs.set(id, { status: fake.autoComplete ? 'ok' : 'pending', csv: fake.csvForQuery(input.query), query: input.query });
      return id;
    },
    async getJob(id) {
      const j = fake.jobs.get(id);
      return j ? { id, status: j.status, createdAt: new Date().toISOString() } : null;
    },
    async downloadCsv(id) {
      return fake.jobs.get(id)?.csv ?? null;
    },
    async deleteJob(id) {
      fake.jobs.delete(id);
    },
    async ping() {
      return { ok: true, detail: 'fake' };
    },
  };
  return fake;
}

export const timeoutError = () => new HttpError('timeout', 'Tempo esgotado (simulado)');
export const connectError = () => new HttpError('connect', 'Falha de conexão (simulada)');

export interface TestEnv {
  ctx: AppContext;
  wa: FakeWa;
  scraper: FakeScraper;
  handle: DbHandle;
  clock: { now: Date };
  close: () => Promise<void>;
}

let migrated = false;

export async function createTestEnv(overrides: Partial<AppConfig> = {}): Promise<TestEnv> {
  const url = testDatabaseUrl();
  if (!migrated) {

    const h = createDb(url, { connectionLimit: 1 });
    await h.db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    const [tables] = await h.db.execute(sql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()`);
    for (const { t } of tables as unknown as { t: string }[]) await h.db.execute(sql.raw(`DROP TABLE IF EXISTS \`${t}\``));
    await h.close();
    await runMigrations(url);
    migrated = true;
  }
  const handle = createDb(url, { connectionLimit: 5 });
  await truncateAll(handle);
  const wa = createFakeWa();
  const scraper = createFakeScraper();
  const clock = { now: new Date('2026-10-14T13:00:00Z') };
  const config: AppConfig = {
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    databaseUrl: url,
    redisUrl: 'redis://unused',
    allowedOrigins: ['http://localhost:5173'],
    allowedHosts: ['localhost', '127.0.0.1'],
    scraper: { baseUrl: 'http://scraper.test', timeoutMs: 1000 },
    gateway: { baseUrl: 'http://gateway.test', apiKey: 'test-key', sessionId: 'aero-test', webhookSecret: 'segredo-de-teste', webhookUrl: 'http://api/api/webhooks/wa', timeoutMs: 1000 },
    sending: { enabled: true, allowlist: [] },
    media: { dir: path.join(here, '..', '..', '..', 'tmp', 'test-media'), maxBytes: 1024 * 1024 },
    staticDir: null,
    ...overrides,
  };
  const ctx: AppContext = {
    config,
    db: handle.db,
    log: pino({ level: 'silent' }),
    events: createMemoryEventBus(),
    queues: null,
    scraper,
    wa,
    now: () => clock.now,
  };
  return { ctx, wa, scraper, handle, clock, close: () => handle.close() };
}

async function truncateAll(h: DbHandle) {
  const [tables] = await h.db.execute(sql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '__drizzle_migrations'`);
  await h.db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const { t } of tables as unknown as { t: string }[]) await h.db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
  await h.db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

export async function seedBasics(env: TestEnv): Promise<{ landingOfferId: number; saasOfferId: number }> {
  await updateSettings(env.ctx.db, { senderName: 'Ana Teste', companyName: 'Estúdio Teste', validationMinIntervalMs: 0 });
  const [a] = await env.ctx.db
    .insert(offers)
    .values({ service: 'landing_page', name: 'Landing Essencial', priceType: 'fixed', priceCents: 99000, currency: 'BRL' })
    .$returningId();
  const [b] = await env.ctx.db
    .insert(offers)
    .values({ service: 'micro_saas', name: 'Sistema Sob Medida', priceType: 'starting_at', priceCents: 450000, monthlyCents: 15000, currency: 'BRL' })
    .$returningId();
  return { landingOfferId: a!.id, saasOfferId: b!.id };
}

export const noSleep = async () => {};
