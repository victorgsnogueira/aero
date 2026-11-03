import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export interface SecurityOptions {
  allowedOrigins: string[];
  allowedHosts: string[];

  exemptPrefixes: string[];
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostname(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0]!.toLowerCase();
}

export default fp(
  async function security(app: FastifyInstance, opts: SecurityOptions) {
    const origins = new Set(opts.allowedOrigins);
    const hosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));

    app.addHook('onRequest', async (req, reply) => {
      const path = req.url.split('?')[0] ?? '';
      if (opts.exemptPrefixes.some((p) => path.startsWith(p))) return;

      const host = hostname(req.headers.host);
      if (!hosts.has(host)) {
        req.log.warn({ host }, 'Host não permitido');
        return reply.code(421).send({ error: 'host_not_allowed', message: 'Host não permitido' });
      }

      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) {
        req.log.warn({ origin }, 'Origem não permitida');
        return reply.code(403).send({ error: 'origin_not_allowed', message: 'Origem não permitida' });
      }

      if (!SAFE_METHODS.has(req.method)) {
        if (req.headers['x-aero-request'] !== '1') {
          return reply.code(403).send({ error: 'csrf', message: 'Cabeçalho X-Aero-Request ausente' });
        }
        const fetchSite = req.headers['sec-fetch-site'];
        if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none' && !origin) {
          return reply.code(403).send({ error: 'csrf', message: 'Requisição entre sites bloqueada' });
        }
      }
    });
  },
  { name: 'aero-security' },
);
