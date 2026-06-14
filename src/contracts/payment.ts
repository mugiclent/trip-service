// The boundary between two field worlds.
//
// payment-service speaks camelCase and serialises bigint money as decimal strings
// (see the `JSON.stringify` bigint replacer in payment-service/src/rabbitmq/client.ts).
// trip-service speaks snake_case and keeps money as `number` (RWF, whole francs).
//
// This module is the single place that translates payment-service's emitted events into
// the shapes the rest of trip-service works with — the same way user-service maps the
// payment events it consumes onto its own domain. Keep every camelCase / string-bigint
// quirk contained here so no other file has to know what the other world looks like.
//
// Reference — payment-service/src/rabbitmq/publisher.ts:
//   payment.confirmed → { paymentRef, method, amount, currency, userId, phone, ticketId,
//                         tripId, orgId, confirmedAt, gatewayRef, feeAmount, netAmount }
//   payment.failed    → { paymentRef, method, amount, userId, phone, ticketId, reason,
//                         failedAt, retryable }

export type PaymentMethod = 'cash' | 'wallet' | 'mtn' | 'airtel';

// ── payment-service wire shapes (camelCase; amount/feeAmount/netAmount are strings) ──────
interface PaymentConfirmedWire {
  paymentRef: string;
  method: PaymentMethod;
  amount: string;
  currency: string;
  userId?: string | null;
  phone?: string | null;
  ticketId?: string | null;
  tripId?: string | null;
  orgId?: string | null;
  confirmedAt: string;
  gatewayRef?: string | null;
  feeAmount?: string | null;
  netAmount?: string | null;
}

interface PaymentFailedWire {
  paymentRef: string;
  method: PaymentMethod;
  amount: string;
  userId?: string | null;
  phone?: string | null;
  ticketId?: string | null;
  reason: string;
  failedAt: string;
  retryable: boolean;
}

// ── trip-service domain shapes (snake_case; money as number) ─────────────────────────────
export interface PaymentConfirmed {
  ticket_id: string;
  payment_ref: string;
  payment_method: PaymentMethod;
  amount: number;
  fee_amount: number | null;
  net_amount: number | null;
  gateway_ref: string | null;
  confirmed_at: string; // ISO 8601, authoritative settlement time from payment-service
}

export interface PaymentFailed {
  ticket_id: string;
  payment_ref: string;
  payment_method: PaymentMethod;
  reason: string;
  retryable: boolean;
  failed_at: string; // ISO 8601
}

const toNumber = (v: string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

// payment-service keys its ticket events by `ticketId`; without it we can't resolve the
// trip-service ticket, so a missing one is a malformed event (nack to DLX, never retry).
const requireTicketId = (id: string | null | undefined, kind: string): string => {
  if (!id) throw new Error(`${kind} event has no ticketId`);
  return id;
};

export const translatePaymentConfirmed = (raw: unknown): PaymentConfirmed => {
  const e = raw as PaymentConfirmedWire;
  return {
    ticket_id: requireTicketId(e.ticketId, 'payment.confirmed'),
    payment_ref: e.paymentRef,
    payment_method: e.method,
    amount: Number(e.amount),
    fee_amount: toNumber(e.feeAmount),
    net_amount: toNumber(e.netAmount),
    gateway_ref: e.gatewayRef ?? null,
    confirmed_at: e.confirmedAt,
  };
};

export const translatePaymentFailed = (raw: unknown): PaymentFailed => {
  const e = raw as PaymentFailedWire;
  return {
    ticket_id: requireTicketId(e.ticketId, 'payment.failed'),
    payment_ref: e.paymentRef,
    payment_method: e.method,
    reason: e.reason,
    retryable: e.retryable,
    failed_at: e.failedAt,
  };
};
