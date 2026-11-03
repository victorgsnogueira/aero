import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { conversations, phones, suppressions } from '../../db/schema.ts';
import type { AppContext } from '../../core/context.ts';
import { audit } from '../../core/audit.ts';
import { notFound, precondition } from '../../core/errors.ts';
import { ensureSessionRow, getSessionKey } from '../whatsapp/session.ts';

export type Conversation = typeof conversations.$inferSelect;

export async function ensureConversation(
  db: DbOrTx,
  input: { sessionId: number; phoneId: number; jid: string; displayName?: string | null; lid?: string | null },
): Promise<Conversation> {
  await db
    .insert(conversations)
    .values({ sessionId: input.sessionId, phoneId: input.phoneId, jid: input.jid, displayName: input.displayName ?? null, lid: input.lid ?? null })
    .onDuplicateKeyUpdate({
      set: {
        displayName: input.displayName ? sql`COALESCE(${conversations.displayName}, ${input.displayName})` : sql`${conversations.displayName}`,
        lid: input.lid ? input.lid : sql`${conversations.lid}`,
      },
    });
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.sessionId, input.sessionId), eq(conversations.phoneId, input.phoneId)));
  return row!;
}

export async function lockConversation(db: DbOrTx, id: number): Promise<Conversation | null> {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).for('update');
  return row ?? null;
}

export async function openManualConversation(ctx: AppContext, phoneId: number): Promise<{ id: number }> {
  return ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for('update');
    if (!phone) throw notFound('Telefone');
    if (phone.formatStatus !== 'valid' || phone.waStatus !== 'found' || !phone.waJid) {
      throw precondition('phone_not_validated', 'Valide o WhatsApp do telefone antes de abrir a conversa');
    }
    const [suppression] = await tx.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.phoneId, phoneId), isNull(suppressions.liftedAt)));
    if (suppression) throw precondition('suppressed', 'Telefone bloqueado para contato');
    const session = await ensureSessionRow(tx, getSessionKey(ctx));
    const conversation = await ensureConversation(tx, { sessionId: session.id, phoneId, jid: phone.waJid });
    await audit(tx, 'owner', 'conversation.open', 'conversation', conversation.id);
    return { id: conversation.id };
  });
}
