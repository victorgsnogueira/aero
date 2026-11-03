import type { Logger } from 'pino';
import type { AppConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { EventBus } from './events.ts';
import type { Queues } from './queues.ts';
import type { ScraperClient } from '../integrations/scraper/client.ts';
import type { WaGatewayClient } from '../integrations/wa/client.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  log: Logger;
  events: EventBus;

  queues: Queues | null;
  scraper: ScraperClient;
  wa: WaGatewayClient;
  now: () => Date;
}
