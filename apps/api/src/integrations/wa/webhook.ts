import { createHmac, timingSafeEqual } from 'node:crypto';

// Verificação do webhook do WA-AKG: cabeçalho `X-Webhook-Signature: sha256=<hex>`
// com HMAC-SHA256 do corpo bruto usando o segredo cadastrado (lib/webhook.ts do gateway).

export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1]!, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export interface WaWebhookPayload {
  event: string;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Chave de deduplicação estável por evento. Reentregas e duplicatas
 * (o gateway pode disparar `message.sent` duas vezes) colapsam na mesma chave.
 */
export function webhookEventKey(p: WaWebhookPayload): string | null {
  const d = p.data ?? {};
  const key = (d.key ?? {}) as { id?: string };
  switch (p.event) {
    case 'message.received':
    case 'message.sent':
      return key.id ? `${p.sessionId}:${p.event}:${key.id}` : null;
    case 'message.status':
      return d.keyId ? `${p.sessionId}:status:${String(d.keyId)}:${String(d.status)}` : null;
    case 'connection.update':
      return `${p.sessionId}:conn:${String(d.status)}:${p.timestamp}`;
    default:
      return `${p.sessionId}:${p.event}:${p.timestamp}`;
  }
}
