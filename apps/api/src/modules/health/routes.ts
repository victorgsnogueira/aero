import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/live', { schema: { tags: ['health'] } }, async () => ({ status: 'ok' }));

  app.get(
    '/ready',
    { schema: { tags: ['health'], response: { 200: Type.Object({ status: Type.String() }), 503: Type.Object({ status: Type.String(), detail: Type.String() }) } } },
    async (_req, reply) => {
      try {
        await app.ctx.db.execute(sql`SELECT 1`);
        return { status: 'ready' };
      } catch (err) {
        return reply.code(503).send({ status: 'not_ready', detail: (err as Error).message.slice(0, 200) });
      }
    },
  );
};
