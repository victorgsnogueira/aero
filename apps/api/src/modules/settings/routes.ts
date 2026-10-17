import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getSettings, missingOutreachSettings, updateSettings, type OperatorSettings } from './service.ts';
import { Nullable, iso } from '../../lib/schemas.ts';
import { isValidTimezone } from '../../lib/schedule.ts';
import { badRequest } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';

const SettingsSchema = Type.Object({
  senderName: Nullable(Type.String()),
  companyName: Nullable(Type.String()),
  introduction: Nullable(Type.String()),
  defaultTimezone: Type.String(),
  defaultCountry: Type.String(),
  sendMinIntervalSeconds: Type.Integer(),
  sendDailyLimit: Type.Integer(),
  sendHourlyLimit: Type.Integer(),
  validationRevalidateDays: Type.Integer(),
  validationBatchSize: Type.Integer(),
  validationMinIntervalMs: Type.Integer(),
  scanDefaultDepth: Type.Integer(),
  scanUnitMaxSeconds: Type.Integer(),
  missingForOutreach: Type.Array(Type.String()),
  sendingEnabled: Type.Boolean({ description: 'Interruptor global SENDING_ENABLED (ambiente)' }),
  sendAllowlistActive: Type.Boolean(),
  updatedAt: Nullable(Type.String()),
});

const SettingsPatch = Type.Partial(
  Type.Object({
    senderName: Nullable(Type.String({ maxLength: 120 })),
    companyName: Nullable(Type.String({ maxLength: 160 })),
    introduction: Nullable(Type.String({ maxLength: 2000 })),
    defaultTimezone: Type.String({ maxLength: 64 }),
    defaultCountry: Type.String({ pattern: '^[A-Z]{2}$' }),
    sendMinIntervalSeconds: Type.Integer({ minimum: 30, maximum: 3600 }),
    sendDailyLimit: Type.Integer({ minimum: 1, maximum: 500 }),
    sendHourlyLimit: Type.Integer({ minimum: 1, maximum: 100 }),
    validationRevalidateDays: Type.Integer({ minimum: 1, maximum: 365 }),
    validationBatchSize: Type.Integer({ minimum: 1, maximum: 50 }),
    validationMinIntervalMs: Type.Integer({ minimum: 1000, maximum: 60000 }),
    scanDefaultDepth: Type.Integer({ minimum: 1, maximum: 100 }),
    scanUnitMaxSeconds: Type.Integer({ minimum: 180, maximum: 3600 }),
  }),
);

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const present = (s: OperatorSettings) => ({
    ...s,
    missingForOutreach: missingOutreachSettings(s),
    sendingEnabled: app.ctx.config.sending.enabled,
    sendAllowlistActive: app.ctx.config.sending.allowlist.length > 0,
    updatedAt: iso(s.updatedAt),
  });

  app.get('/', { schema: { tags: ['settings'], response: { 200: SettingsSchema } } }, async () => present(await getSettings(app.ctx.db)));

  app.patch('/', { schema: { tags: ['settings'], body: SettingsPatch, response: { 200: SettingsSchema } } }, async (req) => {
    if (req.body.defaultTimezone && !isValidTimezone(req.body.defaultTimezone)) throw badRequest('invalid_timezone', 'Fuso horário inválido');
    const updated = await app.ctx.db.transaction(async (tx) => {
      const s = await updateSettings(tx, req.body);
      await audit(tx, 'owner', 'settings.update', 'settings', 1, { fields: Object.keys(req.body) });
      return s;
    });
    return present(updated);
  });
};
