import { randomUUID } from 'node:crypto';
import { prisma } from '../models/index.js';
import type { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { publishPaymentRequested, publishRefundRequested, publishAudit } from '../utils/publishers.js';
import { seatHoldQueue } from '../loaders/bullmq.js';
import { getRedisClient } from '../loaders/redis.js';
import { bookingMetaKey } from '../utils/booking-status.js';
import { detectNetwork } from '../utils/phone.js';
import { buildAbilityFromRules, getScopeFor, accessibleWhere } from '../utils/ability.js';
import type { AuthenticatedUser } from '../utils/ability.js';
import { getEffectivePrice } from './prices.service.js';

const WALLET_TTL_MS = 30_000;
const MOMO_TTL_MS = 180_000;

// Seed the cache the SSE stream reads instead of the DB. TTL is the booking's payment
// window, so the key is live exactly while the ticket can be pending. Best-effort: if
// this write fails the booking still succeeds, but its live stream will 404 until the
// payment outcome is known — the client just polls the REST endpoint instead.
const cacheBookingMeta = (
  ticket: { id: string; user_id: string | null; payment_method: string },
  ttlSeconds: number,
): void => {
  void getRedisClient()
    .set(
      bookingMetaKey(ticket.id),
      JSON.stringify({ user_id: ticket.user_id, payment_method: ticket.payment_method }),
      'EX',
      ttlSeconds,
    )
    .catch(() => {});
};

const ticketWithDetails = {
  trip: { include: { route: true, bus: true } },
  org: { select: { id: true, name: true, slug: true, logo_path: true } },
  boarding_stop: true,
  alighting_stop: true,
} as const;

const validateBookingRequest = async (params: {
  trip_id: string;
  boarding_stop_id: string;
  alighting_stop_id: string;
  seats_count: number;
}) => {
  const trip = await prisma.trip.findUnique({
    where: { id: params.trip_id },
    include: {
      route: { include: { route_stops: { orderBy: { order: 'asc' } } } },
      org: true,
    },
  });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (trip.status !== 'scheduled') throw new AppError('TRIP_NOT_AVAILABLE', 409);
  if (trip.departure_at <= new Date()) throw new AppError('TRIP_NOT_AVAILABLE', 409);
  if (trip.org.status !== 'active') throw new AppError('TRIP_NOT_AVAILABLE', 409);

  const orgBlocked = await getRedisClient().get(`org_blocked:${trip.org_id}`);
  if (orgBlocked) throw new AppError('ORG_BILLING_OVERDUE', 403);

  const stops = trip.route.route_stops;
  const boardingOrder = stops.find((s) => s.stop_id === params.boarding_stop_id)?.order ?? -1;
  const alightingOrder = stops.find((s) => s.stop_id === params.alighting_stop_id)?.order ?? -1;
  if (boardingOrder < 0 || alightingOrder < 0) throw new AppError('INVALID_ROUTE', 400);
  if (boardingOrder >= alightingOrder) throw new AppError('INVALID_STOP_ORDER', 400);

  // Effective fare for the trip's operator: their fork wins, else the platform default.
  const price = await getEffectivePrice(trip.org_id, params.boarding_stop_id, params.alighting_stop_id);
  if (!price) throw new AppError('PRICE_NOT_FOUND', 404);

  return { trip, price };
};

export const bookWalletTicket = async (
  user: AuthenticatedUser,
  data: {
    trip_id: string;
    boarding_stop_id: string;
    alighting_stop_id: string;
    seats_count: number;
  },
) => {
  const { trip, price } = await validateBookingRequest(data);

  const ticket = await prisma.$transaction(async (tx) => {
    const freshTrip = await tx.trip.findFirst({
      where: { id: data.trip_id, available_seats: { gte: data.seats_count } },
    });
    if (!freshTrip) throw new AppError('NO_SEATS_AVAILABLE', 409, { available: trip.available_seats });

    await tx.trip.update({
      where: { id: data.trip_id },
      data: { available_seats: { decrement: data.seats_count } },
    });

    return tx.ticket.create({
      data: {
        org_id: trip.org_id,
        trip_id: data.trip_id,
        user_id: user.id,
        passenger_name: user.id,
        boarding_stop_id: data.boarding_stop_id,
        alighting_stop_id: data.alighting_stop_id,
        seats_count: data.seats_count,
        ticket_price: price.amount,
        payment_method: 'wallet',
        payment_ref: randomUUID(),
        status: 'payment_pending',
        expires_at: new Date(Date.now() + WALLET_TTL_MS),
      },
    });
  });

  cacheBookingMeta(ticket, WALLET_TTL_MS / 1000);

  await seatHoldQueue.add(
    'expire-seat-hold',
    { ticket_id: ticket.id, trip_id: data.trip_id, seats_count: data.seats_count },
    { jobId: `seat-hold-${ticket.id}`, delay: WALLET_TTL_MS, removeOnComplete: true, removeOnFail: 100 },
  );

  publishPaymentRequested({
    ticket_id: ticket.id,
    trip_id: data.trip_id,
    org_id: trip.org_id,
    payment_method: 'wallet',
    ticket_price: price.amount,
    user_id: user.id,
    phone: null,
    payment_ref: ticket.payment_ref,
  }, WALLET_TTL_MS);

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'create', resource: 'Ticket', resource_id: ticket.id });
  });

  return { ticket_id: ticket.id };
};

export const bookMomoTicket = async (data: {
  trip_id: string;
  boarding_stop_id: string;
  alighting_stop_id: string;
  seats_count: number;
  phone: string;
  passenger_name: string;
}) => {
  const network = detectNetwork(data.phone);
  if (!network) throw new AppError('UNSUPPORTED_NETWORK', 422);

  const { trip, price } = await validateBookingRequest(data);

  const ticket = await prisma.$transaction(async (tx) => {
    const freshTrip = await tx.trip.findFirst({
      where: { id: data.trip_id, available_seats: { gte: data.seats_count } },
    });
    if (!freshTrip) throw new AppError('NO_SEATS_AVAILABLE', 409, { available: trip.available_seats });

    await tx.trip.update({
      where: { id: data.trip_id },
      data: { available_seats: { decrement: data.seats_count } },
    });

    return tx.ticket.create({
      data: {
        org_id: trip.org_id,
        trip_id: data.trip_id,
        user_id: null,
        passenger_name: data.passenger_name,
        passenger_phone: data.phone,
        boarding_stop_id: data.boarding_stop_id,
        alighting_stop_id: data.alighting_stop_id,
        seats_count: data.seats_count,
        ticket_price: price.amount,
        payment_method: network,
        payment_ref: randomUUID(),
        status: 'payment_pending',
        expires_at: new Date(Date.now() + MOMO_TTL_MS),
      },
    });
  });

  cacheBookingMeta(ticket, MOMO_TTL_MS / 1000);

  await seatHoldQueue.add(
    'expire-seat-hold',
    { ticket_id: ticket.id, trip_id: data.trip_id, seats_count: data.seats_count },
    { jobId: `seat-hold-${ticket.id}`, delay: MOMO_TTL_MS, removeOnComplete: true, removeOnFail: 100 },
  );

  publishPaymentRequested({
    ticket_id: ticket.id,
    trip_id: data.trip_id,
    org_id: trip.org_id,
    payment_method: network,
    ticket_price: price.amount,
    user_id: null,
    phone: data.phone,
    payment_ref: ticket.payment_ref,
  }, MOMO_TTL_MS);

  return { ticket_id: ticket.id };
};

export const bookCashTicket = async (
  dispatcher: AuthenticatedUser,
  data: {
    trip_id: string;
    boarding_stop_id: string;
    alighting_stop_id: string;
    seats_count?: number;
    passenger_name: string;
    passenger_phone?: string;
  },
) => {
  const seatsCount = data.seats_count ?? 1;
  const { trip, price } = await validateBookingRequest({ ...data, seats_count: seatsCount });

  const ticket = await prisma.$transaction(async (tx) => {
    const freshTrip = await tx.trip.findFirst({
      where: { id: data.trip_id, available_seats: { gte: seatsCount } },
    });
    if (!freshTrip) throw new AppError('NO_SEATS_AVAILABLE', 409, { available: trip.available_seats });

    await tx.trip.update({
      where: { id: data.trip_id },
      data: { available_seats: { decrement: seatsCount } },
    });

    return tx.ticket.create({
      data: {
        org_id: trip.org_id,
        trip_id: data.trip_id,
        user_id: null,
        passenger_name: data.passenger_name,
        passenger_phone: data.passenger_phone ?? null,
        boarding_stop_id: data.boarding_stop_id,
        alighting_stop_id: data.alighting_stop_id,
        seats_count: seatsCount,
        ticket_price: price.amount,
        payment_method: 'cash',
        payment_ref: randomUUID(),
        status: 'payment_pending',
        expires_at: new Date(Date.now() + WALLET_TTL_MS),
        created_by: dispatcher.id,
      },
    });
  });

  cacheBookingMeta(ticket, WALLET_TTL_MS / 1000);

  await seatHoldQueue.add(
    'expire-seat-hold',
    { ticket_id: ticket.id, trip_id: data.trip_id, seats_count: seatsCount },
    { jobId: `seat-hold-${ticket.id}`, delay: WALLET_TTL_MS, removeOnComplete: true, removeOnFail: 100 },
  );

  publishPaymentRequested({
    ticket_id: ticket.id,
    trip_id: data.trip_id,
    org_id: trip.org_id,
    payment_method: 'cash',
    ticket_price: price.amount,
    user_id: null,
    phone: data.passenger_phone ?? null,
    payment_ref: ticket.payment_ref,
  }, WALLET_TTL_MS);

  setImmediate(() => {
    publishAudit({ actor_id: dispatcher.id, action: 'create', resource: 'Ticket', resource_id: ticket.id });
  });

  return { ticket_id: ticket.id };
};

export const getTicket = async (id: string, user?: AuthenticatedUser) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: ticketWithDetails,
  });
  if (!ticket) throw new AppError('TICKET_NOT_FOUND', 404);

  if (user) {
    if (user.user_type === 'passenger' && ticket.user_id !== user.id) {
      throw new AppError('FORBIDDEN', 403);
    }
    if (user.user_type === 'staff' && user.org_id && ticket.org_id !== user.org_id) {
      const isPlatformAdmin = user.role_slugs.includes('platform_admin');
      if (!isPlatformAdmin) throw new AppError('FORBIDDEN', 403);
    }
  }

  return ticket;
};

export const listMyTickets = async (
  userId: string,
  filters: { status?: string; page?: number; limit?: number },
) => {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.TicketWhereInput = {
    user_id: userId,
    ...(filters.status ? { status: filters.status as never } : {}),
  };

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, include: ticketWithDetails, orderBy: { created_at: 'desc' }, skip, take: limit }),
    prisma.ticket.count({ where }),
  ]);

  return { tickets, total, page, limit };
};

export const cancelTicket = async (user: AuthenticatedUser, id: string, reason?: string) => {
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: { trip: true } });
  if (!ticket) throw new AppError('TICKET_NOT_FOUND', 404);

  if (!ticket.trip.cancellation_allowed) throw new AppError('CANCELLATION_NOT_ALLOWED', 403);
  if (ticket.status !== 'confirmed') throw new AppError('TICKET_NOT_CANCELLABLE', 409, { current_status: ticket.status });

  if (user.user_type === 'passenger' && ticket.user_id !== user.id) throw new AppError('FORBIDDEN', 403);
  if (user.user_type === 'staff' && user.org_id && ticket.org_id !== user.org_id) {
    if (!user.role_slugs.includes('platform_admin')) throw new AppError('FORBIDDEN', 403);
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: { status: 'cancelled', cancelled_at: new Date(), cancellation_reason: reason ?? null },
    include: ticketWithDetails,
  });

  if (ticket.payment_method !== 'cash') {
    publishRefundRequested({
      ticket_id: ticket.id,
      original_payment_ref: ticket.payment_ref,
      ticket_price: ticket.ticket_price,
      user_id: ticket.user_id,
      phone: ticket.passenger_phone,
      payment_method: ticket.payment_method,
      reason: 'PASSENGER_CANCELLED',
    });
  }

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'cancel', resource: 'Ticket', resource_id: id });
  });

  return updated;
};

export const validateTicket = async (
  user: AuthenticatedUser,
  ticketId: string,
) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { trip: true, boarding_stop: true, alighting_stop: true },
  });
  if (!ticket) throw new AppError('TICKET_NOT_FOUND', 404);

  if (user.org_id && ticket.org_id !== user.org_id) {
    throw new AppError('INVALID_TICKET_FOR_TRIP', 403);
  }

  if (user.role_slugs.includes('driver')) {
    const assignedTrip = await prisma.trip.findFirst({
      where: { driver_id: user.id, id: ticket.trip_id },
    });
    if (!assignedTrip) {
      return { valid: false as const, reason: 'WRONG_TRIP' };
    }
  }

  if (ticket.status !== 'confirmed') {
    return { valid: false as const, reason: 'TICKET_NOT_CONFIRMED' };
  }

  if (ticket.validated_at) {
    return { valid: false as const, reason: 'ALREADY_VALIDATED' };
  }

  const today = new Date();
  const depDate = ticket.trip.departure_at;
  if (
    depDate.getUTCFullYear() !== today.getUTCFullYear() ||
    depDate.getUTCMonth() !== today.getUTCMonth() ||
    depDate.getUTCDate() !== today.getUTCDate()
  ) {
    return { valid: false as const, reason: 'WRONG_DATE' };
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: { validated_at: new Date() } });

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'update', resource: 'Ticket', resource_id: ticketId });
  });

  return {
    valid: true as const,
    passenger_name: ticket.passenger_name,
    seats_count: ticket.seats_count,
    boarding_stop: ticket.boarding_stop,
    alighting_stop: ticket.alighting_stop,
    confirmed_at: ticket.confirmed_at,
  };
};

export const listTickets = async (
  user: AuthenticatedUser,
  filters: { org_id?: string; trip_id?: string; route_id?: string; status?: string; payment_method?: string; from?: string; to?: string; page?: number; limit?: number },
) => {
  const ability = buildAbilityFromRules(user.rules);
  // Boundary from the caller's Ticket rule conditions: passenger → own (user_id),
  // staff → org, platform → all. Only platform may narrow to an arbitrary org.
  const isPlatform = getScopeFor(ability, 'read', 'Ticket') === 'platform';

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.TicketWhereInput = {
    AND: [
      accessibleWhere(ability, 'read', 'Ticket'),
      ...(isPlatform && filters.org_id ? [{ org_id: filters.org_id }] : []),
      ...(filters.trip_id ? [{ trip_id: filters.trip_id }] : []),
      ...(filters.status ? [{ status: filters.status as never }] : []),
      ...(filters.payment_method ? [{ payment_method: filters.payment_method as never }] : []),
      ...(filters.from || filters.to ? [{ created_at: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } }] : []),
    ],
  };

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, include: ticketWithDetails, orderBy: { created_at: 'desc' }, skip, take: limit }),
    prisma.ticket.count({ where }),
  ]);

  return { tickets, total, page, limit };
};
