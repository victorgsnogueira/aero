import { Redis } from 'ioredis';

// Notificações em tempo real (worker -> API -> navegador via SSE).
// São apenas sinais de invalidação; a interface sempre relê o estado pela API.

export const EVENTS_CHANNEL = 'aero:events';

export type LiveEvent =
  | { type: 'scan.updated'; scanId: number }
  | { type: 'conversation.updated'; conversationId: number }
  | { type: 'message.updated'; conversationId: number; messageId: number }
  | { type: 'campaign.updated'; campaignId: number }
  | { type: 'opportunity.updated'; opportunityId: number }
  | { type: 'wa.session'; status: string }
  | { type: 'validation.updated' };

export interface EventBus {
  publish(evt: LiveEvent): Promise<void>;
  subscribe(handler: (evt: LiveEvent) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export function createEventBus(redisUrl: string): EventBus {
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  const subs: Redis[] = [];
  return {
    async publish(evt) {
      try {
        if (pub.status === 'wait') await pub.connect();
        await pub.publish(EVENTS_CHANNEL, JSON.stringify(evt));
      } catch {
        // Notificação perdida não compromete dados: a interface também atualiza periodicamente.
      }
    },
    async subscribe(handler) {
      const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
      subs.push(sub);
      await sub.subscribe(EVENTS_CHANNEL);
      sub.on('message', (_ch, msg) => {
        try {
          handler(JSON.parse(msg) as LiveEvent);
        } catch {
          /* ignora mensagem malformada */
        }
      });
      return async () => {
        await sub.quit().catch(() => undefined);
      };
    },
    async close() {
      await Promise.all([pub.quit().catch(() => undefined), ...subs.map((s) => s.quit().catch(() => undefined))]);
    },
  };
}

/** Implementação nula para testes. */
export function createMemoryEventBus(): EventBus & { published: LiveEvent[] } {
  const handlers = new Set<(e: LiveEvent) => void>();
  const published: LiveEvent[] = [];
  return {
    published,
    async publish(evt) {
      published.push(evt);
      handlers.forEach((h) => h(evt));
    },
    async subscribe(handler) {
      handlers.add(handler);
      return async () => {
        handlers.delete(handler);
      };
    },
    async close() {
      handlers.clear();
    },
  };
}
