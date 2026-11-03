import type { FastifyPluginAsync } from 'fastify';
import { webhookEvents } from '../../db/schema.ts';
import { verifyWebhookSignature, webhookEventKey, type WaWebhookPayload } from '../../integrations/wa/webhook.ts';
import { enqueue } from '../../core/outbox.ts';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.post('/wa', { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req, reply) => {
    const { ctx } = app;
    const signature = req.headers['x-webhook-signature'];
    if (!verifyWebhookSignature(req.rawBody ?? Buffer.alloc(0), typeof signature === 'string' ? signature : undefined, ctx.config.gateway.webhookSecret)) {
      req.log.warn('Webhook com assinatura inválida');
      return reply.code(401).send({ error: 'invalid_signature', message: 'Assinatura inválida' });
    }
    const payload = req.body as WaWebhookPayload;
    if (!payload || typeof payload.event !== 'string' || payload.sessionId !== ctx.config.gateway.sessionId) {
      return reply.code(202).send({ ignored: true });
    }
    if (payload.event === 'test') return { ok: true };
    const key = webhookEventKey(payload);
    if (!key) return reply.code(202).send({ ignored: true, reason: 'sem chave' });

    const accepted = await ctx.db.transaction(async (tx) => {
      const res = await tx
        .insert(webhookEvents)
        .ignore()
        .values({ source: 'wa-akg', eventKey: key.slice(0, 191), event: payload.event, payload: payload as unknown as Record<string, unknown> });
      const inserted = (res[0] as { affectedRows: number }).affectedRows > 0;
      if (inserted) {
        const id = (res[0] as { insertId: number }).insertId;

        const delayMs = payload.event === 'message.sent' ? 5_000 : 0;
        await enqueue(tx, 'inbound.process', { webhookEventId: id }, { availableAt: new Date(Date.now() + delayMs) });
      }
      return inserted;
    });
    req.log.debug({ event: payload.event, duplicate: !accepted }, 'Webhook recebido');
    return { ok: true, duplicate: !accepted };
  });
};
