import { HttpError, requestJson } from '../../lib/http.ts';
import type { WaSessionStatus } from '@aero/shared';

// Adaptador do WA-AKG v1.6.3 (commit 627a69f). Contratos verificados no código-fonte:
//   Autenticação: cabeçalho X-API-Key.
//   Respostas: { status: boolean, message, data }.
//   GET  /api/sessions/{id}            -> data.status (status ao vivo: CONNECTED, SCAN_QR, ...), data.me
//   POST /api/sessions                 {name, sessionId}
//   GET  /api/sessions/{id}/qr         -> data.{qr, base64}; 400 se já conectado; 404 se ainda sem QR
//   POST /api/sessions/{id}/{action}   start|stop|restart|logout
//   POST /api/chat/{id}/check          {numbers[] (<=50)} -> data.results[{number, exists, jid, error?}]
//                                      ATENÇÃO: em erro o gateway devolve exists:false + error -> tratamos como inconclusivo.
//   POST /api/messages/{id}/{jid}/send {message: <conteúdo Baileys>} -> data = WAMessage {key:{id,remoteJid,fromMe}}
//   POST /api/messages/{id}/{jid}/media multipart: file, type(image|video|audio|document), caption
//   GET  /api/chat/{id}/{jid}          -> data: últimas 100 mensagens do banco do gateway
//   GET/POST/PUT /api/webhooks/{id}[/{webhookId}]  {name, url, secret, events[]}
//   POST /api/sessions/{id}/bot-config  configurações do bot embutido (desativado pelo aero)

export interface GatewaySessionInfo {
  status: WaSessionStatus;
  rawStatus: string | null;
  ownJid: string | null;
  exists: boolean;
}

export interface CheckResult {
  number: string;
  outcome: 'found' | 'not_found' | 'inconclusive';
  jid: string | null;
  error: string | null;
}

export interface SendResult {
  externalId: string;
  remoteJid: string | null;
}

export interface GatewayMessage {
  keyId: string;
  remoteJid: string;
  fromMe: boolean;
  content: string | null;
  status: string;
  timestamp: string;
}

export interface GatewayWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
}

export interface WaGatewayClient {
  getSession(sessionId: string): Promise<GatewaySessionInfo>;
  createSession(sessionId: string, name: string): Promise<void>;
  getQr(sessionId: string): Promise<{ qr: string | null; image: string | null; reason: string | null }>;
  sessionAction(sessionId: string, action: 'start' | 'stop' | 'restart' | 'logout'): Promise<void>;
  disableBuiltInBot(sessionId: string): Promise<void>;
  checkNumbers(sessionId: string, numbers: string[]): Promise<CheckResult[]>;
  sendText(sessionId: string, jid: string, text: string): Promise<SendResult>;
  sendMedia(sessionId: string, jid: string, file: { data: Buffer; mimeType: string; fileName: string; kind: string }, caption: string): Promise<SendResult>;
  getChatMessages(sessionId: string, jid: string): Promise<GatewayMessage[]>;
  listWebhooks(sessionId: string): Promise<GatewayWebhook[]>;
  upsertWebhook(sessionId: string, input: { url: string; secret: string; events: string[] }): Promise<void>;
  ping(): Promise<{ ok: boolean; detail: string }>;
}

interface Envelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

export const WEBHOOK_EVENTS = ['message.received', 'message.sent', 'message.status', 'connection.update'];
const WEBHOOK_NAME = 'aero';

export function mapSessionStatus(raw: string | null | undefined): WaSessionStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'CONNECTED':
      return 'connected';
    case 'CONNECTING':
      return 'connecting';
    case 'SCAN_QR':
      return 'scan_qr';
    case 'DISCONNECTED':
      return 'disconnected';
    case 'STOPPED':
      return 'stopped';
    case 'LOGGED_OUT':
      return 'logged_out';
    default:
      return 'unknown';
  }
}

export function createWaGatewayClient(opts: { baseUrl: string; apiKey: string; timeoutMs: number }): WaGatewayClient {
  const base = opts.baseUrl.replace(/\/$/, '');
  const headers = () => ({ 'x-api-key': opts.apiKey });
  const sid = (s: string) => encodeURIComponent(s);

  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = opts.timeoutMs): Promise<T> {
    if (!opts.apiKey) throw new HttpError('connect', 'WA_GATEWAY_API_KEY não configurada');
    const res = await requestJson<Envelope<T>>(`${base}/api${path}`, {
      method,
      headers: body === undefined ? headers() : { ...headers(), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    });
    if (res && typeof res === 'object' && 'status' in res && res.status === false) {
      throw new HttpError('http', res.message ?? 'Gateway recusou a operação', 400, res);
    }
    // Algumas rotas (ex.: /sessions/{id}/qr) respondem sem envelope { status, data }.
    if (res && typeof res === 'object' && 'data' in res) return (res as Envelope<T>).data;
    return res as unknown as T;
  }

  function toSendResult(data: unknown): SendResult {
    const d = data as { key?: { id?: string; remoteJid?: string }; id?: string } | null;
    const externalId = d?.key?.id ?? d?.id;
    if (!externalId) throw new HttpError('parse', 'Gateway aceitou o envio sem identificador de mensagem', 200, data);
    return { externalId, remoteJid: d?.key?.remoteJid ?? null };
  }

  return {
    async getSession(sessionId) {
      try {
        const data = await call<{ status?: string; me?: { id?: string } | null }>('GET', `/sessions/${sid(sessionId)}`);
        return { status: mapSessionStatus(data.status), rawStatus: data.status ?? null, ownJid: data.me?.id ?? null, exists: true };
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return { status: 'not_created', rawStatus: null, ownJid: null, exists: false };
        if (err instanceof HttpError && (err.kind === 'connect' || err.kind === 'timeout'))
          return { status: 'gateway_unreachable', rawStatus: null, ownJid: null, exists: false };
        throw err;
      }
    },
    async createSession(sessionId, name) {
      await call('POST', '/sessions', { name, sessionId });
    },
    async getQr(sessionId) {
      try {
        const data = await call<{ qr?: string; base64?: string }>('GET', `/sessions/${sid(sessionId)}/qr`);
        return { qr: data.qr ?? null, image: data.base64 ?? null, reason: null };
      } catch (err) {
        if (err instanceof HttpError && err.status === 400) return { qr: null, image: null, reason: 'already_connected' };
        if (err instanceof HttpError && err.status === 404) return { qr: null, image: null, reason: 'not_available_yet' };
        throw err;
      }
    },
    async sessionAction(sessionId, action) {
      await call('POST', `/sessions/${sid(sessionId)}/${action}`);
    },
    async disableBuiltInBot(sessionId) {
      await call('POST', `/sessions/${sid(sessionId)}/bot-config`, { enabled: false, autoRead: false, alwaysOnline: false, welcomeMessage: null });
    },
    async checkNumbers(sessionId, numbers) {
      if (numbers.length === 0) return [];
      if (numbers.length > 50) throw new Error('Máximo de 50 números por consulta');
      const data = await call<{ results: { number: string; exists?: boolean; jid?: string | null; error?: string }[] }>(
        'POST',
        `/chat/${sid(sessionId)}/check`,
        { numbers },
      );
      const byNumber = new Map(data.results.map((r) => [r.number, r]));
      return numbers.map((n) => {
        const r = byNumber.get(n);
        if (!r) return { number: n, outcome: 'inconclusive' as const, jid: null, error: 'Sem resultado do gateway' };
        if (r.error) return { number: n, outcome: 'inconclusive' as const, jid: null, error: r.error };
        if (r.exists === true) return { number: n, outcome: 'found' as const, jid: r.jid ?? null, error: null };
        if (r.exists === false) return { number: n, outcome: 'not_found' as const, jid: null, error: null };
        return { number: n, outcome: 'inconclusive' as const, jid: null, error: 'Resposta sem campo exists' };
      });
    },
    async sendText(sessionId, jid, text) {
      const data = await call<unknown>('POST', `/messages/${sid(sessionId)}/${encodeURIComponent(jid)}/send`, { message: { text } });
      return toSendResult(data);
    },
    async sendMedia(sessionId, jid, file, caption) {
      if (!opts.apiKey) throw new HttpError('connect', 'WA_GATEWAY_API_KEY não configurada');
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
      form.set('type', file.kind);
      form.set('caption', caption);
      const res = await requestJson<Envelope<unknown>>(`${base}/api/messages/${sid(sessionId)}/${encodeURIComponent(jid)}/media`, {
        method: 'POST',
        headers: headers(),
        body: form,
        timeoutMs: opts.timeoutMs * 3,
      });
      if (res.status === false) throw new HttpError('http', res.message ?? 'Gateway recusou a mídia', 400, res);
      return toSendResult(res.data);
    },
    async getChatMessages(sessionId, jid) {
      const data = await call<{ keyId: string; remoteJid: string; fromMe: boolean; content: string | null; status: string; timestamp: string }[]>(
        'GET',
        `/chat/${sid(sessionId)}/${encodeURIComponent(jid)}`,
      );
      return (data ?? []).map((m) => ({ keyId: m.keyId, remoteJid: m.remoteJid, fromMe: m.fromMe, content: m.content, status: m.status, timestamp: m.timestamp }));
    },
    async listWebhooks(sessionId) {
      const data = await call<{ id: string; url: string; events: string[]; isActive: boolean; name?: string }[]>('GET', `/webhooks/${sid(sessionId)}`);
      return (data ?? []).map((w) => ({ id: w.id, url: w.url, events: w.events, isActive: w.isActive }));
    },
    async upsertWebhook(sessionId, input) {
      const existing = (await call<{ id: string; name?: string; url: string }[]>('GET', `/webhooks/${sid(sessionId)}`)) ?? [];
      const mine = existing.find((w) => w.name === WEBHOOK_NAME || w.url === input.url);
      const body = { name: WEBHOOK_NAME, url: input.url, secret: input.secret, events: input.events, isActive: true };
      if (mine) await call('PUT', `/webhooks/${sid(sessionId)}/${encodeURIComponent(mine.id)}`, body);
      else await call('POST', `/webhooks/${sid(sessionId)}`, body);
    },
    async ping() {
      if (!opts.apiKey) return { ok: false, detail: 'WA_GATEWAY_API_KEY não configurada' };
      try {
        await call('GET', '/sessions', undefined, 5000);
        return { ok: true, detail: 'Gateway respondeu com autenticação válida' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  };
}
