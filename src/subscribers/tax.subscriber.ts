import type { ConsumeMessage } from 'amqplib';
import { getConsumerChannel } from '../loaders/rabbitmq.js';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';
import { smsCoordQueue } from '../loaders/bullmq.js';
import { publishSms } from '../utils/publishers.js';

interface TaxConfirmedEvent {
  type: 'tax.confirmed';
  ticket_id: string;
  tax_receipt_no: string;
  receipt_signature: string;
}

const handleTaxConfirmed = async (event: TaxConfirmedEvent): Promise<void> => {
  const job = await smsCoordQueue.getJob(`sms:${event.ticket_id}`);

  if (job) {
    await job.remove();

    const data = job.data as {
      passenger_phone: string;
      passenger_name: string;
      origin: string;
      destination: string;
      departure_at: string;
      seats_count: number;
      ticket_id: string;
    };

    publishSms({
      type: 'trip.ticket_confirmed',
      phone_number: data.passenger_phone,
      passenger_name: data.passenger_name,
      origin: data.origin,
      destination: data.destination,
      departure_at: data.departure_at,
      seats_count: data.seats_count,
      ticket_ref: event.ticket_id.slice(-8).toUpperCase(),
      tax_receipt_no: event.tax_receipt_no,
    });
    return;
  }

  const sms1Sent = await getRedisClient().get(`sms1_sent:${event.ticket_id}`);
  if (sms1Sent) {
    const ticket = await prisma.ticket.findUnique({ where: { id: event.ticket_id } });
    if (ticket?.passenger_phone) {
      publishSms({
        type: 'trip.tax_receipt',
        phone_number: ticket.passenger_phone,
        ticket_ref: event.ticket_id.slice(-8).toUpperCase(),
        tax_receipt_no: event.tax_receipt_no,
      });
    }
  } else {
    console.error('[tax.subscriber] Anomaly: tax.confirmed but no sms1_sent flag', { ticket_id: event.ticket_id });
  }
};

export const initTaxSubscriber = async (): Promise<void> => {
  const ch = getConsumerChannel();

  await ch.consume('tax-trip-svc', async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString()) as TaxConfirmedEvent;

      if (event.type === 'tax.confirmed') {
        await handleTaxConfirmed(event);
      }

      ch.ack(msg);
    } catch (err) {
      console.error('[tax.subscriber] Error processing message', err);
      ch.nack(msg, false, false);
    }
  });

  console.warn('[tax.subscriber] Listening on tax-trip-svc');
};
