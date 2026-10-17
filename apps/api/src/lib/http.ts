// Cliente HTTP mínimo para integrações internas, com timeout e classificação
// de falhas. Distingue "não chegou ao destino" de "resultado desconhecido".

export type HttpFailureKind =
  | 'connect' // não conectou: a requisição certamente não foi processada
  | 'timeout' // tempo esgotado: o destino PODE ter processado
  | 'http' // resposta com status de erro
  | 'parse'; // resposta inválida

export class HttpError extends Error {
  readonly kind: HttpFailureKind;
  readonly status: number | null;
  readonly body: unknown;
  constructor(kind: HttpFailureKind, message: string, status: number | null = null, body: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
  /** Verdadeiro quando não há como saber se o destino executou a operação. */
  get outcomeUnknown(): boolean {
    return this.kind === 'timeout' || (this.kind === 'http' && (this.status ?? 0) >= 500) || this.kind === 'parse';
  }
}

const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

export async function requestJson<T>(
  url: string,
  init: RequestInit & { timeoutMs: number; expectText?: boolean },
): Promise<T> {
  const { timeoutMs, expectText, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError('timeout', `Tempo esgotado após ${timeoutMs}ms`);
    const code = e.cause?.code;
    if (code && CONNECT_CODES.has(code)) throw new HttpError('connect', `Falha de conexão (${code})`);
    // Erros de socket após o envio (ECONNRESET etc.) têm resultado incerto
    throw new HttpError('timeout', `Falha de rede: ${code ?? e.message}`);
  }
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  if (!expectText && text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (res.ok) throw new HttpError('parse', 'Resposta não é JSON válido', res.status, text.slice(0, 500));
    }
  }
  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : text.slice(0, 200);
    throw new HttpError('http', `HTTP ${res.status}: ${msg}`, res.status, body);
  }
  return body as T;
}
