// Gera docs/openapi.json a partir dos schemas das rotas (sem conectar a serviços).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { buildApp } from '../app.ts';
import { createDb } from '../db/client.ts';
import { createMemoryEventBus } from '../core/events.ts';
import { loadConfig } from '../config.ts';
import { createScraperClient } from '../integrations/scraper/client.ts';
import { createWaGatewayClient } from '../integrations/wa/client.ts';

process.env.DATABASE_URL ??= 'mysql://unused:unused@127.0.0.1:1/unused';
const config = loadConfig();
const handle = createDb(config.databaseUrl, { connectionLimit: 1 });
const app = await buildApp(
  {
    config,
    db: handle.db,
    log: pino({ level: 'silent' }),
    events: createMemoryEventBus(),
    queues: null,
    scraper: createScraperClient(config.scraper.baseUrl, 1000),
    wa: createWaGatewayClient({ baseUrl: config.gateway.baseUrl, apiKey: '', timeoutMs: 1000 }),
    now: () => new Date(),
  },
  { logger: false },
);
await app.ready();
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/openapi.json');
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
console.log(`OpenAPI gravado em ${out}`);
await app.close();
await handle.close();
