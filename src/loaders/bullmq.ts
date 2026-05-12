import { Queue } from 'bullmq';
import type { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { runSeatHoldWorker } from '../workers/seat-hold.worker.js';
import { runSmsCoordWorker } from '../workers/sms-coord.worker.js';
import { runSmsReminderWorker } from '../workers/sms-reminder.worker.js';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
};

export let seatHoldQueue: Queue;
export let smsCoordQueue: Queue;
export let smsReminderQueue: Queue;

let workers: Worker[] = [];

export const initBullMQ = (): void => {
  seatHoldQueue = new Queue('seat-hold', { connection, defaultJobOptions });
  smsCoordQueue = new Queue('sms-coord', { connection, defaultJobOptions });
  smsReminderQueue = new Queue('sms-reminder', { connection, defaultJobOptions });

  workers = [
    runSeatHoldWorker(connection),
    runSmsCoordWorker(connection),
    runSmsReminderWorker(connection),
  ];

  console.warn('[bullmq] Queues and workers initialized');
};

export const closeBullMQ = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  await seatHoldQueue?.close();
  await smsCoordQueue?.close();
  await smsReminderQueue?.close();
};
