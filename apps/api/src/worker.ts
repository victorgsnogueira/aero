import { Worker, type Job } from 'bullmq';
import { createRuntime } from './core/bootstrap.ts';
import { QUEUES, redisConnection } from './core/queues.ts';
import { relayOutbox } from './core/outbox.ts';
import { activeScanIds, scanTick } from './modules/scans/orchestrator.ts';
import { runValidation, type ValidationScope } from './modules/validation/service.ts';
import { dispatchTick } from './modules/messaging/dispatcher.ts';
import { reconcileUnknown, recoverStuckProcessing } from './modules/messaging/sender.ts';
import { processWebhookEvent, RetryLater } from './modules/automation/inbound.ts';
import { closeNoReply, schedulePendingForActiveCampaigns, requeueUnprocessedWebhooks } from './modules/automation/maintenance.ts';
import { syncSessionStatus } from './modules/whatsapp/session.ts';

// Processo de tarefas em segundo plano. Estado de verdade no MySQL; filas apenas
// disparam processamento. Após reinício, a manutenção reencontra o trabalho
// pendente (varreduras ativas, outbox, webhooks não processados, envios).

const runtime = createRuntime(undefined, 'worker');
const { ctx } = runtime;
const connection = redisConnection(ctx.config.redisUrl);
const queues = ctx.queues!;

async function scheduleNextScanTick(scanId: number, delayMs: number) {
  const bucket = Math.floor((Date.now() + delayMs) / 5000);
  await queues.scans.add('scan.tick', { scanId }, { delay: delayMs, jobId: `scan-${scanId}-${bucket}`, removeOnComplete: true, removeOnFail: 100 });
}

async function scheduleDispatch(delayMs: number) {
  const bucket = Math.floor((Date.now() + delayMs) / 2000);
  await queues.dispatch.add('dispatch.tick', {}, { delay: Math.max(0, delayMs), jobId: `dispatch-${bucket}`, removeOnComplete: true, removeOnFail: 100 });
}

const workers: Worker[] = [];

workers.push(
  new Worker(
    QUEUES.scans,
    async (job: Job<{ scanId: number }>) => {
      const res = await scanTick(ctx, job.data.scanId);
      if (res.nextInMs !== null) await scheduleNextScanTick(job.data.scanId, res.nextInMs);
      return res;
    },
    { connection, concurrency: 1 },
  ),
);

workers.push(
  new Worker(
    QUEUES.validation,
    async (job: Job<{ scope: ValidationScope }>) => {
      const res = await runValidation(ctx, job.data.scope, { maxBatches: 10 });
      const sessionDown = res.stoppedReason?.startsWith('Sessão');
      if (res.remaining > 0 && !sessionDown && !res.stoppedReason?.startsWith('Falha')) {
        await queues.validation.add('validation.run', job.data, { delay: 1000 });
      }
      return res;
    },
    { connection, concurrency: 1 },
  ),
);

workers.push(
  new Worker(
    QUEUES.dispatch,
    async () => {
      const res = await dispatchTick(ctx);
      await scheduleDispatch(Math.min(Math.max(res.nextInMs, 1000), 60_000));
      return res;
    },
    { connection, concurrency: 1 },
  ),
);

workers.push(
  new Worker(
    QUEUES.inbound,
    async (job: Job<{ webhookEventId: number }>) => {
      try {
        return await processWebhookEvent(ctx, job.data.webhookEventId);
      } catch (err) {
        if (err instanceof RetryLater) throw err; // BullMQ reprocessa com backoff
        throw err;
      }
    },
    { connection, concurrency: 1 },
  ),
);

// Manutenção periódica (job repetível único)
workers.push(
  new Worker(
    QUEUES.maintenance,
    async (job: Job) => {
      switch (job.name) {
        case 'outbox.relay':
          return relayOutbox(ctx.db, queues);
        case 'housekeeping': {
          const stuck = await recoverStuckProcessing(ctx);
          const closed = await closeNoReply(ctx);
          const reconciled = await reconcileUnknown(ctx);
          const scheduled = await schedulePendingForActiveCampaigns(ctx);
          const requeued = await requeueUnprocessedWebhooks(ctx);
          for (const id of await activeScanIds(ctx)) await scheduleNextScanTick(id, 0);
          await scheduleDispatch(0);
          await syncSessionStatus(ctx).catch(() => undefined);
          return { stuck, closed, reconciled, scheduled, requeued };
        }
        case 'revalidate':
          await queues.validation.add('validation.run', { scope: { kind: 'stale' } }, { jobId: `revalidate-${new Date().toISOString().slice(0, 13)}` });
          return 'ok';
      }
      return null;
    },
    { connection, concurrency: 1 },
  ),
);

for (const w of workers) {
  w.on('failed', (job, err) => ctx.log.warn({ queue: w.name, jobId: job?.id, err: err.message }, 'Tarefa falhou'));
  w.on('error', (err) => ctx.log.error({ queue: w.name, err: err.message }, 'Erro no worker'));
}

await queues.maintenance.upsertJobScheduler('outbox-relay', { every: 1000 }, { name: 'outbox.relay' });
await queues.maintenance.upsertJobScheduler('housekeeping', { every: 60_000 }, { name: 'housekeeping' });
await queues.maintenance.upsertJobScheduler('revalidate', { every: 6 * 3600_000 }, { name: 'revalidate' });
// Recuperação imediata ao iniciar
await queues.maintenance.add('housekeeping', {}, { jobId: `boot-${Date.now()}` });
ctx.log.info('Worker iniciado');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, 'Encerrando worker (aguardando tarefas em andamento)');
  await Promise.allSettled(workers.map((w) => w.close()));
  await runtime.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
