import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';

function commercialContext(phoneId: SQL, conversationId: SQL): SQL {
  return sql`(
    EXISTS (SELECT 1 FROM company_phones cp_scope WHERE cp_scope.phone_id = ${phoneId})
    OR EXISTS (SELECT 1 FROM campaign_contacts cc_scope WHERE cc_scope.phone_id = ${phoneId})
    OR EXISTS (SELECT 1 FROM opportunities op_scope WHERE op_scope.conversation_id = ${conversationId})
    OR EXISTS (SELECT 1 FROM audit_log al_scope WHERE al_scope.entity = 'conversation'
      AND al_scope.entity_id = CAST(${conversationId} AS BINARY) AND al_scope.actor = 'owner' AND al_scope.action = 'conversation.open')
    OR EXISTS (SELECT 1 FROM messages msg_scope WHERE msg_scope.conversation_id = ${conversationId}
      AND msg_scope.origin IN ('manual', 'automatic'))
  )`;
}

export function commercialConversationScope(alias: SQL = sql`cv`): SQL {
  return commercialContext(sql`${alias}.phone_id`, sql`${alias}.id`);
}

export async function hasCommercialContext(db: DbOrTx, phoneId: number, sessionId: number): Promise<boolean> {
  const [rows] = await db.execute(sql`
    SELECT p.id FROM phones p
    LEFT JOIN conversations cv ON cv.phone_id = p.id AND cv.session_id = ${sessionId}
    WHERE p.id = ${phoneId} AND ${commercialContext(sql`p.id`, sql`cv.id`)} LIMIT 1`);
  return (rows as unknown as { id: number }[]).length > 0;
}
