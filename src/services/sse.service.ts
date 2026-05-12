import type { Request, Response } from 'express';
import { prisma } from '../models/index.js';
import { createRedisConnection } from '../loaders/redis.js';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedUser } from '../utils/ability.js';

const TERMINAL_STATUSES = new Set(['confirmed', 'failed', 'expired', 'cancelled']);

export const streamTicketStatus = async (
  req: Request,
  res: Response,
  ticketId: string,
  user?: AuthenticatedUser,
): Promise<void> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      trip: { include: { bus: true } },
      org: { select: { name: true, logo_path: true } },
      boarding_stop: true,
      alighting_stop: true,
    },
  });
  if (!ticket) throw new AppError('TICKET_NOT_FOUND', 404);

  if (user && user.user_type === 'passenger' && ticket.user_id && ticket.user_id !== user.id) {
    throw new AppError('FORBIDDEN', 403);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const writeEvent = (data: object): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (TERMINAL_STATUSES.has(ticket.status)) {
    if (ticket.status === 'confirmed') {
      writeEvent({
        status: 'confirmed',
        ticket: {
          id: ticket.id,
          status: ticket.status,
          payment_method: ticket.payment_method,
          ticket_price: ticket.ticket_price,
          currency: 'RWF',
          seats_count: ticket.seats_count,
          passenger_name: ticket.passenger_name,
          boarding_stop: { id: ticket.boarding_stop.id, name: ticket.boarding_stop.name },
          alighting_stop: { id: ticket.alighting_stop.id, name: ticket.alighting_stop.name },
          departure_at: ticket.trip.departure_at,
          org: ticket.org,
          confirmed_at: ticket.confirmed_at,
        },
      });
    } else {
      writeEvent({ status: ticket.status });
    }
    res.end();
    return;
  }

  writeEvent({ status: 'pending' });

  const subscriber = createRedisConnection();
  const isWallet = ticket.payment_method === 'wallet' || ticket.payment_method === 'cash';
  const timeoutMs = isWallet ? 30_000 : 180_000;

  const cleanup = (): void => {
    subscriber.unsubscribe().catch(() => {});
    subscriber.quit().catch(() => {});
    clearTimeout(hardTimeout);
  };

  const hardTimeout = setTimeout(() => {
    writeEvent({ status: 'timeout', message: 'Payment window expired. Please try again.' });
    res.end();
    cleanup();
  }, timeoutMs);

  subscriber.on('message', (_channel: string, message: string) => {
    writeEvent(JSON.parse(message) as object);
    const parsed = JSON.parse(message) as { status: string };
    if (['confirmed', 'failed', 'timeout'].includes(parsed.status)) {
      res.end();
      cleanup();
    }
  });

  await subscriber.subscribe(`booking:${ticketId}`);

  req.on('close', cleanup);
};
