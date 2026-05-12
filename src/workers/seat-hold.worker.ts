import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { prisma } from '../models/index.js';
import { getRedisClient } from '../loaders/redis.js';

export interface SeatHoldJobData {
  ticket_id: string;
  trip_id: string;
  seats_count: number;
}

export const runSeatHoldWorker = (connection: ConnectionOptions): Worker =>
  new Worker<SeatHoldJobData>(
    'seat-hold',
    async (job) => {
      const { ticket_id, seats_count } = job.data;

      const ticket = await prisma.ticket.findUnique({ where: { id: ticket_id } });
      if (!ticket || ticket.status !== 'payment_pending') return;

      await prisma.$transaction([
        prisma.ticket.update({
          where: { id: ticket_id },
          data: { status: 'expired' },
        }),
        prisma.trip.update({
          where: { id: ticket.trip_id },
          data: { available_seats: { increment: seats_count } },
        }),
      ]);

      await getRedisClient().publish(
        `booking:${ticket_id}`,
        JSON.stringify({ status: 'timeout', message: 'Payment window expired. Please try again.' }),
      );
    },
    { connection, concurrency: 1 },
  );
