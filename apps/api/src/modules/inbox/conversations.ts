import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { conversations } from '../../db/schema.ts';

export type Conversation = typeof conversations.$inferSelect;

/** Uma conversa por telefone e sessão, compartilhada por todas as campanhas. */
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
