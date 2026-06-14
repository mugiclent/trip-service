import { prisma } from '../models/index.js';
import { Prisma } from '../models/index.js';
import type { Route } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { slugify } from '../utils/slugify.js';
import { candidateWhere, resolveEffective } from '../utils/overrides.js';
import { listEffectivePrices } from './prices.service.js';

/**
 * Routes follow the copy-on-write override pattern (see src/utils/overrides.ts). The
 * platform ships default routes (org_id = null) that operators run trips on. An org
 * never mutates a default — editing one (name, stop sequence, …) forks a deep copy
 * (the route plus its route_stops) that keeps its own id and shadows the default in
 * the catalog; "deleting" a default tombstones it for that org. Because trips
 * reference a concrete route row, no trip-side overlay is needed. `orgId` is the
 * acting org (null = platform admin / anonymous → the shared defaults).
 */

const routeWithDetails = {
  org: true,
  origin_stop: true,
  destination_stop: true,
  route_stops: {
    include: { stop: true },
    orderBy: { order: 'asc' as const },
  },
} as const;

/** Deep-copy a default route (+ its route_stops) into an org-scoped fork, once. */
const forkRoute = async (orgId: string, def: Route) => {
  const existing = await prisma.route.findFirst({ where: { org_id: orgId, override_of: def.id }, include: routeWithDetails });
  if (existing) return existing;
  const rss = await prisma.routeStop.findMany({ where: { route_id: def.id } });
  return prisma.route.create({
    data: {
      org_id: orgId,
      override_of: def.id,
      name: def.name,
      slug: def.slug, // unique is scoped per org, so the fork can keep the slug
      origin_stop_id: def.origin_stop_id,
      destination_stop_id: def.destination_stop_id,
      is_active: def.is_active,
      route_stops: { create: rss.map((rs) => ({ stop_id: rs.stop_id, order: rs.order })) },
    },
    include: routeWithDetails,
  });
};

/**
 * Return the concrete route id this org may mutate: its own row as-is, or a fresh
 * fork of a platform default (auto copy-on-write). Throws if not visible to the org.
 */
const ensureOrgRoute = async (orgId: string | null, id: string): Promise<string> => {
  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) throw new AppError('ROUTE_NOT_FOUND', 404);
  if (orgId && route.org_id === null) return (await forkRoute(orgId, route)).id;
  if (route.org_id === orgId) return route.id;
  throw new AppError('ROUTE_NOT_FOUND', 404);
};

type RouteDetail = Prisma.RouteGetPayload<{ include: typeof routeWithDetails }>;

// Card-shaped detail payload: status (← is_active) and a flat ordered stop list.
export const serializeRouteDetail = (route: RouteDetail) => ({
  id: route.id,
  name: route.name,
  status: route.is_active ? 'active' : 'inactive',
  stops: route.route_stops.map((rs) => ({
    id: rs.id,
    location_id: rs.stop_id,
    name: rs.stop.name,
    lat: Number(rs.stop.lat),
    lng: Number(rs.stop.lng),
    order: rs.order,
  })),
  created_at: route.created_at,
});

/**
 * A route's prices are "complete" when every boardable stop-pair (i < j in route
 * order) has an effective fare for `orgId`. Required before a route can be activated.
 */
const pricesComplete = async (orgId: string | null, route: RouteDetail): Promise<boolean> => {
  const stops = route.route_stops; // already ordered ascending
  if (stops.length < 2) return false;
  const prices = await listEffectivePrices(orgId);
  const have = new Set(prices.map((p) => `${p.boarding_stop_id}|${p.alighting_stop_id}`));
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (!have.has(`${stops[i].stop_id}|${stops[j].stop_id}`)) return false;
    }
  }
  return true;
};

// Full detail payload = the create shape plus org, prices_complete and updated_at.
export const serializeRouteFull = async (orgId: string | null, route: RouteDetail) => ({
  ...serializeRouteDetail(route),
  org: route.org ? { id: route.org.id, name: route.org.name } : null,
  prices_complete: await pricesComplete(orgId, route),
  updated_at: route.updated_at,
});

// Card-shaped list-card payload: status, stop count and origin/destination summary.
export const serializeRouteListItem = (route: RouteDetail) => ({
  id: route.id,
  name: route.name,
  status: route.is_active ? 'active' : 'inactive',
  stops_count: route.route_stops.length,
  origin: { id: route.origin_stop.id, name: route.origin_stop.name },
  destination: { id: route.destination_stop.id, name: route.destination_stop.name },
  created_at: route.created_at,
});

export const createRoute = async (data: {
  org_id: string | null;
  stop_ids: string[];
  name?: string;
}): Promise<RouteDetail> => {
  if (data.stop_ids.length < 2) throw new AppError('INSUFFICIENT_STOPS', 422);

  const stops = await prisma.stop.findMany({ where: { id: { in: data.stop_ids } } });
  if (stops.length !== new Set(data.stop_ids).size) throw new AppError('STOP_NOT_FOUND', 404);

  const orderedStops = data.stop_ids.map((id) => stops.find((s) => s.id === id)!);
  const origin = orderedStops[0];
  const destination = orderedStops[orderedStops.length - 1];
  const name = data.name ?? `${origin.name} — ${destination.name}`;
  const slug = slugify(name);

  try {
    // New routes start inactive — they can't be activated until every stop-pair price
    // is defined (enforced on activation, not here).
    return await prisma.route.create({
      data: {
        org_id: data.org_id,
        name,
        slug,
        is_active: false,
        origin_stop_id: origin.id,
        destination_stop_id: destination.id,
        route_stops: {
          create: orderedStops.map((stop, index) => ({ stop_id: stop.id, order: index + 1 })),
        },
      },
      include: routeWithDetails,
    });
  } catch (err) {
    // Route slug is unique per org (and per platform default) — a clash means the
    // name is already taken.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('ROUTE_ALREADY_EXISTS', 409);
    }
    throw err;
  }
};

/** Effective route catalog for `orgId`: defaults with the org's forks substituted in. */
export const listRoutes = async (orgId: string | null, publicOnly = false) => {
  const rows = await prisma.route.findMany({
    where: candidateWhere(orgId),
    include: routeWithDetails,
    orderBy: { name: 'asc' },
  });
  const effective = resolveEffective(rows, orgId);
  return publicOnly ? effective.filter((r) => r.is_active) : effective;
};

export const getRoute = async (orgId: string | null, id: string) => {
  const route = await prisma.route.findUnique({ where: { id }, include: routeWithDetails });
  if (!route) throw new AppError('ROUTE_NOT_FOUND', 404);

  // Platform default — substitute the org's fork / honour a tombstone.
  if (route.org_id === null) {
    if (orgId) {
      const fork = await prisma.route.findFirst({ where: { org_id: orgId, override_of: id }, include: routeWithDetails });
      if (fork) {
        if (fork.is_hidden) throw new AppError('ROUTE_NOT_FOUND', 404);
        return fork;
      }
    }
    return route;
  }
  // Org-owned row — visible only to its owner.
  if (route.org_id === orgId && !route.is_hidden) return route;
  throw new AppError('ROUTE_NOT_FOUND', 404);
};

export const updateRoute = async (
  orgId: string | null,
  id: string,
  data: Partial<{ name: string; is_active: boolean; stops: { location_id: string; order: number }[] }>,
): Promise<RouteDetail> => {
  const routeId = await ensureOrgRoute(orgId, id); // forks a default on first edit

  const patch: Prisma.RouteUpdateInput = {};
  if (data.name !== undefined) {
    patch.name = data.name;
    patch.slug = slugify(data.name);
  }
  if (data.is_active !== undefined) patch.is_active = data.is_active;

  // Full stop-list replacement (drag-and-drop reorder / add / remove).
  if (data.stops) {
    if (data.stops.length < 2) throw new AppError('INSUFFICIENT_STOPS', 422);
    const ordered = [...data.stops].sort((a, b) => a.order - b.order);
    const stopIds = ordered.map((s) => s.location_id);
    const found = await prisma.stop.findMany({ where: { id: { in: stopIds } } });
    if (found.length !== new Set(stopIds).size) throw new AppError('STOP_NOT_FOUND', 404);

    patch.origin_stop = { connect: { id: stopIds[0] } };
    patch.destination_stop = { connect: { id: stopIds[stopIds.length - 1] } };
    patch.route_stops = {
      deleteMany: {},
      create: ordered.map((s, i) => ({ stop_id: s.location_id, order: i + 1 })),
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.route.update({ where: { id: routeId }, data: patch, include: routeWithDetails });
      // Activation is gated on a complete price matrix (computed against the new stops).
      if (data.is_active === true && !(await pricesComplete(orgId, updated))) {
        throw new AppError('PRICES_INCOMPLETE', 400);
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('ROUTE_ALREADY_EXISTS', 409);
    }
    throw err;
  }
};

export const deleteRoute = async (orgId: string | null, id: string): Promise<void> => {
  const target = await prisma.route.findUnique({ where: { id } });
  if (!target) throw new AppError('ROUTE_NOT_FOUND', 404);

  // Org "deleting" a platform default → tombstone it for that org only.
  if (orgId && target.org_id === null) {
    const existing = await prisma.route.findFirst({ where: { org_id: orgId, override_of: id } });
    if (existing) {
      await prisma.route.update({ where: { id: existing.id }, data: { is_hidden: true } });
    } else {
      await prisma.route.create({
        data: {
          org_id: orgId, override_of: id, is_hidden: true,
          name: target.name, slug: target.slug,
          origin_stop_id: target.origin_stop_id, destination_stop_id: target.destination_stop_id,
          is_active: target.is_active,
        },
      });
    }
    return;
  }
  // Hard delete of own route / a default as platform admin — block if trips run on it.
  if (target.org_id === orgId) {
    const inUse = await prisma.trip.count({ where: { route_id: id, status: { in: ['scheduled', 'active'] } } });
    if (inUse > 0) throw new AppError('ROUTE_IN_USE', 409);
    try {
      await prisma.route.delete({ where: { id } });
    } catch (err) {
      // Any lingering reference (a completed trip, a trip series) also blocks deletion.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new AppError('ROUTE_IN_USE', 409);
      }
      throw err;
    }
    return;
  }
  throw new AppError('ROUTE_NOT_FOUND', 404);
};

export const addStopToRoute = async (orgId: string | null, routeId: string, stopId: string, order: number) => {
  const id = await ensureOrgRoute(orgId, routeId);
  return prisma.routeStop.create({ data: { route_id: id, stop_id: stopId, order } });
};

export const removeStopFromRoute = async (orgId: string | null, routeId: string, stopId: string): Promise<void> => {
  const id = await ensureOrgRoute(orgId, routeId);
  await prisma.routeStop.delete({ where: { route_id_stop_id: { route_id: id, stop_id: stopId } } });
};

export const reorderStop = async (orgId: string | null, routeId: string, stopId: string, order: number) => {
  const id = await ensureOrgRoute(orgId, routeId);
  return prisma.routeStop.update({
    where: { route_id_stop_id: { route_id: id, stop_id: stopId } },
    data: { order },
  });
};
