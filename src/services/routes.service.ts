import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { slugify } from '../utils/slugify.js';

const routeWithDetails = {
  org: true,
  origin_stop: true,
  destination_stop: true,
  route_stops: {
    include: { stop: true },
    orderBy: { order: 'asc' as const },
  },
} as const;

export const createRoute = async (data: {
  org_id: string;
  stop_ids: string[];
  name?: string;
}) => {
  if (data.stop_ids.length < 2) throw new AppError('INVALID_ROUTE', 400);

  const stops = await prisma.stop.findMany({
    where: { id: { in: data.stop_ids } },
  });
  if (stops.length !== data.stop_ids.length) throw new AppError('STOP_NOT_FOUND', 404);

  const orderedStops = data.stop_ids.map((id) => stops.find((s) => s.id === id)!);
  const origin = orderedStops[0];
  const destination = orderedStops[orderedStops.length - 1];
  const name = data.name ?? `${origin.name} — ${destination.name}`;
  const slug = slugify(name);

  return prisma.route.create({
    data: {
      org_id: data.org_id,
      name,
      slug,
      origin_stop_id: origin.id,
      destination_stop_id: destination.id,
      route_stops: {
        create: orderedStops.map((stop, index) => ({
          stop_id: stop.id,
          order: index + 1,
        })),
      },
    },
    include: routeWithDetails,
  });
};

export const listRoutes = async (orgId?: string, publicOnly = false) => {
  return prisma.route.findMany({
    where: {
      ...(orgId ? { org_id: orgId } : {}),
      ...(publicOnly ? { is_active: true } : {}),
    },
    include: routeWithDetails,
    orderBy: { name: 'asc' },
  });
};

export const getRoute = async (id: string) => {
  const route = await prisma.route.findUnique({
    where: { id },
    include: routeWithDetails,
  });
  if (!route) throw new AppError('ROUTE_NOT_FOUND', 404);
  return route;
};

export const updateRoute = async (id: string, data: Partial<{ name: string; is_active: boolean }>) => {
  await getRoute(id);
  return prisma.route.update({ where: { id }, data, include: routeWithDetails });
};

export const deleteRoute = async (id: string) => {
  await getRoute(id);
  const inUse = await prisma.trip.count({ where: { route_id: id, status: { in: ['scheduled', 'active'] } } });
  if (inUse > 0) throw new AppError('ROUTE_IN_USE', 409);
  await prisma.route.delete({ where: { id } });
};

export const addStopToRoute = async (routeId: string, stopId: string, order: number) => {
  await getRoute(routeId);
  return prisma.routeStop.create({ data: { route_id: routeId, stop_id: stopId, order } });
};

export const removeStopFromRoute = async (routeId: string, stopId: string) => {
  await prisma.routeStop.delete({
    where: { route_id_stop_id: { route_id: routeId, stop_id: stopId } },
  });
};

export const reorderStop = async (routeId: string, stopId: string, order: number) => {
  await prisma.routeStop.update({
    where: { route_id_stop_id: { route_id: routeId, stop_id: stopId } },
    data: { order },
  });
};
