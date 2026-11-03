import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { WA_SESSION_STATUSES } from '@aero/shared';
import { Nullable, StringEnum, iso } from '../../lib/schemas.ts';
import { getSessionKey, provisionSession, syncSessionStatus } from './session.ts';
import { audit } from '../../core/audit.ts';
import { badRequest } from '../../core/errors.ts';

const SessionSchema = Type.Object({
  sessionKey: Type.String(),
  status: StringEnum(WA_SESSION_STATUSES),
  ownJid: Nullable(Type.String()),
  webhookRegisteredAt: Nullable(Type.String()),
  lastError: Nullable(Type.String()),
  checkedAt: Type.String(),
});

export const whatsappRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { ctx } = app;

  const present = (row: Awaited<ReturnType<typeof syncSessionStatus>>) => ({
    sessionKey: row.sessionKey,
    status: row.status,
    ownJid: row.ownJid,
    webhookRegisteredAt: iso(row.webhookRegisteredAt),
    lastError: row.lastError,
    checkedAt: ctx.now().toISOString(),
  });

  app.get('/session', { schema: { tags: ['whatsapp'], response: { 200: SessionSchema } } }, async () => present(await syncSessionStatus(ctx)));

  app.post('/session/provision', { schema: { tags: ['whatsapp'], response: { 200: SessionSchema } } }, async () => {
    const row = await provisionSession(ctx);
    await audit(ctx.db, 'owner', 'wa.provision', 'wa_session', row.id);
    return present(row);
  });

  app.get(
    '/session/qr',
    { schema: { tags: ['whatsapp'], response: { 200: Type.Object({ image: Nullable(Type.String()), reason: Nullable(Type.String()) }) } } },
    async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      const qr = await ctx.wa.getQr(getSessionKey(ctx));

      return { image: qr.image, reason: qr.reason };
    },
  );

  app.post(
    '/session/:action',
    { schema: { tags: ['whatsapp'], params: Type.Object({ action: StringEnum(['start', 'stop', 'restart', 'logout'] as const) }),
        body: Type.Optional(Type.Object({ confirm: Type.Optional(Type.Boolean()) })),
        response: { 200: SessionSchema } } },
    async (req) => {
      if (req.params.action === 'logout' && req.body?.confirm !== true) {
        throw badRequest('confirmation_required', 'Desconectar exige confirmação: um novo pareamento será necessário');
      }
      await ctx.wa.sessionAction(getSessionKey(ctx), req.params.action);
      await audit(ctx.db, 'owner', `wa.${req.params.action}`, 'wa_session', getSessionKey(ctx));
      return present(await syncSessionStatus(ctx));
    },
  );

  app.get('/diagnostics', { schema: { tags: ['whatsapp'] } }, async () => {
    const [scraper, gateway] = await Promise.all([ctx.scraper.ping(), ctx.wa.ping()]);
    let webhook: { ok: boolean; detail: string } = { ok: false, detail: 'Não verificado' };
    if (gateway.ok) {
      try {
        const hooks = await ctx.wa.listWebhooks(getSessionKey(ctx));
        const mine = hooks.find((h) => h.url === ctx.config.gateway.webhookUrl);
        webhook = mine
          ? { ok: mine.isActive, detail: `Registrado (${mine.events.join(', ')})` }
          : { ok: false, detail: 'Webhook do aero não registrado: use "Preparar sessão"' };
      } catch (err) {
        webhook = { ok: false, detail: (err as Error).message };
      }
    }
    return {
      scraper,
      gateway,
      webhook,
      sending: {
        enabled: ctx.config.sending.enabled,
        allowlist: ctx.config.sending.allowlist.length,
        detail: ctx.config.sending.enabled
          ? ctx.config.sending.allowlist.length
            ? `Envio habilitado SOMENTE para ${ctx.config.sending.allowlist.length} número(s) da lista de teste`
            : 'Envio habilitado'
          : 'Envio desabilitado (SENDING_ENABLED=false)',
      },
    };
  });
};
