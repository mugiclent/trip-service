import type { Request, Response } from 'express';
import { createRedisConnection, getRedisClient } from '../loaders/redis.js';
import { bookingStatusKey, bookingMetaKey } from '../utils/booking-status.js';
import type { BookingMeta } from '../utils/booking-status.js';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedUser } from '../utils/ability.js';

// Terminal markers as published on the booking channel and persisted in booking_status.
const STREAM_TERMINAL = new Set(['confirmed', 'failed', 'timeout']);

// Reject a passenger streaming someone else's booking. Owner id comes from the booking
// meta cache — the only auth source now that the stream never reads the DB.
const assertOwner = (user: AuthenticatedUser | undefined, ownerId: string | null): void => {
  if (user && user.user_type === 'passenger' && ownerId && ownerId !== user.id) {
    throw new AppError('FORBIDDEN', 403);
  }
};

export const streamTicketStatus = async (
  req: Request,
  res: Response,
  ticketId: string,
  user?: AuthenticatedUser,
): Promise<void> => {
  // Entirely Redis-backed, no DB. The booking meta cache (written at booking time, living
  // exactly the payment window) is what makes a ticket streamable: it both authorizes the
  // subscriber and sizes the timeout. Once it expires the payment window is over and the
  // durable ticket is reachable via the REST endpoints — so a miss is simply "nothing live
  // to stream" (404), never a DB fallback.
  const cached = await getRedisClient().get(bookingMetaKey(ticketId));
  if (!cached) throw new AppError('TICKET_NOT_FOUND', 404);

  const meta = JSON.parse(cached) as BookingMeta;
  assertOwner(user, meta.user_id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const writeEvent = (data: object): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const subscriber = createRedisConnection();
  // wallet and cash settle fast (30s window); mobile money needs the longer USSD window (180s).
  const isShortWindow = meta.payment_method === 'wallet' || meta.payment_method === 'cash';
  const timeoutMs = isShortWindow ? 30_000 : 180_000;

  let done = false;
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(hardTimeout);
    subscriber.unsubscribe().catch(() => {});
    subscriber.quit().catch(() => {});
  };

  // Emit a terminal event at most once — dedupes the live pub/sub message against the
  // post-subscribe booking_status replay (whichever lands first wins; the other is ignored).
  const finishTerminal = (data: object): void => {
    if (done) return;
    done = true;
    writeEvent(data);
    res.end();
    cleanup();
  };

  const hardTimeout = setTimeout(() => {
    finishTerminal({ status: 'timeout', message: 'Payment window expired. Please try again.' });
  }, timeoutMs);

  subscriber.on('message', (_channel: string, message: string) => {
    let parsed: { status: string };
    try {
      parsed = JSON.parse(message) as { status: string };
    } catch {
      return;
    }
    if (STREAM_TERMINAL.has(parsed.status)) {
      finishTerminal(parsed);
    } else if (!done) {
      writeEvent(parsed); // forward any non-terminal progress updates
    }
  });

  // Subscribe BEFORE reading the persisted outcome so we cannot miss one that lands in the
  // gap. The bridge persists booking_status (full terminal payload) and *then* publishes,
  // so once subscribed: if it settles later we get the publish; if it already settled, the
  // replay below catches it. The `done` guard ensures whichever path wins fires exactly once.
  await subscriber.subscribe(`booking:${ticketId}`);

  const persisted = await getRedisClient().get(bookingStatusKey(ticketId));
  if (persisted) {
    try {
      finishTerminal(JSON.parse(persisted) as object);
    } catch {
      /* malformed — fall through to the pending announcement below */
    }
  }

  // Still pending after the replay check — announce it and wait for the live outcome.
  if (!done) writeEvent({ status: 'pending' });

  req.on('close', cleanup);
};
