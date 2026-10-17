import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { operatorSettings } from '../../db/schema.ts';
import { precondition } from '../../core/errors.ts';

export type OperatorSettings = typeof operatorSettings.$inferSelect;

export async function getSettings(db: DbOrTx): Promise<OperatorSettings> {
  const [row] = await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1));
  if (row) return row;
  await db.insert(operatorSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const [created] = await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1));
  return created!;
}

export async function updateSettings(db: DbOrTx, patch: Partial<Omit<OperatorSettings, 'id' | 'updatedAt'>>): Promise<OperatorSettings> {
  await getSettings(db);
  await db.update(operatorSettings).set(patch).where(eq(operatorSettings.id, 1));
  return getSettings(db);
}

/** Configurações obrigatórias para qualquer abordagem comercial. */
export function missingOutreachSettings(s: OperatorSettings): string[] {
  const missing: string[] = [];
  if (!s.senderName?.trim()) missing.push('Nome do remetente');
  if (!s.companyName?.trim()) missing.push('Nome da empresa');
  return missing;
}

export function assertOutreachReady(s: OperatorSettings): void {
  const missing = missingOutreachSettings(s);
  if (missing.length) {
    throw precondition('settings_incomplete', `Configure antes de enviar: ${missing.join(', ')}`, { missing });
  }
}
