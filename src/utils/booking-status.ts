// Per-booking terminal outcome, persisted in Redis so an SSE client that connects
// (or reconnects) within the payment window — e.g. after a network blip — can replay
// it immediately instead of waiting out the timeout. TTL covers the longest payment
// window (MoMo ~3 min) plus a little grace; durability beyond that is not needed —
// after settlement the client fetches the ticket via the normal REST endpoints.
export const BOOKING_STATUS_TTL = 300; // seconds

export const bookingStatusKey = (ticketId: string): string => `booking_status:${ticketId}`;

// Written at booking time, read when an SSE client connects — the stream never touches
// the DB. It holds the only things needed to run a live stream before any outcome exists:
// `user_id` to authorize the subscriber and `payment_method` to size the timeout. Its TTL
// is set to the booking's payment window, so the key lives exactly as long as the ticket
// can be pending. Once it expires the window is over and the durable ticket is served by
// the REST endpoints, so an SSE miss means "nothing live to stream" (a 404), not a DB read.
export const bookingMetaKey = (ticketId: string): string => `booking_meta:${ticketId}`;

export interface BookingMeta {
  user_id: string | null;
  payment_method: string;
}
