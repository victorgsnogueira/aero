import { Queue, type ConnectionOptions } from 'bullmq';

export const QUEUES = {
  scans: 'aero-scans',
  validation: 'aero-validation',
  dispatch: 'aero-dispatch',
  inbound: 'aero-inbound',
  maintenance: 'aero-maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const TOPICS = {
  'scan.tick': QUEUES.scans,
  'validation.run': QUEUES.validation,
  'dispatch.tick': QUEUES.dispatch,
  'inbound.process': QUEUES.inbound,
} as const;
export type Topic = keyof typeof TOPICS;

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

export type Queues = Record<keyof typeof QUEUES, Queue>;

export function createQueues(connection: ConnectionOptions): Queues {
  const defaultJobOptions = { removeOnComplete: { count: 500 }, removeOnFail: { count: 2000 }, attempts: 3, backoff: { type: 'exponential', delay: 5000 } };
  return {
    scans: new Queue(QUEUES.scans, { connection, defaultJobOptions }),
    validation: new Queue(QUEUES.validation, { connection, defaultJobOptions }),
    dispatch: new Queue(QUEUES.dispatch, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),
    inbound: new Queue(QUEUES.inbound, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 5 } }),
    maintenance: new Queue(QUEUES.maintenance, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),
  };
}

export async function closeQueues(q: Queues): Promise<void> {
  await Promise.all(Object.values(q).map((queue) => queue.close()));
}
