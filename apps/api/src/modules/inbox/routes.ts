import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { CONVERSATION_STATES } from '@aero/shared';
import { campaignContacts, campaigns, conversations, messages } from '../../db/schema.ts';
import { Merge, IdParams, Nullable, Pagination, StringEnum, iso, pageArgs } from '../../lib/schemas.ts';
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { audit } from '../../core/audit.ts';
import { sendMessage, type Message } from '../messaging/sender.ts';
import { storeMedia } from '../messaging/media.ts';

const presentMessage = (m: Message) => ({
  id: m.id,
  direction: m.direction,
  origin: m.origin,
  status: m.status,
  kind: m.kind,
  body: m.body,
  media: m.media ? { kind: m.media.kind, fileName: m.media.fileName, mimeType: m.media.mimeType, size: m.media.size, available: Boolean(m.media.storageKey || m.media.gatewayUrl) } : null,
  campaignId: m.campaignId,
  purpose: m.purpose,
  error: m.error,
  scheduledFor: iso(m.scheduledFor),
  sentAt: iso(m.sentAt),
  deliveredAt: iso(m.deliveredAt),
  readAt: iso(m.readAt),
  occurredAt: iso(m.occurredAt)!,
});

export const inboxRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { ctx } = app;
  const { db } = ctx;

  async function loadConv(id: number) {
    const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!c) throw notFound('Conversa');
    return c;
  }

  app.get(
    '/conversations',
    {
      schema: {
        tags: ['inbox'],
        querystring: Merge(Pagination,
          Type.Object({ state: Type.Optional(StringEnum(CONVERSATION_STATES)), unread: Type.Optional(Type.Boolean()), q: Type.Optional(Type.String({ maxLength: 120 })), campaignId: Type.Optional(Type.Integer()) })),
      },
    },
    async (req) => {
      const { page, pageSize, offset, limit } = pageArgs(req.query);
      const parts = [sql`1=1`];
      if (req.query.state) parts.push(sql`cv.state = ${req.query.state}`);
      if (req.query.unread) parts.push(sql`cv.unread_count > 0`);
      if (req.query.campaignId) parts.push(sql`EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.phone_id = cv.phone_id AND x.campaign_id = ${req.query.campaignId})`);
      if (req.query.q) {
        const like = `%${req.query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        parts.push(sql`(cv.display_name LIKE ${like} OR p.e164 LIKE ${like} OR EXISTS (SELECT 1 FROM company_phones cpq JOIN companies cq ON cq.id = cpq.company_id WHERE cpq.phone_id = cv.phone_id AND cq.name LIKE ${like}))`);
      }
      const where = sql.join(parts, sql` AND `);
      const [rows] = await db.execute(sql`
        SELECT cv.id, cv.state, cv.automation_paused, cv.unread_count, cv.last_message_at, cv.display_name, cv.next_action, cv.next_action_due_at,
               p.e164, p.raw_sample,
               (SELECT c.name FROM company_phones cp JOIN companies c ON c.id = cp.company_id WHERE cp.phone_id = cv.phone_id ORDER BY c.id LIMIT 1) AS company_name,
               (SELECT m.body FROM messages m WHERE m.conversation_id = cv.id AND m.status <> 'cancelled' ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1) AS last_body,
               (SELECT m.direction FROM messages m WHERE m.conversation_id = cv.id AND m.status <> 'cancelled' ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1) AS last_direction,
               (SELECT cm.name FROM campaign_contacts cc JOIN campaigns cm ON cm.id = cc.campaign_id WHERE cc.id = cv.active_campaign_contact_id) AS campaign_name
        FROM conversations cv JOIN phones p ON p.id = cv.phone_id
        WHERE ${where} AND EXISTS (SELECT 1 FROM messages mx WHERE mx.conversation_id = cv.id AND mx.status <> 'scheduled' AND mx.status <> 'cancelled')
        ORDER BY cv.last_message_at DESC, cv.id DESC LIMIT ${limit} OFFSET ${offset}`);
      const [cnt] = await db.execute(sql`
        SELECT COUNT(*) AS n FROM conversations cv JOIN phones p ON p.id = cv.phone_id
        WHERE ${where} AND EXISTS (SELECT 1 FROM messages mx WHERE mx.conversation_id = cv.id AND mx.status <> 'scheduled' AND mx.status <> 'cancelled')`);
      const [unread] = await db.execute(sql`SELECT COALESCE(SUM(unread_count),0) AS n FROM conversations`);
      return {
        items: (rows as unknown as Record<string, unknown>[]).map((r) => ({
          id: Number(r.id),
          state: r.state as string,
          automationPaused: Boolean(Number(r.automation_paused)),
          unreadCount: Number(r.unread_count),
          lastMessageAt: r.last_message_at ? new Date(r.last_message_at as string).toISOString() : null,
          title: (r.company_name as string) ?? (r.display_name as string) ?? (r.e164 as string) ?? (r.raw_sample as string),
          phone: (r.e164 as string) ?? (r.raw_sample as string),
          lastBody: r.last_body ? String(r.last_body).slice(0, 140) : null,
          lastDirection: (r.last_direction as string) ?? null,
          campaignName: (r.campaign_name as string) ?? null,
          nextAction: (r.next_action as string) ?? null,
          nextActionDueAt: r.next_action_due_at ? new Date(r.next_action_due_at as string).toISOString() : null,
        })),
        total: Number((cnt as unknown as { n: string }[])[0]?.n ?? 0),
        totalUnread: Number((unread as unknown as { n: string }[])[0]?.n ?? 0),
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/conversations/:id',
    { schema: { tags: ['inbox'], params: IdParams, querystring: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })) }) } },
    async (req) => {
      const conv = await loadConv(req.params.id);
      const msgs = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), req.query.before ? lt(messages.id, req.query.before) : undefined))
        .orderBy(desc(messages.occurredAt), desc(messages.id))
        .limit(100);
      const [leadRows] = await db.execute(sql`
        SELECT c.id, c.name, c.category, c.city, c.state, c.website, c.maps_url, c.notes FROM company_phones cp JOIN companies c ON c.id = cp.company_id WHERE cp.phone_id = ${conv.phoneId} ORDER BY c.id`);
      const [phoneRows] = await db.execute(sql`SELECT id, e164, raw_sample, wa_status, wa_checked_at,
        (SELECT COUNT(*) FROM suppressions s WHERE s.phone_id = phones.id AND s.lifted_at IS NULL) AS suppressed FROM phones WHERE id = ${conv.phoneId}`);
      const participations = await db
        .select({ cc: campaignContacts, campaignName: campaigns.name, service: campaigns.service, campaignStatus: campaigns.status })
        .from(campaignContacts)
        .innerJoin(campaigns, eq(campaigns.id, campaignContacts.campaignId))
        .where(eq(campaignContacts.phoneId, conv.phoneId))
        .orderBy(desc(campaignContacts.id));
      const [oppRows] = await db.execute(sql`
        SELECT id, title, stage, service, next_action, next_action_due_at, offer_snapshot, qualification_answers FROM opportunities WHERE conversation_id = ${conv.id}
        OR company_id IN (SELECT company_id FROM company_phones WHERE phone_id = ${conv.phoneId}) ORDER BY updated_at DESC`);
      return {
        conversation: {
          ...conv,
          lastMessageAt: iso(conv.lastMessageAt),
          lastInboundAt: iso(conv.lastInboundAt),
          nextActionDueAt: iso(conv.nextActionDueAt),
          createdAt: iso(conv.createdAt),
          updatedAt: iso(conv.updatedAt),
        },
        phone: (phoneRows as unknown as Record<string, unknown>[])[0] ?? null,
        companies: leadRows,
        participations: participations.map((p) => ({
          id: p.cc.id,
          campaignId: p.cc.campaignId,
          campaignName: p.campaignName,
          campaignStatus: p.campaignStatus,
          service: p.service,
          status: p.cc.status,
          statusReason: p.cc.statusReason,
          offerSnapshot: p.cc.offerSnapshot,
          answers: p.cc.answers,
          firstSentAt: iso(p.cc.firstSentAt),
        })),
        opportunities: oppRows,
        messages: msgs.reverse().map(presentMessage),
        hasMore: msgs.length === 100,
      };
    },
  );

  app.post('/conversations/:id/read', { schema: { tags: ['inbox'], params: IdParams } }, async (req) => {
    await loadConv(req.params.id);
    await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, req.params.id));
    await ctx.events.publish({ type: 'conversation.updated', conversationId: req.params.id });
    return { ok: true };
  });

  /** Assumir: pausa a automação e cancela ações automáticas pendentes. */
  app.post('/conversations/:id/takeover', { schema: { tags: ['inbox'], params: IdParams } }, async (req) => {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(conversations).where(eq(conversations.id, req.params.id)).for('update');
      if (!c) throw notFound('Conversa');
      await tx.update(conversations).set({ automationPaused: true, state: 'human' }).where(eq(conversations.id, c.id));
      await tx
        .update(messages)
        .set({ status: 'cancelled', error: 'Cancelada: atendimento assumido' })
        .where(and(eq(messages.conversationId, c.id), eq(messages.status, 'scheduled'), eq(messages.origin, 'automatic')));
      await audit(tx, 'owner', 'conversation.takeover', 'conversation', c.id);
    });
    await ctx.events.publish({ type: 'conversation.updated', conversationId: req.params.id });
    return { ok: true };
  });

  /** Retomar automação: somente por ação explícita do proprietário. */
  app.post('/conversations/:id/resume-automation', { schema: { tags: ['inbox'], params: IdParams } }, async (req) => {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(conversations).where(eq(conversations.id, req.params.id)).for('update');
      if (!c) throw notFound('Conversa');
      if (!c.automationPaused && c.state !== 'human') throw conflict('not_paused', 'A automação não está pausada');
      await tx.update(conversations).set({ automationPaused: false, state: 'awaiting_reply' }).where(eq(conversations.id, c.id));
      await audit(tx, 'owner', 'conversation.resume_automation', 'conversation', c.id);
    });
    await ctx.events.publish({ type: 'conversation.updated', conversationId: req.params.id });
    return { ok: true };
  });

  app.patch(
    '/conversations/:id',
    {
      schema: {
        tags: ['inbox'],
        params: IdParams,
        body: Type.Partial(
          Type.Object({
            state: StringEnum(['awaiting_human', 'closed', 'awaiting_reply'] as const),
            nextAction: Nullable(Type.String({ maxLength: 255 })),
            nextActionDueAt: Nullable(Type.String({ format: 'date-time' })),
            notes: Nullable(Type.String({ maxLength: 10000 })),
          }),
        ),
      },
    },
    async (req) => {
      const c = await loadConv(req.params.id);
      const { nextActionDueAt, ...rest } = req.body;
      await db.transaction(async (tx) => {
        await tx
          .update(conversations)
          .set({ ...rest, ...(nextActionDueAt !== undefined ? { nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt) : null } : {}) })
          .where(eq(conversations.id, c.id));
        if (rest.state) await audit(tx, 'owner', 'conversation.state', 'conversation', c.id, { from: c.state, to: rest.state });
      });
      await ctx.events.publish({ type: 'conversation.updated', conversationId: c.id });
      return { ok: true };
    },
  );

  async function manualSend(conversationId: number, body: string | null, clientKey: string, media: Message['media'] = null) {
    const conv = await loadConv(conversationId);
    const res = await db
      .insert(messages)
      .ignore()
      .values({
        conversationId: conv.id,
        direction: 'out',
        origin: 'manual',
        status: 'scheduled',
        kind: media ? media.kind : 'text',
        body,
        media,
        idempotencyKey: `manual:${clientKey}`,
        scheduledFor: ctx.now(),
        occurredAt: ctx.now(),
      });
    const [msg] = await db.select().from(messages).where(eq(messages.idempotencyKey, `manual:${clientKey}`));
    if ((res[0] as { affectedRows: number }).affectedRows > 0) {
      // Envio manual implica atendimento humano nesta conversa
      await db.update(conversations).set({ automationPaused: true, state: 'human', unreadCount: 0 }).where(eq(conversations.id, conv.id));
      await audit(db, 'owner', 'message.manual', 'message', msg!.id);
      await sendMessage(ctx, msg!.id);
    }
    const [final] = await db.select().from(messages).where(eq(messages.id, msg!.id));
    return presentMessage(final!);
  }

  app.post(
    '/conversations/:id/messages',
    { schema: { tags: ['inbox'], params: IdParams, body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 4096 }), clientKey: Type.String({ pattern: '^[A-Za-z0-9-]{8,64}$' }) }) } },
    async (req) => manualSend(req.params.id, req.body.text.trim(), req.body.clientKey),
  );

  app.post('/conversations/:id/attachments', { schema: { tags: ['inbox'], params: IdParams, consumes: ['multipart/form-data'] } }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('file_required', 'Envie um arquivo');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('media_too_large', 'Arquivo excede o tamanho máximo');
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const caption = (fields.caption?.value ?? '').slice(0, 1024);
    const clientKey = fields.clientKey?.value ?? '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientKey)) throw badRequest('client_key', 'clientKey inválido');
    const media = await storeMedia(ctx, { data, mimeType: file.mimetype, fileName: file.filename });
    return manualSend(req.params.id, caption || null, clientKey, media);
  });

  // Mensagens agendadas podem ser editadas ou canceladas antes do envio.
  app.patch('/messages/:id', { schema: { tags: ['inbox'], params: IdParams, body: Type.Object({ body: Type.String({ minLength: 1, maxLength: 4096 }) }) } }, async (req) => {
    const res = await db.update(messages).set({ body: req.body.body }).where(and(eq(messages.id, req.params.id), eq(messages.status, 'scheduled')));
    if ((res[0] as { affectedRows: number }).affectedRows === 0) throw conflict('not_editable', 'Somente mensagens agendadas podem ser editadas');
    await audit(db, 'owner', 'message.edit_scheduled', 'message', req.params.id);
    return { ok: true };
  });

  app.post('/messages/:id/cancel', { schema: { tags: ['inbox'], params: IdParams } }, async (req) => {
    const res = await db
      .update(messages)
      .set({ status: 'cancelled', error: 'Cancelada pelo proprietário' })
      .where(and(eq(messages.id, req.params.id), eq(messages.status, 'scheduled')));
    if ((res[0] as { affectedRows: number }).affectedRows === 0) throw conflict('not_cancellable', 'Somente mensagens agendadas podem ser canceladas');
    await audit(db, 'owner', 'message.cancel', 'message', req.params.id);
    return { ok: true };
  });

  /**
   * Resolução manual de envio com resultado desconhecido (após conferir no celular).
   * "sent": marca como aceita sem id externo. "not_sent": marca como falha; reenvio só manual.
   */
  app.post(
    '/messages/:id/resolve-unknown',
    { schema: { tags: ['inbox'], params: IdParams, body: Type.Object({ as: StringEnum(['sent', 'not_sent'] as const) }) } },
    async (req) => {
      const res = await db
        .update(messages)
        .set(req.body.as === 'sent' ? { status: 'accepted', error: 'Confirmada manualmente pelo proprietário' } : { status: 'failed', error: 'Marcada como não enviada pelo proprietário' })
        .where(and(eq(messages.id, req.params.id), eq(messages.status, 'unknown')));
      if ((res[0] as { affectedRows: number }).affectedRows === 0) throw conflict('not_unknown', 'A mensagem não está com resultado desconhecido');
      await audit(db, 'owner', 'message.resolve_unknown', 'message', req.params.id, { as: req.body.as });
      return { ok: true };
    },
  );

  // Mídia recebida: o aero busca no gateway (apenas caminhos /media/ do próprio gateway).
  app.get('/messages/:id/media', { schema: { tags: ['inbox'], params: IdParams } }, async (req, reply) => {
    const [m] = await db.select().from(messages).where(eq(messages.id, req.params.id));
    if (!m?.media) throw notFound('Mídia');
    if (m.media.storageKey) {
      const { readMedia } = await import('../messaging/media.ts');
      const file = await readMedia(ctx, m.media);
      return reply.header('content-type', file.mimeType).header('content-disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`).send(file.data);
    }
    const url = m.media.gatewayUrl ?? '';
    let path: string;
    try {
      path = new URL(url, 'http://gateway.invalid').pathname;
    } catch {
      throw notFound('Mídia');
    }
    if (!/^\/(api\/)?media\/[A-Za-z0-9._-]+$/.test(path)) throw badRequest('invalid_media_path', 'Caminho de mídia não permitido');
    const res = await fetch(`${ctx.config.gateway.baseUrl.replace(/\/$/, '')}${path}`, {
      headers: { 'x-api-key': ctx.config.gateway.apiKey },
      signal: AbortSignal.timeout(ctx.config.gateway.timeoutMs),
      redirect: 'error',
    });
    if (!res.ok) throw notFound('Mídia');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > ctx.config.media.maxBytes * 2) throw badRequest('media_too_large', 'Mídia grande demais');
    return reply.header('content-type', res.headers.get('content-type') ?? 'application/octet-stream').header('cache-control', 'private, max-age=300').send(buf);
  });
};
