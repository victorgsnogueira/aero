import Fastify, { type FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AppContext } from './core/context.ts';
import { AppError } from './core/errors.ts';
import security from './plugins/security.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { settingsRoutes } from './modules/settings/routes.ts';
import { offersRoutes } from './modules/offers/routes.ts';
import { scansRoutes } from './modules/scans/routes.ts';
import { leadsRoutes } from './modules/leads/routes.ts';
import { whatsappRoutes } from './modules/whatsapp/routes.ts';
import { webhookRoutes } from './modules/whatsapp/webhook-routes.ts';
import { campaignsRoutes } from './modules/campaigns/routes.ts';
import { inboxRoutes } from './modules/inbox/routes.ts';
import { opportunitiesRoutes } from './modules/opportunities/routes.ts';
import { metricsRoutes } from './modules/metrics/routes.ts';
import { eventsRoutes } from './modules/events/routes.ts';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export type App = FastifyInstance;

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: ctx.config.logLevel,
            redact: { paths: ['req.headers["x-api-key"]', 'req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.secret'], censor: '[redigido]' },
          },
    trustProxy: ctx.config.env === 'production' ? ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] : false,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: 'array', useDefaults: true } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('ctx', ctx);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } });
  await app.register(cors, {
    origin: ctx.config.allowedOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-aero-request'],
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: ctx.config.media.maxBytes, files: 1, fields: 5 } });
  await app.register(security, {
    allowedOrigins: ctx.config.allowedOrigins,
    allowedHosts: ctx.config.allowedHosts,
    exemptPrefixes: ['/api/webhooks/', '/api/health'],
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'aero API', version: '0.1.0', description: 'API interna do aero (uso exclusivo do proprietário).' },
      servers: [{ url: '/' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string; code?: string };
    if (e.validation) {
      return reply.code(400).send({ error: 'validation', message: e.message, details: e.validation });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.code ?? 'request_error', message: e.message });
    }
    req.log.error({ err }, 'Erro não tratado');
    return reply.code(500).send({ error: 'internal', message: 'Erro interno' });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not_found', message: `Rota ${req.method} ${req.url} inexistente` }));

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: '/health' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(offersRoutes, { prefix: '/offers' });
      await api.register(scansRoutes, { prefix: '/scans' });
      await api.register(leadsRoutes, { prefix: '/leads' });
      await api.register(whatsappRoutes, { prefix: '/whatsapp' });
      await api.register(webhookRoutes, { prefix: '/webhooks' });
      await api.register(campaignsRoutes, { prefix: '/campaigns' });
      await api.register(inboxRoutes, { prefix: '/inbox' });
      await api.register(opportunitiesRoutes, { prefix: '/opportunities' });
      await api.register(metricsRoutes, { prefix: '/metrics' });
      await api.register(eventsRoutes, { prefix: '/events' });
    },
    { prefix: '/api' },
  );

  return app;
}
