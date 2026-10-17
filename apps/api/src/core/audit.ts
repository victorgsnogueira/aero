import type { DbOrTx } from '../db/client.ts';
import { auditLog } from '../db/schema.ts';

export type Actor = 'owner' | 'system' | 'contact';

/** Auditoria das ações comerciais relevantes. Não registra conteúdo de mensagens nem segredos. */
export async function audit(
  tx: DbOrTx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: number | string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({ actor, action, entity, entityId: entityId === null ? null : String(entityId), data: data ?? null });
}
