import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { getRedisClient } from '../loaders/redis.js';
import { publishSms } from '../utils/publishers.js';

export interface SmsCoordJobData {
  ticket_id: string;
  passenger_phone: string;
  passenger_name: string;
  origin: string;
  destination: string;
  departure_at: string;
  seats_count: number;
  ticket_price: number;
}

export const runSmsCoordWorker = (connection: ConnectionOptions): Worker =>
  new Worker<SmsCoordJobData>(
    'sms-coord',
    async (job) => {
      const { ticket_id, passenger_phone, passenger_name, origin, destination, departure_at, seats_count } = job.data;
      const ticket_ref = ticket_id.slice(-8).toUpperCase();

      publishSms({
        type: 'trip.ticket_confirmed',
        phone_number: passenger_phone,
        passenger_name,
        origin,
        destination,
        departure_at,
        seats_count,
        ticket_ref,
      });

      await getRedisClient().set(`sms1_sent:${ticket_id}`, '1', 'EX', 86400);
    },
    { connection, concurrency: 10 },
  );
