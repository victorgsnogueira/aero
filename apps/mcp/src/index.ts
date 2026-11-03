import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApi } from './api.ts';
import { createServer } from './server.ts';

// No .env loading: this bridge needs neither database credentials nor gateway secrets.
const rawReadOnly = process.env.AERO_MCP_READ_ONLY ?? 'false';
if (!['true', 'false'].includes(rawReadOnly)) throw new Error('AERO_MCP_READ_ONLY deve ser true ou false.');
const readOnly = rawReadOnly === 'true';
const api = createApi({ baseUrl: process.env.AERO_MCP_API_URL, readOnly });
const handle = serveStdio(() => createServer(api, { readOnly, filesRoot: process.env.AERO_MCP_FILES_ROOT }), {
  onerror: () => console.error('aero MCP: erro de transporte.'),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void handle.close(); });
}
