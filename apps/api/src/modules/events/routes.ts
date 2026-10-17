import type { FastifyPluginAsync } from 'fastify';
import type { LiveEvent } from '../../core/events.ts';

// Server-Sent Events: sinais de atualização para a interface (TanStack Query
// invalida as consultas afetadas). Sem dados sensíveis no fluxo — apenas IDs.
// Uma única assinatura Redis é compartilhada por todos os clientes conectados.
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
    // A resposta passa a ser escrita diretamente no socket (fluxo contínuo).
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
