import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { publishSms } from '../utils/publishers.js';

export interface SmsReminderJobData {
  ticket_id: string;
  passenger_phone: string;
  destination: string;
  departure_time: string;
}

export const runSmsReminderWorker = (connection: ConnectionOptions): Worker =>
  new Worker<SmsReminderJobData>(
    'sms-reminder',
    async (job) => {
      const { passenger_phone, destination, departure_time } = job.data;

      publishSms({
        type: 'trip.departure_reminder',
        phone_number: passenger_phone,
        destination,
        departure_time,
      });
    },
    { connection, concurrency: 5 },
  );
