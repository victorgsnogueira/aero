// Configuração de infraestrutura lida do ambiente. Configurações comerciais
// (nome, empresa, mensagens, horários, limites de envio) ficam no banco e são
// editadas pela interface — ver módulo `settings`.

function str(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido em ${name}`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  /** Origens de navegador autorizadas a chamar a API (ex.: http://localhost:5173). */
  allowedOrigins: string[];
  /** Valores aceitos no cabeçalho Host (proteção contra DNS rebinding). */
  allowedHosts: string[];
  scraper: { baseUrl: string; timeoutMs: number };
  gateway: {
    baseUrl: string;
    apiKey: string;
    sessionId: string;
    webhookSecret: string;
    /** URL que o gateway usa para chamar o aero pela rede interna do Docker. */
    webhookUrl: string;
    timeoutMs: number;
  };
  sending: {
    /** Interruptor global: sem ele nenhum envio sai para o gateway. */
    enabled: boolean;
    /** Se preenchida, somente estes números (E.164) podem receber mensagens. */
    allowlist: string[];
  };
  media: { dir: string; maxBytes: number };
  staticDir: string | null;
}

export function loadConfig(): AppConfig {
  const env = str('NODE_ENV', 'development') as AppConfig['env'];
  return {
    env,
    host: str('API_HOST', '127.0.0.1'),
    port: int('API_PORT', 3100),
    logLevel: str('LOG_LEVEL', env === 'production' ? 'info' : 'debug'),
    databaseUrl: str('DATABASE_URL'),
    redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),
    allowedOrigins: list('ALLOWED_ORIGINS', ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080', 'http://127.0.0.1:8080']),
    allowedHosts: list('ALLOWED_HOSTS', ['localhost', '127.0.0.1', 'api', 'aero-api']),
    scraper: { baseUrl: str('SCRAPER_URL', 'http://127.0.0.1:8081'), timeoutMs: int('SCRAPER_TIMEOUT_MS', 20000) },
    gateway: {
      baseUrl: str('WA_GATEWAY_URL', 'http://127.0.0.1:3200'),
      apiKey: str('WA_GATEWAY_API_KEY', ''),
      sessionId: str('WA_SESSION_ID', 'aero-main'),
      webhookSecret: str('WA_WEBHOOK_SECRET', ''),
      webhookUrl: str('WA_WEBHOOK_URL', 'http://api:3100/api/webhooks/wa'),
      timeoutMs: int('WA_GATEWAY_TIMEOUT_MS', 20000),
    },
    sending: {
      enabled: bool('SENDING_ENABLED', false),
      allowlist: list('SEND_ALLOWLIST'),
    },
    media: { dir: str('MEDIA_DIR', './data/media'), maxBytes: int('MEDIA_MAX_BYTES', 16 * 1024 * 1024) },
    staticDir: process.env.STATIC_DIR || null,
  };
}
