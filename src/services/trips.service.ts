import { prisma } from '../models/index.js';
import type { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { publishAudit, publishRefundRequested, publishTripEvent } from '../utils/publishers.js';
import { subject } from '@casl/ability';
import { buildAbilityFromRules, getScopeFor, accessibleWhere } from '../utils/ability.js';
import type { AuthenticatedUser, Subjects } from '../utils/ability.js';
import { getEffectivePrice } from './prices.service.js';
import { materializeSeries, horizonEnd } from './scheduling.js';
import { localWallTimeToUtc, utcToLocalDay, localDayBoundsUtc } from '../utils/time.js';

const VALID_FREQUENCIES = [null, 30, 60, 90, 120, 180, 240];

const tripWithDetails = {
  org: { select: { id: true, name: true, slug: true, logo_path: true, story: true } },
  route: { include: { route_stops: { include: { stop: true }, orderBy: { order: 'asc' as const } } } },
  bus: { select: { id: true, plate: true, type: true } },
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
} as const;

export const createTrips = async (
  user: AuthenticatedUser,
  data: {
    route_id: string;
    bus_id?: string;
    driver_id?: string;
    total_seats?: number;
    is_express?: boolean;
    departure_time: string;
    starts_on: string;
    repeat_daily?: boolean;
    frequency_minutes?: number | null;
    ends_on?: string | null;
  },
) => {
  if (!VALID_FREQUENCIES.includes(data.frequency_minutes ?? null)) {
    throw new AppError('INVALID_FREQUENCY', 400);
  }

  const route = await prisma.route.findUnique({
    where: { id: data.route_id },
    include: { org: true },
  });
  if (!route) throw new AppError('ROUTE_NOT_FOUND', 404);

  // Routes are platform defaults (org_id null); the operating org comes from the
  // staff member. A trip must belong to an operator.
  const scopedOrgId = user.org_id ?? route.org_id;
  if (!scopedOrgId) throw new AppError('ORG_REQUIRED', 400);
  if (!buildAbilityFromRules(user.rules).can('create', subject('Trip', { org_id: scopedOrgId }) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  let totalSeats = data.total_seats;
  if (data.bus_id) {
    const bus = await prisma.bus.findUnique({ where: { id: data.bus_id } });
    if (!bus) throw new AppError('BUS_NOT_FOUND', 404);
    totalSeats = bus.total_seats;
  }
  if (!totalSeats) throw new AppError('TOTAL_SEATS_REQUIRED', 400);

  const org = await prisma.organisation.findUnique({ where: { id: scopedOrgId } });
  if (!org) throw new AppError('ORG_NOT_FOUND', 404);

  const startsOn = new Date(data.starts_on);
  const endsOn = data.ends_on ? new Date(data.ends_on) : null;
  if (endsOn && endsOn.getTime() < startsOn.getTime()) throw new AppError('INVALID_DATE_RANGE', 400);

  // `org` is fetched above; cancellation_allowed flows into each trip via materializeSeries.
  void org;

  const series = await prisma.tripSeries.create({
    data: {
      org_id: scopedOrgId,
      route_id: data.route_id,
      bus_id: data.bus_id ?? null,
      driver_id: data.driver_id ?? null,
      departure_time: data.departure_time,
      frequency_minutes: data.frequency_minutes ?? null,
      repeat_daily: data.repeat_daily ?? false,
      starts_on: startsOn,
      ends_on: endsOn,
      total_seats: totalSeats,
      is_express: data.is_express ?? false,
      status: 'active',
    },
  });

  // Materialize only the rolling horizon up front; the scheduler keeps it topped up.
  const created = await materializeSeries(series, horizonEnd());

  const trips = await prisma.trip.findMany({
    where: { series_id: series.id },
    include: tripWithDetails,
    orderBy: { departure_at: 'asc' },
  });

  // is_only_in_series is a per-series constant — compute it once, not per trip.
  const activeCount = await prisma.trip.count({
    where: { series_id: series.id, status: { not: 'cancelled' } },
  });
  const isOnly = activeCount === 1;
  const tripsWithFlag = trips.map((trip) => ({ ...trip, is_only_in_series: isOnly }));

  setImmediate(() => {
    publishAudit({
      actor_id: user.id,
      action: 'create',
      resource: 'Trip',
      resource_id: series.id,
    });
  });

  return {
    series_id: series.id,
    trips_created: created,
    trips: tripsWithFlag,
  };
};

// Public passenger search payload — only the fields the search-results list needs.
const tripSearchInclude = {
  org: { select: { id: true, name: true, logo_path: true } },
  route: { include: { origin_stop: true, destination_stop: true } },
  bus: { select: { id: true, plate: true, type: true } },
} as const;

const stopBrief = (s: { id: string; name: string; lat: Prisma.Decimal; lng: Prisma.Decimal }) => ({
  id: s.id,
  name: s.name,
  lat: Number(s.lat),
  lng: Number(s.lng),
});

/**
 * Public trip search for the passenger discovery screen. Free-text `q` matches the
 * route name or either endpoint name; `origin_id` and `company_id` narrow further;
 * `date` is a Kigali calendar day (defaults to "from now" when absent). `price` is
 * the full-route "from" fare (origin → destination of the route); the exact stop-pair
 * fare is resolved later once the passenger picks an alighting stop on the detail page.
 */
export const searchTrips = async (params: {
  q?: string;
  origin_id?: string;
  company_id?: string;
  date?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  // "date" is a Kigali calendar day, not a UTC day; absent → upcoming trips from now.
  const departureFilter = params.date
    ? (() => {
        const { start, end } = localDayBoundsUtc(params.date!);
        return { gte: start, lte: end };
      })()
    : { gte: new Date() };

  const where: Prisma.TripWhereInput = {
    status: 'scheduled',
    available_seats: { gte: 1 },
    departure_at: departureFilter,
    org: { status: 'active' },
    ...(params.company_id ? { org_id: params.company_id } : {}),
    route: {
      is_active: true,
      ...(params.origin_id ? { origin_stop_id: params.origin_id } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: 'insensitive' } },
              { origin_stop: { name: { contains: params.q, mode: 'insensitive' } } },
              { destination_stop: { name: { contains: params.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
  };

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: tripSearchInclude,
      orderBy: { departure_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where }),
  ]);

  const data = await Promise.all(
    trips.map(async (trip) => {
      const price = await getEffectivePrice(
        trip.org_id,
        trip.route.origin_stop_id,
        trip.route.destination_stop_id,
      );
      return {
        id: trip.id,
        origin: stopBrief(trip.route.origin_stop),
        destination: stopBrief(trip.route.destination_stop),
        departure_at: trip.departure_at,
        arrival_at: trip.arrival_at,
        price: price?.amount ?? null,
        currency: price?.currency ?? 'RWF',
        available_seats: trip.available_seats,
        total_seats: trip.total_seats,
        company: { id: trip.org.id, name: trip.org.name, logo_path: trip.org.logo_path },
        bus: trip.bus ? { id: trip.bus.id, plate: trip.bus.plate, type: trip.bus.type } : null,
      };
    }),
  );

  return { data, total, page, limit };
};

export const getTripById = async (id: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      ...tripWithDetails,
      series: true,
    },
  });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);

  const siblingCount = trip.series_id
    ? await prisma.trip.count({
        where: { series_id: trip.series_id, status: { not: 'cancelled' } },
      })
    : 1;

  return {
    ...trip,
    series: trip.series
      ? {
          id: trip.series.id,
          frequency_minutes: trip.series.frequency_minutes,
          repeat_daily: trip.series.repeat_daily,
          starts_on: trip.series.starts_on,
          ends_on: trip.series.ends_on,
          is_only_in_series: siblingCount === 1,
        }
      : null,
  };
};

export const listTrips = async (
  user: AuthenticatedUser,
  filters: {
    org_id?: string;
    route_id?: string;
    from?: string;
    to?: string;
    status?: string;
    driver_id?: string;
    unassigned_bus?: boolean;
    unassigned_driver?: boolean;
    page?: number;
    limit?: number;
  },
) => {
  const ability = buildAbilityFromRules(user.rules);
  // Org boundary comes from the caller's Trip rule conditions. Only platform-scope
  // callers may narrow to an arbitrary org via filters.org_id.
  const isPlatform = getScopeFor(ability, 'read', 'Trip') === 'platform';

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.TripWhereInput = {
    AND: [
      accessibleWhere(ability, 'read', 'Trip'),
      ...(isPlatform && filters.org_id ? [{ org_id: filters.org_id }] : []),
      ...(filters.route_id ? [{ route_id: filters.route_id }] : []),
      ...(filters.status ? [{ status: filters.status as never }] : []),
      ...(filters.driver_id ? [{ driver_id: filters.driver_id }] : []),
      ...(filters.unassigned_bus ? [{ bus_id: null }] : []),
      ...(filters.unassigned_driver ? [{ driver_id: null }] : []),
      ...(filters.from || filters.to
        ? [{
            departure_at: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }]
        : []),
    ],
  };

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: tripWithDetails,
      orderBy: { departure_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where }),
  ]);

  return { trips, total, page, limit };
};

type TripPatchInput = Partial<{
  departure_time: string;
  bus_id: string | null;
  driver_id: string | null;
  total_seats: number;
  is_express: boolean;
  cancellation_allowed: boolean;
}>;

/**
 * Translate a client patch into a valid Trip update:
 *  - departure_time (HH:MM, Kigali) → recompute departure_at on the trip's own day
 *    and arrival_at from its duration (departure_time is NOT a Trip column),
 *  - total_seats → reconcile available_seats so booked seats are preserved.
 */
const buildTripPatch = (
  trip: { departure_at: Date; duration_minutes: number | null; total_seats: number; available_seats: number },
  data: TripPatchInput,
): Prisma.TripUncheckedUpdateInput => {
  const patch: Prisma.TripUncheckedUpdateInput = {};
  if (data.bus_id !== undefined) patch.bus_id = data.bus_id;
  if (data.driver_id !== undefined) patch.driver_id = data.driver_id;
  if (data.is_express !== undefined) patch.is_express = data.is_express;
  if (data.cancellation_allowed !== undefined) patch.cancellation_allowed = data.cancellation_allowed;
  if (data.total_seats !== undefined) {
    const booked = trip.total_seats - trip.available_seats;
    patch.total_seats = data.total_seats;
    patch.available_seats = Math.max(0, data.total_seats - booked);
  }
  if (data.departure_time !== undefined) {
    const dep = localWallTimeToUtc(utcToLocalDay(trip.departure_at), data.departure_time);
    patch.departure_at = dep;
    if (trip.duration_minutes) patch.arrival_at = new Date(dep.getTime() + trip.duration_minutes * 60_000);
  }
  return patch;
};

export const updateTrip = async (
  user: AuthenticatedUser,
  id: string,
  scope: 'this' | 'future',
  data: TripPatchInput,
) => {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('update', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  if (scope === 'this') {
    const updated = await prisma.trip.update({
      where: { id },
      data: buildTripPatch(trip, data),
      include: tripWithDetails,
    });

    setImmediate(() => {
      publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
    });

    return { updated: 1, skipped: [], trips: [updated] };
  }

  if (!trip.series_id) throw new AppError('TRIP_NOT_IN_SERIES', 400);

  const futureTrips = await prisma.trip.findMany({
    where: {
      series_id: trip.series_id,
      status: 'scheduled',
      departure_at: { gte: trip.departure_at },
    },
  });

  const updated: string[] = [];
  const skipped: Array<{ trip_id: string; departure_at: Date; reason: string }> = [];

  for (const t of futureTrips) {
    const hasBookings = await prisma.ticket.count({ where: { trip_id: t.id, status: 'confirmed' } });
    if (hasBookings > 0) {
      skipped.push({ trip_id: t.id, departure_at: t.departure_at, reason: 'HAS_BOOKINGS' });
      continue;
    }
    await prisma.trip.update({ where: { id: t.id }, data: buildTripPatch(t, data) });
    updated.push(t.id);
  }

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
  });

  return { updated: updated.length, skipped };
};

/**
 * Cancel one trip and make every confirmed passenger whole: mark their tickets
 * cancelled and emit a refund request (payment-service refunds + notifies) plus a
 * trip.cancelled domain event. Returns how many tickets were refunded.
 */
const cancelOneTrip = async (
  trip: { id: string; org_id: string },
  reason: string | undefined,
): Promise<number> => {
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'cancelled' } });

  const tickets = await prisma.ticket.findMany({ where: { trip_id: trip.id, status: 'confirmed' } });
  for (const tk of tickets) {
    await prisma.ticket.update({
      where: { id: tk.id },
      data: { status: 'cancelled', cancelled_at: new Date(), cancellation_reason: reason ?? 'TRIP_CANCELLED' },
    });
    publishRefundRequested({
      ticket_id: tk.id,
      original_payment_ref: tk.payment_ref,
      ticket_price: tk.ticket_price,
      user_id: tk.user_id,
      phone: tk.passenger_phone,
      payment_method: tk.payment_method,
      reason: 'TRIP_CANCELLED',
    });
  }

  publishTripEvent({ type: 'trip.cancelled', trip_id: trip.id, org_id: trip.org_id, reason });
  return tickets.length;
};

export const cancelTrip = async (
  user: AuthenticatedUser,
  id: string,
  scope: 'this' | 'future',
  reason?: string,
) => {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('cancel', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  if (scope === 'this') {
    const refunded = await cancelOneTrip(trip, reason);
    setImmediate(() => {
      publishAudit({ actor_id: user.id, action: 'cancel', resource: 'Trip', resource_id: id, delta: reason ? { reason: { from: null, to: reason } } : undefined });
    });
    return { cancelled: 1, refunded };
  }

  if (!trip.series_id) throw new AppError('TRIP_NOT_IN_SERIES', 400);

  // Cancel this and every later scheduled instance, refunding confirmed passengers
  // on each — no silent skipping that would strand paying riders.
  const futureTrips = await prisma.trip.findMany({
    where: {
      series_id: trip.series_id,
      status: 'scheduled',
      departure_at: { gte: trip.departure_at },
    },
  });

  let refunded = 0;
  for (const t of futureTrips) {
    refunded += await cancelOneTrip(t, reason);
  }
  // Pause the series so the scheduler stops materializing new instances.
  await prisma.tripSeries.update({ where: { id: trip.series_id }, data: { status: 'paused' } });

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'cancel', resource: 'Trip', resource_id: id, delta: reason ? { reason: { from: null, to: reason } } : undefined });
  });

  return { cancelled: futureTrips.length, refunded };
};

export const activateTrip = async (user: AuthenticatedUser, id: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      tickets: {
        where: { status: 'confirmed' },
        include: { boarding_stop: true, alighting_stop: true },
      },
      bus: true,
      route: true,
    },
  });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('update', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  await prisma.trip.update({ where: { id }, data: { status: 'active' } });

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
  });

  return { id };
};

export const completeTrip = async (user: AuthenticatedUser, id: string) => {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('update', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  await prisma.trip.update({ where: { id }, data: { status: 'completed' } });

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
  });

  return { id };
};
