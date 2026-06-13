import { prisma } from '../models/index.js';
import type { Prisma, TripSeries } from '../models/index.js';
import { haversineKm } from '../data/network.js';
import { localWallTimeToUtc, utcToLocalDay, addLocalDays } from '../utils/time.js';

/**
 * Advance scheduling. A TripSeries is a recurrence template; trip instances are
 * materialized on a ROLLING horizon by the scheduler (see workers/scheduler.worker.ts)
 * rather than all at once. `materialized_until` records how far ahead a series has
 * been generated; each run produces only the next (materialized_until, horizon] slice,
 * which makes generation idempotent and bounded.
 */

export const HORIZON_DAYS = 60;        // how far ahead instances are kept materialized
export const SCHEDULE_END_HOUR = 22;   // last departure hour (local) for frequency series
const CREATE_BATCH = 500;

export const horizonEnd = (): Date => new Date(Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

/**
 * Every departure instant (UTC) for a series within the half-open window
 * (fromUtc, toUtc]. Honours starts_on/ends_on (local calendar days), single vs
 * frequency cadence, and repeat_daily. Bounded by `toUtc` so open-ended series
 * never loop unboundedly.
 */
export const enumerateDepartures = (
  series: Pick<TripSeries, 'departure_time' | 'frequency_minutes' | 'repeat_daily' | 'starts_on' | 'ends_on'>,
  fromUtc: Date,
  toUtc: Date,
): Date[] => {
  const result: Date[] = [];
  const startDay = new Date(series.starts_on); // @db.Date → local-day at UTC midnight
  const horizonDay = utcToLocalDay(toUtc);
  const lastDay = series.repeat_daily
    ? (series.ends_on ? new Date(series.ends_on) : horizonDay)
    : startDay;

  for (let day = startDay; day.getTime() <= lastDay.getTime(); day = addLocalDays(day, 1)) {
    const first = localWallTimeToUtc(day, series.departure_time);
    if (first.getTime() > toUtc.getTime()) break; // whole day is beyond the horizon

    const dayTimes: Date[] = [];
    if (!series.frequency_minutes) {
      dayTimes.push(first);
    } else {
      const endOfDay = localWallTimeToUtc(day, `${SCHEDULE_END_HOUR}:00`);
      for (let t = first; t.getTime() <= endOfDay.getTime(); t = new Date(t.getTime() + series.frequency_minutes * 60_000)) {
        dayTimes.push(t);
      }
    }

    for (const t of dayTimes) {
      if (t.getTime() > fromUtc.getTime() && t.getTime() <= toUtc.getTime()) result.push(t);
    }
  }

  return result;
};

const durationCache = new Map<string, number | null>();

/** Estimated trip duration (minutes) from a route's ordered stops: ~45 km/h + dwell. */
export const computeRouteDurationMin = async (routeId: string): Promise<number | null> => {
  if (durationCache.has(routeId)) return durationCache.get(routeId)!;
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { route_stops: { include: { stop: true }, orderBy: { order: 'asc' } } },
  });
  let duration: number | null = null;
  if (route && route.route_stops.length >= 2) {
    let km = 0;
    const rs = route.route_stops;
    for (let i = 1; i < rs.length; i++) {
      km += haversineKm(
        [Number(rs[i - 1].stop.lat), Number(rs[i - 1].stop.lng)],
        [Number(rs[i].stop.lat), Number(rs[i].stop.lng)],
      );
    }
    duration = Math.round((km / 45) * 60) + 15;
  }
  durationCache.set(routeId, duration);
  return duration;
};

/**
 * Materialize the next slice of a series up to `until`, then advance
 * materialized_until. Idempotent: only departures after the previous horizon are
 * created, so re-running never duplicates. Returns the number of trips created.
 */
export const materializeSeries = async (series: TripSeries, until: Date = horizonEnd()): Promise<number> => {
  const from = series.materialized_until ?? new Date(new Date(series.starts_on).getTime() - 1);
  if (from.getTime() >= until.getTime()) return 0;

  const departures = enumerateDepartures(series, from, until);
  let created = 0;

  if (departures.length > 0) {
    const durationMin = await computeRouteDurationMin(series.route_id);
    const org = await prisma.organisation.findUnique({ where: { id: series.org_id } });
    const cancellationAllowed = org?.cancellation_allowed ?? false;

    const rows: Prisma.TripCreateManyInput[] = departures.map((dep) => ({
      org_id: series.org_id,
      route_id: series.route_id,
      bus_id: series.repeat_daily ? null : series.bus_id,
      driver_id: series.repeat_daily ? null : series.driver_id,
      series_id: series.id,
      departure_at: dep,
      arrival_at: durationMin ? new Date(dep.getTime() + durationMin * 60_000) : null,
      duration_minutes: durationMin,
      total_seats: series.total_seats,
      available_seats: series.total_seats,
      status: 'scheduled',
      cancellation_allowed: cancellationAllowed,
      is_express: series.is_express,
    }));

    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      const batch = rows.slice(i, i + CREATE_BATCH);
      await prisma.trip.createMany({ data: batch });
      created += batch.length;
    }
  }

  await prisma.tripSeries.update({ where: { id: series.id }, data: { materialized_until: until } });
  return created;
};
