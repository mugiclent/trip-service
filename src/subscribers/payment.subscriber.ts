import type { Channel, ConsumeMessage } from 'amqplib';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';
import { seatHoldQueue, smsCoordQueue, smsReminderQueue } from '../loaders/bullmq.js';
import { publishRefundRequested, publishTicketConfirmed } from '../utils/publishers.js';
import { bookingStatusKey, BOOKING_STATUS_TTL } from '../utils/booking-status.js';
import { translatePaymentConfirmed, translatePaymentFailed } from '../contracts/payment.js';
import type { PaymentConfirmed, PaymentFailed } from '../contracts/payment.js';

// Deliver a terminal booking outcome to the SSE stream: persist it (so a client that
// connects/reconnects within the payment window replays it — fixes the lost-event race)
// AND publish it (for a client already streaming).
const emitBookingOutcome = async (ticketId: string, payload: object): Promise<void> => {
  const body = JSON.stringify(payload);
  const redis = getRedisClient();
  await redis.set(bookingStatusKey(ticketId), body, 'EX', BOOKING_STATUS_TTL);
  await redis.publish(`booking:${ticketId}`, body);
};

const handlePaymentConfirmed = async (event: PaymentConfirmed): Promise<void> => {
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
      original_payment_ref: ticket.payment_ref,
      ticket_price: ticket.ticket_price,
      user_id: ticket.user_id,
      phone: ticket.passenger_phone,
      payment_method: ticket.payment_method,
      reason: 'TICKET_EXPIRED',
    });
    return;
  }

  if (ticket.status !== 'payment_pending') return;

  // Use payment-service's authoritative settlement time, not our local clock.
  const confirmedAt = new Date(event.confirmed_at);

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'confirmed', confirmed_at: confirmedAt },
  });

  const job = await seatHoldQueue.getJob(`seat-hold-${ticket.id}`);
  if (job) await job.remove();

  await emitBookingOutcome(ticket.id, {
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
  });

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

  // Confirmation SMS only for passenger-initiated bookings (wallet, mtn, airtel).
  // Cash is operator-initiated at the counter — the passenger isn't notified even
  // though we keep their phone on the ticket.
  const passengerInitiated = ticket.payment_method !== 'cash';

  if (passengerInitiated && ticket.passenger_phone) {
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

const handlePaymentFailed = async (event: PaymentFailed): Promise<void> => {
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

  await emitBookingOutcome(event.ticket_id, {
    status: 'failed',
    reason: event.reason,
    retryable: event.retryable,
  });
};

export const initPaymentSubscriber = async (ch: Channel): Promise<void> => {
  await ch.consume('payment-trip-svc', async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    // payment-service dispatches by AMQP routing key (no `type` in the body).
    const routingKey = msg.fields.routingKey;

    try {
      if (routingKey === 'payment.confirmed') {
        await handlePaymentConfirmed(translatePaymentConfirmed(JSON.parse(msg.content.toString())));
      } else if (routingKey === 'payment.failed') {
        await handlePaymentFailed(translatePaymentFailed(JSON.parse(msg.content.toString())));
      }
      // topup.* and wallet.events are for user-service; ignore here.

      try { ch.ack(msg); } catch { /* channel closed — broker requeues */ }
    } catch (err) {
      console.error('[payment.subscriber] Error processing message', routingKey, err);
      try { ch.nack(msg, false, false); } catch { /* channel closed — broker requeues */ }
    }
  });

  console.warn('[payment.subscriber] Listening on payment-trip-svc');
};
