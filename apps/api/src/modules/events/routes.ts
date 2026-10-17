import type { FastifyPluginAsync } from 'fastify';

// Server-Sent Events: sinais de atualização para a interface (TanStack Query
// invalida as consultas afetadas). Sem dados sensíveis no fluxo — apenas IDs.
export const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { schema: { hide: true } }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');
    const unsubscribe = await app.ctx.events.subscribe((evt) => {
      reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      void unsubscribe();
    });
    return reply;
  });
};
