import type { FastifyPluginAsync } from 'fastify';
import type { LiveEvent } from '../../core/events.ts';

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  const clients = new Set<(evt: LiveEvent) => void>();
  let unsubscribe: (() => Promise<void>) | null = null;

  app.addHook('onReady', async () => {
    unsubscribe = await app.ctx.events.subscribe((evt) => clients.forEach((send) => send(evt)));
  });
  app.addHook('onClose', async () => {
    clients.clear();
    await unsubscribe?.();
  });

  app.get('/', { schema: { hide: true } }, async (req, reply) => {

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');
    const send = (evt: LiveEvent) => reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    clients.add(send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      clients.delete(send);
    });
  });
};
