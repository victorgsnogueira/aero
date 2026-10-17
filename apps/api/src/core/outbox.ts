import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { DbOrTx, Db } from '../db/client.ts';
import { outbox } from '../db/schema.ts';
import { TOPICS, type Queues, type Topic } from './queues.ts';

// Outbox transacional: a intenção de executar uma tarefa é gravada na mesma
// transação da mudança de negócio. Um relay publica na fila depois. Assim uma
// queda entre o COMMIT e o enfileiramento não perde operações.

export async function enqueue(
  tx: DbOrTx,
  topic: Topic,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; availableAt?: Date } = {},
): Promise<void> {
  const values = {
    topic,
    payload,
    dedupeKey: opts.dedupeKey ?? null,
    availableAt: opts.availableAt ?? new Date(),
  };
  if (opts.dedupeKey) {
    // Mesma chave pendente: não duplica a intenção.
    await tx.insert(outbox).values(values).onDuplicateKeyUpdate({ set: { dedupeKey: sql`dedupe_key` } });
  } else {
    await tx.insert(outbox).values(values);
  }
}

const queueKeyByName = (queues: Queues, name: string) => Object.values(queues).find((q) => q.name === name);

/** Publica intenções pendentes na fila. Idempotente: jobId = id do outbox. */
export async function relayOutbox(db: Db, queues: Queues, limit = 100): Promise<number> {
  const rows = await db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.publishedAt), lte(outbox.availableAt, new Date())))
    .orderBy(asc(outbox.id))
    .limit(limit);
  let published = 0;
  for (const row of rows) {
    const queueName = TOPICS[row.topic as Topic];
    const queue = queueName ? queueKeyByName(queues, queueName) : undefined;
    try {
      if (!queue) throw new Error(`Tópico sem fila: ${row.topic}`);
      await queue.add(row.topic, row.payload as Record<string, unknown>, { jobId: `outbox-${row.id}` });
      // Libera a chave de deduplicação para futuras intenções do mesmo tipo
      await db.update(outbox).set({ publishedAt: new Date(), dedupeKey: null }).where(eq(outbox.id, row.id));
      published++;
    } catch (err) {
      await db
        .update(outbox)
        .set({ attempts: sql`${outbox.attempts} + 1`, lastError: (err as Error).message.slice(0, 500) })
        .where(eq(outbox.id, row.id));
    }
  }
  return published;
}
