export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  responseType?: 'json' | 'text' | 'binary';
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(code: string, message: string, status = 0, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AeroApi {
  request(path: string, options?: ApiRequest): Promise<unknown>;
}

/** Fixed operator-configured destination; tool arguments can never select a host or arbitrary route. */
export function createApi(options: { baseUrl?: string; readOnly?: boolean; timeoutMs?: number; fetch?: typeof fetch } = {}): AeroApi {
  const base = new URL(options.baseUrl ?? 'http://127.0.0.1:8080');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || !['', '/', '/api', '/api/'].includes(base.pathname)) {
    throw new Error('AERO_MCP_API_URL deve apontar para http://127.0.0.1:<porta> (ou localhost/[::1]), sem credenciais, query ou caminho além de /api. Para VPS, use um túnel local.');
  }
  const fetcher = options.fetch ?? fetch;
  return {
    async request(path, request = {}) {
      if (!/^\/[a-z][a-z0-9/.-]*$/.test(path) || path.includes('..')) throw new Error('Rota interna inválida');
      const method = request.method ?? 'GET';
      const preview = method === 'POST' && /^\/campaigns\/[1-9]\d*\/preview$/.test(path);
      if (options.readOnly && method !== 'GET' && !preview) throw new ApiError('read_only', 'O MCP está em modo somente leitura.');
      const url = new URL(`/api${path}`, base);
      for (const [key, value] of Object.entries(request.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
      const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
      let response: Response;
      let data: unknown;
      try {
        const multipart = request.body instanceof FormData;
        response = await fetcher(url, {
          method, signal, redirect: 'error',
          headers: { accept: request.responseType === 'binary' ? '*/*' : request.responseType === 'text' ? 'text/csv' : 'application/json', 'x-aero-request': '1', ...(request.body !== undefined && !multipart ? { 'content-type': 'application/json' } : {}) },
          ...(request.body !== undefined ? { body: multipart ? request.body as FormData : JSON.stringify(request.body) } : {}),
        });
        if (!response.ok || !request.responseType || request.responseType === 'json') data = await response.json();
        else if (request.responseType === 'text') data = await response.text();
        else data = { mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream', data: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        throw new ApiError('api_unavailable', method === 'GET'
          ? 'Não foi possível consultar a API local. Verifique o aero e AERO_MCP_API_URL.'
          : 'Não foi possível obter a resposta da API. A operação pode ter sido aplicada: consulte o estado antes de tentar novamente. Não repita a escrita automaticamente.');
      }
      if (!response.ok) {
        const error = data as { error?: string; message?: string; details?: unknown } | null;
        throw new ApiError(error?.error ?? 'api_error', error?.message ?? `A API respondeu HTTP ${response.status}.`, response.status, error?.details);
      }
      return data;
    },
  };
}
