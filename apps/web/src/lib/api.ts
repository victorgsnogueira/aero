// Cliente HTTP do frontend. Mesma origem da API (proxy do Vite / Caddy).
// O cabeçalho X-Aero-Request é exigido pela API em toda requisição que altera
// estado (proteção contra CSRF). Nenhuma credencial é guardada no navegador.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-aero-request'] = '1';
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    payload = '{}';
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', ...init });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, d.error ?? 'http_error', d.message ?? `Erro ${res.status}`, d.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', `${path}${query ? qs(query) : ''}`),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Erro inesperado';
}

export function newClientKey(): string {
  return crypto.randomUUID();
}
