import { buildApp } from './app.ts';
import { createRuntime } from './core/bootstrap.ts';

const runtime = createRuntime(undefined, 'api');
const app = await buildApp(runtime.ctx);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Encerrando API');
  try {
    await app.close();
    await runtime.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: runtime.ctx.config.host, port: runtime.ctx.config.port });
} catch (err) {
  app.log.error(err);
  await runtime.close();
  process.exit(1);
}
