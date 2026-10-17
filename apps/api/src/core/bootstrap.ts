import pino from 'pino';
import { loadConfig, type AppConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { createEventBus } from './events.ts';
import { createQueues, redisConnection } from './queues.ts';
import { createScraperClient } from '../integrations/scraper/client.ts';
import { createWaGatewayClient } from '../integrations/wa/client.ts';
import type { AppContext } from './context.ts';

export interface Runtime {
  ctx: AppContext;
  close: () => Promise<void>;
}

export function createRuntime(config: AppConfig = loadConfig(), name = 'api'): Runtime {
  const log = pino({
    name: `aero-${name}`,
    level: config.logLevel,
    redact: { paths: ['*.apiKey', '*.password', '*.secret', 'headers["x-api-key"]'], censor: '[redigido]' },
  });
  const dbHandle = createDb(config.databaseUrl);
  const events = createEventBus(config.redisUrl);
  const queues = createQueues(redisConnection(config.redisUrl));
  const ctx: AppContext = {
    config,
    db: dbHandle.db,
    log,
    events,
    queues,
    scraper: createScraperClient(config.scraper.baseUrl, config.scraper.timeoutMs),
    wa: createWaGatewayClient({ baseUrl: config.gateway.baseUrl, apiKey: config.gateway.apiKey, timeoutMs: config.gateway.timeoutMs }),
    now: () => new Date(),
  };
  return {
    ctx,
    async close() {
      await Promise.allSettled([...Object.values(queues).map((q) => q.close()), events.close()]);
      await dbHandle.close();
    },
  };
}
