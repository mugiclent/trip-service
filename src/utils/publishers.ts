import { randomUUID } from 'node:crypto';
import { getRabbitMQChannel } from '../loaders/rabbitmq.js';
import type { PaymentMethod } from '../contracts/payment.js';

const publish = (
  exchange: string,
  routingKey: string,
  payload: object,
  options?: { expiration?: string },
): void => {
  try {
    getRabbitMQChannel().publish(
      exchange,
      routingKey,
      Buffer.from(
        JSON.stringify({
          event_id: randomUUID(),
          version: 1,
          source: 'trip-service',
          timestamp: new Date().toISOString(),
          ...payload,
        }),
      ),
      { persistent: true, ...options },
    );
  } catch (err) {
    console.error(`[publishers] Failed to publish to ${exchange}/${routingKey}`, err);
  }
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  actor_id: string;
  action: string;
  resource: string;
  resource_id: string;
  delta?: Record<string, { from: unknown; to: unknown }>;
  ip?: string;
}

export const publishAudit = (event: AuditEvent): void =>
  publish('logs', 'audit.logs', event);

// ---------------------------------------------------------------------------
// Trip domain events — trips exchange
// ---------------------------------------------------------------------------

export type TripEvent =
  | {
      type: 'trip.created';
      trip_id: string;
      org_id: string;
      series_id: string;
      route_id: string;
      departure_at: string;
    }
  | {
      type: 'trip.cancelled';
      trip_id: string;
      org_id: string;
      reason?: string;
    }
  | {
      // telemetry-service resolves position pings to this trip via bus_id + device_id,
      // so both are required (events missing them are dead-lettered to trips.dlx).
      type: 'trip.activated';
      trip_id: string;
      org_id: string;
      bus_id: string;
      device_id: string;
    }
  | {
      type: 'trip.completed';
      trip_id: string;
      org_id: string;
    };

export const publishTripEvent = (event: TripEvent): void =>
  publish('trips', 'trip.events', event);

// ---------------------------------------------------------------------------
// Payment coordination — trips exchange
// ---------------------------------------------------------------------------

export interface PaymentRequestedEvent {
  ticket_id: string;
  trip_id: string;
  org_id: string;
  payment_method: PaymentMethod;
  ticket_price: number;
  user_id: string | null;
  phone: string | null;
  payment_ref: string;
}

export const publishPaymentRequested = (
  event: PaymentRequestedEvent,
  ttlMs: number,
): void =>
  publish('trips', 'ticket.events', { type: 'payment.requested', ...event }, {
    expiration: String(ttlMs),
  });

export interface RefundRequestedEvent {
  ticket_id: string;
  // The original ticket payment to reverse. payment-service keys the refund's own ledger
  // row on a fresh `payment_ref` (minted below) and locates the original by this field.
  original_payment_ref: string;
  ticket_price: number;
  user_id: string | null;
  phone: string | null;
  payment_method: PaymentMethod;
  reason: string;
}

export const publishRefundRequested = (event: RefundRequestedEvent): void =>
  publish('trips', 'ticket.events', {
    type: 'refund.requested',
    payment_ref: randomUUID(), // idempotency key for the refund transaction itself
    ...event,
  });

// ---------------------------------------------------------------------------
// Ticket confirmed — trips exchange (fanout: billing + tax services)
// ---------------------------------------------------------------------------

export interface TicketConfirmedEvent {
  ticket_id: string;
  org_id: string;
  org_tin: string;
  trip_id: string;
  payment_method: 'cash' | 'wallet' | 'mtn' | 'airtel';
  ticket_price: number;
  passenger_name: string;
  passenger_phone: string | null;
  boarding_stop_id: string;
  alighting_stop_id: string;
  departure_at: string;
  seats_count: number;
  confirmed_at: string;
  user_id: string | null;
}

export const publishTicketConfirmed = (event: TicketConfirmedEvent): void =>
  publish('trips', 'ticket.events', { type: 'ticket.confirmed', ...event });

// ---------------------------------------------------------------------------
// SMS — notifications exchange
// ---------------------------------------------------------------------------

export type TripSmsEvent =
  | {
      type: 'trip.ticket_confirmed';
      phone_number: string;
      passenger_name: string;
      origin: string;
      destination: string;
      departure_at: string;
      seats_count: number;
      ticket_ref: string;
      tax_receipt_no?: string;
    }
  | {
      type: 'trip.tax_receipt';
      phone_number: string;
      ticket_ref: string;
      tax_receipt_no: string;
    }
  | {
      type: 'trip.departure_reminder';
      phone_number: string;
      destination: string;
      departure_time: string;
    }
  | {
      type: 'trip.boarding_ready';
      phone_number: string;
      destination: string;
      boarding_stop: string;
      plate: string;
    }
  | {
      type: 'trip.refund_completed';
      phone_number: string;
      amount: number;
      payment_method: string;
    };

export const publishSms = (event: TripSmsEvent): void =>
  publish('notifications', 'sms.notifications', event);

// ---------------------------------------------------------------------------
// Mail — notifications exchange
// ---------------------------------------------------------------------------

export const publishMail = (event: Record<string, unknown>): void =>
  publish('notifications', 'mail.notifications', event);

// ---------------------------------------------------------------------------
// Push — notifications exchange
// ---------------------------------------------------------------------------

export const publishPush = (event: Record<string, unknown>): void =>
  publish('notifications', 'push.notifications', event);
