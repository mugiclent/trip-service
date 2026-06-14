import { prisma } from '../models/index.js';
import type { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { publishAudit } from '../utils/publishers.js';
import { subject } from '@casl/ability';
import { buildAbilityFromRules, getScopeFor, accessibleWhere } from '../utils/ability.js';
import type { AuthenticatedUser, Subjects } from '../utils/ability.js';
import { getEffectivePrice } from './prices.service.js';
import { materializeSeries, horizonEnd } from './scheduling.js';
import { localDayBoundsUtc } from '../utils/time.js';

const VALID_FREQUENCIES = [null, 30, 60, 90, 120, 180, 240];

// Calendar/management payload — the tile shape the staff trips screen renders.
const calendarTripInclude = {
  series: true,
  bus: { select: { id: true, plate: true, type: true } },
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
  route: { select: { id: true, name: true } },
} as const;

type CalendarTripRow = Prisma.TripGetPayload<{ include: typeof calendarTripInclude }>;

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const serializeCalendarTrip = (trip: CalendarTripRow, isOnlyInSeries: boolean) => ({
  id: trip.id,
  departure_at: trip.departure_at,
  status: trip.status,
  is_express: trip.is_express,
  total_seats: trip.total_seats,
  booked_seats: trip.total_seats - trip.available_seats,
  remaining_seats: trip.available_seats,
  series: trip.series
    ? {
        id: trip.series.id,
        frequency_minutes: trip.series.frequency_minutes,
        repeat_daily: trip.series.repeat_daily,
        starts_on: dateOnly(trip.series.starts_on),
        ends_on: dateOnly(trip.series.ends_on),
        is_only_in_series: isOnlyInSeries,
      }
    : null,
  bus: trip.bus ? { id: trip.bus.id, plate: trip.bus.plate, type: trip.bus.type } : null,
  driver: trip.driver
    ? {
        id: trip.driver.id,
        first_name: trip.driver.first_name,
        last_name: trip.driver.last_name,
        avatar_path: trip.driver.avatar_path,
      }
    : null,
  route: { id: trip.route.id, name: trip.route.name },
});

// is_only_in_series is a per-series constant (active instances === 1). Resolve it
// for a batch of trips with one grouped count rather than a query per trip.
const seriesOnlyResolver = async (
  trips: { series_id: string | null }[],
): Promise<(seriesId: string | null) => boolean> => {
  const ids = [...new Set(trips.map((t) => t.series_id).filter((s): s is string => !!s))];
  const counts = ids.length
    ? await prisma.trip.groupBy({
        by: ['series_id'],
        where: { series_id: { in: ids }, status: { not: 'cancelled' } },
        _count: { _all: true },
      })
    : [];
  const bySeries = new Map(counts.map((c) => [c.series_id, c._count._all]));
  return (seriesId) => (seriesId ? (bySeries.get(seriesId) ?? 1) === 1 : true);
};

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

  // A repeating series (multi-day span or intra-day frequency) has its bus/driver
  // assigned per trip after creation — ignore anything provided here.
  const isRepeating = (data.repeat_daily ?? false) || data.frequency_minutes != null;
  const busId = isRepeating ? null : data.bus_id ?? null;
  const driverId = isRepeating ? null : data.driver_id ?? null;

  let totalSeats = data.total_seats;
  if (busId) {
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) throw new AppError('BUS_NOT_FOUND', 404);
    totalSeats = bus.total_seats; // auto-populate from capacity (editable client-side)
  }
  if (!totalSeats) throw new AppError('TOTAL_SEATS_REQUIRED', 422);

  if (driverId) {
    const driver = await prisma.staffUser.findFirst({ where: { id: driverId, org_id: scopedOrgId } });
    if (!driver) throw new AppError('DRIVER_NOT_FOUND', 404);
  }

  const org = await prisma.organisation.findUnique({ where: { id: scopedOrgId } });
  if (!org) throw new AppError('ORG_NOT_FOUND', 404);

  const startsOn = new Date(data.starts_on);
  const endsOn = data.ends_on ? new Date(data.ends_on) : null;
  if (endsOn && endsOn.getTime() < startsOn.getTime()) throw new AppError('INVALID_DATE_RANGE', 422);

  // `org` is fetched above; cancellation_allowed flows into each trip via materializeSeries.
  void org;

  const series = await prisma.tripSeries.create({
    data: {
      org_id: scopedOrgId,
      route_id: data.route_id,
      bus_id: busId,
      driver_id: driverId,
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
    include: calendarTripInclude,
    orderBy: { departure_at: 'asc' },
  });

  // Freshly created — every instance belongs to this one series, so is_only_in_series
  // is simply whether the series produced a single trip.
  const isOnly = trips.length === 1;

  setImmediate(() => {
    publishAudit({
      actor_id: user.id,
      action: 'create',
      resource: 'Trip',
      resource_id: series.id,
    });
  });

  return {
    trips_created: created,
    trips: trips.map((trip) => serializeCalendarTrip(trip, isOnly)),
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

// Trip detail include — a superset serving both the staff detail view (status,
// series, driver, occupancy) and the passenger view (origin/destination, ordered
// stops, operator with story).
const tripDetailInclude = {
  series: true,
  bus: { select: { id: true, plate: true, type: true } },
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
  org: { select: { id: true, name: true, logo_path: true, story: true } },
  route: {
    select: {
      id: true,
      name: true,
      origin_stop: { select: { id: true, name: true, lat: true, lng: true } },
      destination_stop: { select: { id: true, name: true, lat: true, lng: true } },
      route_stops: {
        select: { id: true, order: true, stop: { select: { id: true, name: true, lat: true, lng: true } } },
        orderBy: { order: 'asc' as const },
      },
    },
  },
} as const;

export const getTripById = async (id: string) => {
  const trip = await prisma.trip.findUnique({ where: { id }, include: tripDetailInclude });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);

  const isOnly = await seriesOnlyResolver([trip]);
  return {
    id: trip.id,
    is_express: trip.is_express,
    departure_at: trip.departure_at,
    status: trip.status,
    currency: 'RWF',
    total_seats: trip.total_seats,
    available_seats: trip.available_seats,
    booked_seats: trip.total_seats - trip.available_seats,
    remaining_seats: trip.available_seats,
    origin: stopBrief(trip.route.origin_stop),
    destination: stopBrief(trip.route.destination_stop),
    route: { id: trip.route.id, name: trip.route.name },
    company: trip.org
      ? { id: trip.org.id, name: trip.org.name, logo_path: trip.org.logo_path, story: trip.org.story }
      : null,
    bus: trip.bus ? { id: trip.bus.id, plate: trip.bus.plate, type: trip.bus.type } : null,
    driver: trip.driver
      ? { id: trip.driver.id, first_name: trip.driver.first_name, last_name: trip.driver.last_name, avatar_path: trip.driver.avatar_path }
      : null,
    series: trip.series
      ? {
          id: trip.series.id,
          frequency_minutes: trip.series.frequency_minutes,
          repeat_daily: trip.series.repeat_daily,
          starts_on: dateOnly(trip.series.starts_on),
          ends_on: dateOnly(trip.series.ends_on),
          is_only_in_series: isOnly(trip.series_id),
        }
      : null,
    stops: trip.route.route_stops.map((rs) => ({
      id: rs.stop.id,
      name: rs.stop.name,
      lat: Number(rs.stop.lat),
      lng: Number(rs.stop.lng),
      order: rs.order,
    })),
    created_at: trip.created_at,
    updated_at: trip.updated_at,
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
    unassigned_only?: boolean;
    page?: number;
    limit?: number;
  },
) => {
  const ability = buildAbilityFromRules(user.rules);
  // Org boundary comes from the caller's Trip rule conditions. Only platform-scope
  // callers may narrow to an arbitrary org via filters.org_id.
  const isPlatform = getScopeFor(ability, 'read', 'Trip') === 'platform';

  // Query params arrive as strings — coerce defensively.
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;
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
      ...(filters.unassigned_only ? [{ OR: [{ bus_id: null }, { driver_id: null }] }] : []),
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
      include: calendarTripInclude,
      orderBy: { departure_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where }),
  ]);

  const isOnly = await seriesOnlyResolver(trips);
  return { data: trips.map((t) => serializeCalendarTrip(t, isOnly(t.series_id))), total, page, limit };
};

type TripPatchInput = Partial<{
  departure_at: string;
  bus_id: string | null;
  driver_id: string | null;
  total_seats: number;
  is_express: boolean;
  cancellation_allowed: boolean;
}>;

/**
 * Translate a client patch into a valid Trip update:
 *  - departure_at (absolute ISO) → set directly and recompute arrival_at from duration,
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
  if (data.departure_at !== undefined) {
    const dep = new Date(data.departure_at);
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

  // Validate any (re)assignment up front so a bad id fails before mutating anything.
  if (data.bus_id) {
    const bus = await prisma.bus.findUnique({ where: { id: data.bus_id } });
    if (!bus) throw new AppError('BUS_NOT_FOUND', 404);
  }
  if (data.driver_id) {
    const driver = await prisma.staffUser.findFirst({ where: { id: data.driver_id, org_id: trip.org_id } });
    if (!driver) throw new AppError('DRIVER_NOT_FOUND', 404);
  }

  if (scope === 'this') {
    // A trip with confirmed passengers is frozen — no edits, including reassignment.
    const booked = await prisma.ticket.count({ where: { trip_id: id, status: 'confirmed' } });
    if (booked > 0) throw new AppError('HAS_BOOKINGS', 400);

    const updated = await prisma.trip.update({
      where: { id },
      data: buildTripPatch(trip, data),
      include: calendarTripInclude,
    });

    setImmediate(() => {
      publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
    });

    const isOnly = await seriesOnlyResolver([updated]);
    return serializeCalendarTrip(updated, isOnly(updated.series_id));
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

// A trip is removable only when it has no confirmed passengers. Dead ticket rows
// (failed/expired/initiated) have no booking to honour but still FK-reference the
// trip, so they're cleared in the same transaction before the row is deleted.
const hardDeleteTrip = async (tripId: string): Promise<void> => {
  await prisma.$transaction([
    prisma.ticket.deleteMany({ where: { trip_id: tripId } }),
    prisma.trip.delete({ where: { id: tripId } }),
  ]);
};

const hasConfirmedBookings = async (tripId: string): Promise<boolean> =>
  (await prisma.ticket.count({ where: { trip_id: tripId, status: 'confirmed' } })) > 0;

/**
 * Hard-delete a trip (scope 'this') or this and every later scheduled instance in
 * the series (scope 'future'). Trips with confirmed bookings are never deleted: a
 * single booked trip throws HAS_BOOKINGS; in a series they are collected into
 * `skipped`. No refunds are issued — booked trips must run their course.
 */
export const deleteTrip = async (
  user: AuthenticatedUser,
  id: string,
  scope: 'this' | 'future',
): Promise<null | { deleted: number; skipped: Array<{ trip_id: string; departure_at: Date; reason: string }> }> => {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('cancel', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  if (scope === 'this') {
    if (await hasConfirmedBookings(id)) throw new AppError('HAS_BOOKINGS', 400);
    await hardDeleteTrip(id);
    setImmediate(() => {
      publishAudit({ actor_id: user.id, action: 'delete', resource: 'Trip', resource_id: id });
    });
    return null;
  }

  if (!trip.series_id) throw new AppError('TRIP_NOT_IN_SERIES', 400);

  const futureTrips = await prisma.trip.findMany({
    where: {
      series_id: trip.series_id,
      status: 'scheduled',
      departure_at: { gte: trip.departure_at },
    },
    orderBy: { departure_at: 'asc' },
  });

  const skipped: Array<{ trip_id: string; departure_at: Date; reason: string }> = [];
  let deleted = 0;
  for (const t of futureTrips) {
    if (await hasConfirmedBookings(t.id)) {
      skipped.push({ trip_id: t.id, departure_at: t.departure_at, reason: 'HAS_BOOKINGS' });
      continue;
    }
    await hardDeleteTrip(t.id);
    deleted++;
  }
  // Pause the series so the scheduler stops re-materializing the deleted instances.
  await prisma.tripSeries.update({ where: { id: trip.series_id }, data: { status: 'paused' } });

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'delete', resource: 'Trip', resource_id: id });
  });

  return { deleted, skipped };
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
