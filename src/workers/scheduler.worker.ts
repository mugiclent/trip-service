import { Worker } from 'bullmq';
import type { ConnectionOptions, Queue } from 'bullmq';
import { prisma } from '../models/index.js';
import { materializeSeries, horizonEnd } from '../services/scheduling.js';

/**
 * Background scheduler. A single repeatable tick keeps the platform's trips correct
 * without materializing the whole future up front:
 *   1. lifecycle  — scheduled → active at departure, → completed after arrival,
 *   2. materialize — extend the rolling horizon for every active series.
 */

export const SCHEDULER_QUEUE = 'scheduler';
const TICK_EVERY_MS = 10 * 60 * 1000; // 10 minutes
const LEGACY_COMPLETE_GRACE_MS = 6 * 60 * 60 * 1000; // for trips with no arrival_at

const runLifecycle = async (): Promise<void> => {
  const now = new Date();

  // scheduled → active once the departure time has arrived (and it hasn't ended yet)
  await prisma.trip.updateMany({
    where: {
      status: 'scheduled',
      departure_at: { lte: now },
      OR: [{ arrival_at: null }, { arrival_at: { gt: now } }],
    },
    data: { status: 'active' },
  });

  // scheduled/active → completed once the arrival time has passed
  await prisma.trip.updateMany({
    where: { status: { in: ['scheduled', 'active'] }, arrival_at: { lte: now } },
    data: { status: 'completed' },
  });

  // Fallback for trips with no arrival_at (legacy rows): complete a while after departure
  await prisma.trip.updateMany({
    where: {
      status: { in: ['scheduled', 'active'] },
      arrival_at: null,
      departure_at: { lte: new Date(now.getTime() - LEGACY_COMPLETE_GRACE_MS) },
    },
    data: { status: 'completed' },
  });
};

const runMaterialize = async (): Promise<void> => {
  const end = horizonEnd();
  const series = await prisma.tripSeries.findMany({
    where: { status: 'active', OR: [{ materialized_until: null }, { materialized_until: { lt: end } }] },
  });
  for (const s of series) {
    try {
      await materializeSeries(s, end);
    } catch (err) {
      console.error(`[scheduler] materialize failed for series ${s.id}`, err);
    }
  }
};

export const runSchedulerWorker = (connection: ConnectionOptions): Worker =>
  new Worker(
    SCHEDULER_QUEUE,
    async () => {
      await runLifecycle();
      await runMaterialize();
    },
    { connection, concurrency: 1 },
  );

/** Register the singleton repeatable tick (idempotent by jobId). */
export const registerSchedulerTick = async (queue: Queue): Promise<void> => {
  await queue.add(
    'tick',
    {},
    { repeat: { every: TICK_EVERY_MS }, jobId: 'scheduler-tick', removeOnComplete: true, removeOnFail: 100 },
  );
};
