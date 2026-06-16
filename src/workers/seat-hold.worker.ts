import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { prisma } from '../models/index.js';
import { getRedisClient } from '../loaders/redis.js';
import { bookingStatusKey, BOOKING_STATUS_TTL } from '../utils/booking-status.js';

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

      // Persist THEN publish — same ordering as emitBookingOutcome — so an SSE client
      // that reconnects within the replay window gets the terminal outcome immediately
      // instead of re-arming a fresh client-side timeout.
      const body = JSON.stringify({ status: 'timeout', message: 'Payment window expired. Please try again.' });
      const redis = getRedisClient();
      await redis.set(bookingStatusKey(ticket_id), body, 'EX', BOOKING_STATUS_TTL);
      await redis.publish(`booking:${ticket_id}`, body);
    },
    { connection, concurrency: 1 },
  );
