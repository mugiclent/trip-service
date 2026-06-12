import type { Channel, ConsumeMessage } from 'amqplib';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';
import { seatHoldQueue, smsCoordQueue, smsReminderQueue } from '../loaders/bullmq.js';
import { publishRefundRequested, publishTicketConfirmed, publishSms } from '../utils/publishers.js';

interface PaymentConfirmedEvent {
  type: 'ticket.payment.confirmed' | 'payment.confirmed';
  ticket_id: string;
  payment_ref?: string;
}

interface PaymentFailedEvent {
  type: 'ticket.payment.failed' | 'payment.failed';
  ticket_id: string;
  payment_method: string;
  reason: string;
  retryable: boolean;
  available?: number;
  required?: number;
  shortfall?: number;
}

interface RefundCompletedEvent {
  type: 'refund.completed';
  ticket_id: string;
  payment_ref: string;
  amount: number;
  currency: string;
  payment_method: string;
  user_id: string | null;
}

type PaymentEvent = PaymentConfirmedEvent | PaymentFailedEvent | RefundCompletedEvent;

const handlePaymentConfirmed = async (event: PaymentConfirmedEvent): Promise<void> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: event.ticket_id },
    include: {
      trip: {
        include: {
          route: true,
        },
      },
      org: true,
      boarding_stop: true,
      alighting_stop: true,
    },
  });

  if (!ticket) return;

  if (['expired', 'failed', 'cancelled'].includes(ticket.status)) {
    publishRefundRequested({
      ticket_id: ticket.id,
      payment_ref: ticket.payment_ref,
      ticket_price: ticket.ticket_price,
      user_id: ticket.user_id,
      phone: ticket.passenger_phone,
      payment_method: ticket.payment_method,
      reason: 'TICKET_EXPIRED',
    });
    return;
  }

  if (ticket.status !== 'payment_pending') return;

  const confirmedAt = new Date();

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'confirmed', confirmed_at: confirmedAt },
  });

  const job = await seatHoldQueue.getJob(`seat-hold-${ticket.id}`);
  if (job) await job.remove();

  await getRedisClient().publish(
    `booking:${ticket.id}`,
    JSON.stringify({
      status: 'confirmed',
      ticket: {
        id: ticket.id,
        status: 'confirmed',
        payment_method: ticket.payment_method,
        ticket_price: ticket.ticket_price,
        currency: 'RWF',
        seats_count: ticket.seats_count,
        passenger_name: ticket.passenger_name,
        passenger_phone: ticket.passenger_phone ? ticket.passenger_phone.replace(/(\+250\d{3})\d{3}(\d{3})/, '$1***$2') : null,
        boarding_stop: { id: ticket.boarding_stop.id, name: ticket.boarding_stop.name },
        alighting_stop: { id: ticket.alighting_stop.id, name: ticket.alighting_stop.name },
        departure_at: ticket.trip.departure_at,
        arrival_at: ticket.trip.arrival_at,
        duration_minutes: ticket.trip.duration_minutes,
        org: { name: ticket.org.name, logo_path: ticket.org.logo_path },
        confirmed_at: confirmedAt,
      },
    }),
  );

  publishTicketConfirmed({
    ticket_id: ticket.id,
    org_id: ticket.org_id,
    org_tin: ticket.org.tin,
    trip_id: ticket.trip_id,
    payment_method: ticket.payment_method,
    ticket_price: ticket.ticket_price,
    passenger_name: ticket.passenger_name,
    passenger_phone: ticket.passenger_phone,
    boarding_stop_id: ticket.boarding_stop_id,
    alighting_stop_id: ticket.alighting_stop_id,
    departure_at: ticket.trip.departure_at.toISOString(),
    seats_count: ticket.seats_count,
    confirmed_at: confirmedAt.toISOString(),
    user_id: ticket.user_id,
  });

  if (ticket.passenger_phone) {
    await smsCoordQueue.add(
      'send-ticket-sms',
      {
        ticket_id: ticket.id,
        passenger_phone: ticket.passenger_phone,
        passenger_name: ticket.passenger_name,
        origin: ticket.boarding_stop.name,
        destination: ticket.alighting_stop.name,
        departure_at: ticket.trip.departure_at.toISOString(),
        seats_count: ticket.seats_count,
        ticket_price: ticket.ticket_price,
      },
      {
        jobId: `sms-${ticket.id}`,
        delay: 1000,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    const departureMs = ticket.trip.departure_at.getTime();
    const reminderDelay = departureMs - Date.now() - 2 * 60 * 60 * 1000;
    if (reminderDelay > 0) {
      await smsReminderQueue.add(
        'departure-reminder',
        {
          ticket_id: ticket.id,
          passenger_phone: ticket.passenger_phone,
          destination: ticket.alighting_stop.name,
          departure_time: ticket.trip.departure_at.toISOString(),
        },
        {
          jobId: `sms-reminder-${ticket.id}`,
          delay: reminderDelay,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
  }
};

const handlePaymentFailed = async (event: PaymentFailedEvent): Promise<void> => {
  const ticket = await prisma.ticket.findUnique({ where: { id: event.ticket_id } });
  if (!ticket || ticket.status !== 'payment_pending') return;

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: event.ticket_id },
      data: { status: 'failed' },
    }),
    prisma.trip.update({
      where: { id: ticket.trip_id },
      data: { available_seats: { increment: ticket.seats_count } },
    }),
  ]);

  const job = await seatHoldQueue.getJob(`seat-hold-${event.ticket_id}`);
  if (job) await job.remove();

  await getRedisClient().publish(
    `booking:${event.ticket_id}`,
    JSON.stringify({
      status: 'failed',
      reason: event.reason,
      retryable: event.retryable,
      ...(event.available !== undefined ? { available: event.available, required: event.required, shortfall: event.shortfall } : {}),
    }),
  );
};

const handleRefundCompleted = async (event: RefundCompletedEvent): Promise<void> => {
  const ticket = await prisma.ticket.findUnique({ where: { payment_ref: event.payment_ref } });
  if (!ticket?.passenger_phone) return;

  publishSms({
    type: 'trip.refund_completed',
    phone_number: ticket.passenger_phone,
    amount: event.amount,
    payment_method: event.payment_method,
  });
};

export const initPaymentSubscriber = async (ch: Channel): Promise<void> => {
  await ch.consume('payment-trip-svc', async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString()) as PaymentEvent;

      if (event.type === 'ticket.payment.confirmed' || event.type === 'payment.confirmed') {
        await handlePaymentConfirmed(event as PaymentConfirmedEvent);
      } else if (event.type === 'ticket.payment.failed' || event.type === 'payment.failed') {
        await handlePaymentFailed(event as PaymentFailedEvent);
      } else if (event.type === 'refund.completed') {
        await handleRefundCompleted(event as RefundCompletedEvent);
      }

      try { ch.ack(msg); } catch { /* channel closed — broker requeues */ }
    } catch (err) {
      console.error('[payment.subscriber] Error processing message', err);
      try { ch.nack(msg, false, false); } catch { /* channel closed — broker requeues */ }
    }
  });

  console.warn('[payment.subscriber] Listening on payment-trip-svc');
};
