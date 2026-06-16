import { prisma, Prisma } from '../models/index.js';
import { getRedisClient } from '../loaders/redis.js';
import { buildAbilityFromRules, getScopeFor } from '../utils/ability.js';
import type { AuthenticatedUser } from '../utils/ability.js';
import { AppError } from '../utils/AppError.js';

// ── contract ────────────────────────────────────────────────────────────────────────────
export type AnalyticsPeriod = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
export type PeakGranularity = 'hour' | 'day';

export interface AnalyticsQuery {
  period: AnalyticsPeriod;
  from?: string; // YYYY-MM-DD, required for custom
  to?: string;   // YYYY-MM-DD, required for custom
  tz: string;    // IANA, e.g. Africa/Kigali
  org_id?: string;
  peak: PeakGranularity;
  compare: boolean;
}

const CACHE_TTL_SECONDS = 45;

// Money/sold/revenue count only settled tickets, timed by when payment cleared.
// (Postgres auto-casts the literal to the TicketStatus enum.)
const CONFIRMED = Prisma.sql`t.status = 'confirmed'`;

// Resolve the caller's org boundary from their Report rule, mirroring the list endpoints:
// platform-admin sees all orgs (optionally narrowed by ?org_id), org staff are pinned to
// their own org and may not cross into another.
const resolveOrgScope = (user: AuthenticatedUser, requestedOrgId?: string): string | null => {
  const scope = getScopeFor(buildAbilityFromRules(user.rules), 'read', 'Report');
  if (scope === 'platform') return requestedOrgId ?? null; // null ⇒ all operators
  if (!user.org_id) throw new AppError('FORBIDDEN', 403);
  return user.org_id;
};

const orgCond = (alias: string, orgId: string | null): Prisma.Sql =>
  orgId ? Prisma.sql` AND ${Prisma.raw(alias)}.org_id = ${orgId}` : Prisma.empty;

// Window bounds as UTC wall-clock timestamps (matching the timestamp-without-tz columns,
// which store UTC). All period maths is done in the operator's tz so "today"/week/month
// boundaries are local, then converted back to UTC for the column comparison. `prev_*` is
// the immediately preceding equal-length window, used for the ±% deltas.
const boundsCte = (q: AnalyticsQuery): Prisma.Sql => {
  const { period, tz } = q;
  const from = q.from ?? null;
  const to = q.to ?? null;
  return Prisma.sql`
    bounds AS (
      SELECT
        ((cf AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')                       AS cur_from,
        ((ct AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')                       AS cur_to,
        (((cf - (ct - cf)) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')         AS prev_from,
        ((cf AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')                       AS prev_to
      FROM (
        SELECT
          CASE ${period}
            WHEN 'today'      THEN date_trunc('day',   now() AT TIME ZONE ${tz})
            WHEN 'yesterday'  THEN date_trunc('day',   now() AT TIME ZONE ${tz}) - interval '1 day'
            WHEN 'this_week'  THEN date_trunc('week',  now() AT TIME ZONE ${tz})
            WHEN 'this_month' THEN date_trunc('month', now() AT TIME ZONE ${tz})
            ELSE ${from}::timestamp
          END AS cf,
          CASE ${period}
            WHEN 'today'      THEN date_trunc('day',   now() AT TIME ZONE ${tz}) + interval '1 day'
            WHEN 'yesterday'  THEN date_trunc('day',   now() AT TIME ZONE ${tz})
            WHEN 'this_week'  THEN date_trunc('week',  now() AT TIME ZONE ${tz}) + interval '1 week'
            WHEN 'this_month' THEN date_trunc('month', now() AT TIME ZONE ${tz}) + interval '1 month'
            ELSE ${to}::timestamp + interval '1 day'
          END AS ct
      ) x
    )`;
};

// Local-tz wall clock of a UTC-stored column, for hour-of-day / day-of-week bucketing.
const localTz = (col: string, tz: string): Prisma.Sql =>
  Prisma.sql`((${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;

const n = (v: unknown): number => Number(v ?? 0);
const pct = (cur: number, prev: number): number =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0;
const share = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

interface SummaryRow { sold_cur: bigint; rev_cur: bigint; sold_prev: bigint; rev_prev: bigint; cur_from: string; cur_to: string }
interface CapacityRow { seats_cur: bigint; avail_cur: bigint; seats_prev: bigint }
interface RouteRow { route_id: string; name: string; amount: bigint; tickets: bigint }
interface PeakRow { bucket: number; count: bigint }

// Reject an unknown IANA zone before it reaches Postgres (which would 500 on
// `AT TIME ZONE 'bad'`). Intl throws RangeError for anything it doesn't recognise.
const assertValidTz = (tz: string): void => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new AppError('INVALID_TIMEZONE', 422, `Unknown time zone: ${tz}`);
  }
};

const buildOverview = async (user: AuthenticatedUser, q: AnalyticsQuery) => {
  assertValidTz(q.tz);
  const orgId = resolveOrgScope(user, q.org_id);
  const b = boundsCte(q);
  const org = (alias: string) => orgCond(alias, orgId);

  // 1. summary cards (sold + revenue, current vs previous) + the resolved window for display
  const [summary] = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH ${b}
    SELECT
      count(*) FILTER (WHERE t.confirmed_at >= bounds.cur_from  AND t.confirmed_at < bounds.cur_to)               AS sold_cur,
      coalesce(sum(t.ticket_price) FILTER (WHERE t.confirmed_at >= bounds.cur_from  AND t.confirmed_at < bounds.cur_to), 0)  AS rev_cur,
      count(*) FILTER (WHERE t.confirmed_at >= bounds.prev_from AND t.confirmed_at < bounds.prev_to)              AS sold_prev,
      coalesce(sum(t.ticket_price) FILTER (WHERE t.confirmed_at >= bounds.prev_from AND t.confirmed_at < bounds.prev_to), 0) AS rev_prev,
      to_char(min(bounds.cur_from), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cur_from,
      to_char(min(bounds.cur_to),   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cur_to
    FROM bounds LEFT JOIN tickets t
      ON ${CONFIRMED} AND t.confirmed_at >= bounds.prev_from AND t.confirmed_at < bounds.cur_to ${org('t')}
  `);

  // 2. seat capacity for the trips operating in the window
  const [cap] = await prisma.$queryRaw<CapacityRow[]>(Prisma.sql`
    WITH ${b}
    SELECT
      coalesce(sum(tr.total_seats)     FILTER (WHERE tr.departure_at >= bounds.cur_from  AND tr.departure_at < bounds.cur_to),  0) AS seats_cur,
      coalesce(sum(tr.available_seats) FILTER (WHERE tr.departure_at >= bounds.cur_from  AND tr.departure_at < bounds.cur_to),  0) AS avail_cur,
      coalesce(sum(tr.total_seats)     FILTER (WHERE tr.departure_at >= bounds.prev_from AND tr.departure_at < bounds.prev_to), 0) AS seats_prev
    FROM bounds LEFT JOIN trips tr
      ON tr.departure_at >= bounds.prev_from AND tr.departure_at < bounds.cur_to ${org('tr')}
  `);

  // 3. revenue + ticket count per route (one pass; reused for revenue_by_route & top_destinations)
  const routes = await prisma.$queryRaw<RouteRow[]>(Prisma.sql`
    WITH ${b}
    SELECT r.id AS route_id, r.name,
           coalesce(sum(t.ticket_price), 0) AS amount,
           count(*)                         AS tickets
    FROM tickets t
      JOIN trips tr  ON tr.id = t.trip_id
      JOIN routes r  ON r.id  = tr.route_id
      CROSS JOIN bounds
    WHERE ${CONFIRMED} AND t.confirmed_at >= bounds.cur_from AND t.confirmed_at < bounds.cur_to ${org('t')}
    GROUP BY r.id, r.name
    ORDER BY amount DESC
  `);

  // 4. peak booking times — hour-of-day (0-23) or ISO day-of-week (1-7), by booking time
  const bucket = q.peak === 'day'
    ? Prisma.sql`extract(isodow FROM ${localTz('t.created_at', q.tz)})::int`
    : Prisma.sql`extract(hour   FROM ${localTz('t.created_at', q.tz)})::int`;
  const peaks = await prisma.$queryRaw<PeakRow[]>(Prisma.sql`
    WITH ${b}
    SELECT ${bucket} AS bucket, count(*) AS count
    FROM tickets t CROSS JOIN bounds
    WHERE ${CONFIRMED} AND t.created_at >= bounds.cur_from AND t.created_at < bounds.cur_to ${org('t')}
    GROUP BY bucket
    ORDER BY bucket
  `);

  const revenueTotal = routes.reduce((s, r) => s + n(r.amount), 0);

  return {
    period: { label: q.period, from: summary?.cur_from ?? null, to: summary?.cur_to ?? null, tz: q.tz },
    scope: orgId ? { org_id: orgId } : { org_id: null }, // null ⇒ all operators (platform)
    summary: {
      sold_tickets: { value: n(summary?.sold_cur), ...(q.compare ? { delta_pct: pct(n(summary?.sold_cur), n(summary?.sold_prev)) } : {}) },
      revenue: { value: n(summary?.rev_cur), currency: 'RWF', ...(q.compare ? { delta_pct: pct(n(summary?.rev_cur), n(summary?.rev_prev)) } : {}) },
      capacity: {
        total_seats: n(cap?.seats_cur),
        available: n(cap?.avail_cur),
        ...(q.compare ? { delta_pct: pct(n(cap?.seats_cur), n(cap?.seats_prev)) } : {}),
      },
    },
    revenue_by_route: routes.map((r) => ({
      route_id: r.route_id,
      name: r.name,
      amount: n(r.amount),
      pct: share(n(r.amount), revenueTotal),
    })),
    revenue_total: revenueTotal,
    top_destinations: [...routes]
      .sort((a, bb) => n(bb.tickets) - n(a.tickets))
      .slice(0, 5)
      .map((r) => ({ route_id: r.route_id, name: r.name, tickets: n(r.tickets) })),
    peak_times: {
      granularity: q.peak,
      buckets: peaks.map((p) => ({ bucket: p.bucket, count: n(p.count) })),
    },
  };
};

export const getOverview = async (user: AuthenticatedUser, q: AnalyticsQuery) => {
  const orgKey = getScopeFor(buildAbilityFromRules(user.rules), 'read', 'Report') === 'platform'
    ? (q.org_id ?? 'all')
    : (user.org_id ?? 'none');
  const cacheKey = `analytics:overview:${orgKey}:${q.period}:${q.from ?? ''}:${q.to ?? ''}:${q.tz}:${q.peak}:${q.compare}`;
  const redis = getRedisClient();

  // Short-TTL cache: the dashboard polls "live", so repeated loads hit Redis, not Postgres.
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof buildOverview>>;

  const result = await buildOverview(user, q);
  await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS).catch(() => {});
  return result;
};
