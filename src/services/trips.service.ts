import { prisma } from '../models/index.js';
import type { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { publishAudit } from '../utils/publishers.js';
import { subject } from '@casl/ability';
import { buildAbilityFromRules, getScopeFor, accessibleWhere } from '../utils/ability.js';
import type { AuthenticatedUser, Subjects } from '../utils/ability.js';

const VALID_FREQUENCIES = [null, 30, 60, 90, 120, 180, 240];
const END_OF_DAY_HOUR = 22;
const GENERATE_DAYS_AHEAD = 90;

const parseDepartureTime = (timeStr: string, baseDate: Date): Date => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
  return d;
};

const generateTripInstances = (
  seriesId: string,
  orgId: string,
  routeId: string,
  busId: string | null | undefined,
  driverId: string | null | undefined,
  totalSeats: number,
  cancellationAllowed: boolean,
  departureTime: string,
  frequencyMinutes: number | null,
  repeatDaily: boolean,
  startsOn: Date,
  endsOn: Date | null,
  isExpress: boolean,
): Prisma.TripCreateManyInput[] => {
  const trips: Prisma.TripCreateManyInput[] = [];

  const endDate = repeatDaily
    ? endsOn
      ? new Date(endsOn)
      : new Date(Date.now() + GENERATE_DAYS_AHEAD * 24 * 60 * 60 * 1000)
    : new Date(startsOn);

  let currentDate = new Date(startsOn);

  while (currentDate <= endDate) {
    const departureTimes: Date[] = [];
    const firstDeparture = parseDepartureTime(departureTime, currentDate);

    if (!frequencyMinutes) {
      departureTimes.push(firstDeparture);
    } else {
      let t = new Date(firstDeparture);
      const endOfDay = new Date(currentDate);
      endOfDay.setUTCHours(END_OF_DAY_HOUR, 0, 0, 0);
      while (t <= endOfDay) {
        departureTimes.push(new Date(t));
        t = new Date(t.getTime() + frequencyMinutes * 60 * 1000);
      }
    }

    for (const depAt of departureTimes) {
      trips.push({
        org_id: orgId,
        route_id: routeId,
        bus_id: repeatDaily ? null : (busId ?? null),
        driver_id: repeatDaily ? null : (driverId ?? null),
        series_id: seriesId,
        departure_at: depAt,
        total_seats: totalSeats,
        available_seats: totalSeats,
        status: 'scheduled',
        cancellation_allowed: cancellationAllowed,
        is_express: isExpress,
      });
    }

    if (!repeatDaily) break;
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return trips;
};

const tripWithDetails = {
  org: { select: { id: true, name: true, slug: true, logo_path: true, story: true } },
  route: { include: { route_stops: { include: { stop: true }, orderBy: { order: 'asc' as const } } } },
  bus: { select: { id: true, plate: true, type: true } },
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
} as const;

const isOnlyInSeries = (seriesId: string | null): Prisma.TripWhereInput =>
  seriesId
    ? {}
    : {};

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

  const scopedOrgId = user.org_id ?? route.org_id;
  if (!buildAbilityFromRules(user.rules).can('create', subject('Trip', { org_id: route.org_id }) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

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

  const tripInputs = generateTripInstances(
    series.id,
    scopedOrgId,
    data.route_id,
    data.bus_id,
    data.driver_id,
    totalSeats,
    org.cancellation_allowed,
    data.departure_time,
    data.frequency_minutes ?? null,
    data.repeat_daily ?? false,
    startsOn,
    endsOn,
    data.is_express ?? false,
  );

  await prisma.trip.createMany({ data: tripInputs });

  const trips = await prisma.trip.findMany({
    where: { series_id: series.id },
    include: tripWithDetails,
    orderBy: { departure_at: 'asc' },
  });

  const tripsWithFlag = await Promise.all(
    trips.map(async (trip) => {
      const siblingCount = await prisma.trip.count({
        where: {
          series_id: series.id,
          status: { not: 'cancelled' },
        },
      });
      return { ...trip, is_only_in_series: siblingCount === 1 };
    }),
  );

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
    trips_created: trips.length,
    trips: tripsWithFlag,
  };
};

export const searchTrips = async (params: {
  boarding_stop_id: string;
  alighting_stop_id: string;
  date: string;
  seats: number;
}) => {
  const dateStart = new Date(params.date);
  dateStart.setUTCHours(0, 0, 0, 0);
  const dateEnd = new Date(params.date);
  dateEnd.setUTCHours(23, 59, 59, 999);

  const routes = await prisma.route.findMany({
    where: {
      is_active: true,
      route_stops: {
        some: { stop_id: params.boarding_stop_id },
      },
    },
    include: {
      route_stops: { orderBy: { order: 'asc' } },
    },
  });

  const validRouteIds = routes
    .filter((r) => {
      const stops = r.route_stops;
      const boardingOrder = stops.find((s) => s.stop_id === params.boarding_stop_id)?.order ?? -1;
      const alightingOrder = stops.find((s) => s.stop_id === params.alighting_stop_id)?.order ?? -1;
      return boardingOrder > 0 && alightingOrder > 0 && boardingOrder < alightingOrder;
    })
    .map((r) => r.id);

  if (validRouteIds.length === 0) return [];

  const trips = await prisma.trip.findMany({
    where: {
      route_id: { in: validRouteIds },
      status: 'scheduled',
      departure_at: { gte: dateStart, lte: dateEnd },
      available_seats: { gte: params.seats },
      org: { status: 'active' },
    },
    include: tripWithDetails,
    orderBy: { departure_at: 'asc' },
  });

  const tripsWithExtras = await Promise.all(
    trips.map(async (trip) => {
      const price = await prisma.price.findUnique({
        where: {
          boarding_stop_id_alighting_stop_id: {
            boarding_stop_id: params.boarding_stop_id,
            alighting_stop_id: params.alighting_stop_id,
          },
        },
      });

      const siblingCount = trip.series_id
        ? await prisma.trip.count({
            where: { series_id: trip.series_id, status: { not: 'cancelled' } },
          })
        : 1;

      return {
        ...trip,
        price: price ? { amount: price.amount, currency: price.currency } : null,
        series: {
          is_only_in_series: siblingCount === 1,
        },
      };
    }),
  );

  return tripsWithExtras;
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

export const updateTrip = async (
  user: AuthenticatedUser,
  id: string,
  scope: 'this' | 'future',
  data: Partial<{
    departure_time: string;
    bus_id: string | null;
    driver_id: string | null;
    total_seats: number;
    is_express: boolean;
    cancellation_allowed: boolean;
  }>,
) => {
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);
  if (!buildAbilityFromRules(user.rules).can('update', subject('Trip', trip) as unknown as Subjects)) throw new AppError('FORBIDDEN', 403);

  if (scope === 'this') {
    const updated = await prisma.trip.update({
      where: { id },
      data,
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
    await prisma.trip.update({ where: { id: t.id }, data });
    updated.push(t.id);
  }

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'update', resource: 'Trip', resource_id: id });
  });

  return { updated: updated.length, skipped };
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
    await prisma.trip.update({ where: { id }, data: { status: 'cancelled' } });

    setImmediate(() => {
      publishAudit({ actor_id: user.id, action: 'cancel', resource: 'Trip', resource_id: id });
    });

    return { deleted: 1, skipped: [] };
  }

  if (!trip.series_id) throw new AppError('TRIP_NOT_IN_SERIES', 400);

  const futureTrips = await prisma.trip.findMany({
    where: {
      series_id: trip.series_id,
      status: 'scheduled',
      departure_at: { gte: trip.departure_at },
    },
  });

  const deleted: string[] = [];
  const skipped: Array<{ trip_id: string; departure_at: Date; reason: string }> = [];

  for (const t of futureTrips) {
    const hasBookings = await prisma.ticket.count({ where: { trip_id: t.id, status: 'confirmed' } });
    if (hasBookings > 0) {
      skipped.push({ trip_id: t.id, departure_at: t.departure_at, reason: 'HAS_BOOKINGS' });
      continue;
    }
    await prisma.trip.update({ where: { id: t.id }, data: { status: 'cancelled' } });
    deleted.push(t.id);
  }

  setImmediate(() => {
    publishAudit({ actor_id: user.id, action: 'cancel', resource: 'Trip', resource_id: id, delta: reason ? { reason: { from: null, to: reason } } : undefined });
  });

  return { deleted: deleted.length, skipped };
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

// Suppress unused import warning
void isOnlyInSeries;
