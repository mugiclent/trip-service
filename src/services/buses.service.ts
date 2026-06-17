import { prisma } from '../models/index.js';
import { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

// Detail payload: the bus plus its default driver, suggested routes and owning org.
const busInclude = {
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
  routes: { select: { id: true, name: true }, orderBy: { name: 'asc' as const } },
  org: { select: { id: true, name: true } },
} as const;

type BusWithRelations = Prisma.BusGetPayload<{ include: typeof busInclude }>;

// Card-shaped projection: capacity (← total_seats), status (← is_active), and the
// trimmed driver / routes / org objects.
const serializeBus = (bus: BusWithRelations) => ({
  id: bus.id,
  plate: bus.plate,
  type: bus.type,
  device_id: bus.device_id,
  capacity: bus.total_seats,
  status: bus.is_active ? 'active' : 'inactive',
  driver: bus.driver
    ? {
        id: bus.driver.id,
        first_name: bus.driver.first_name,
        last_name: bus.driver.last_name,
        avatar_path: bus.driver.avatar_path,
      }
    : null,
  routes: bus.routes.map((r) => ({ id: r.id, name: r.name })),
  org: { id: bus.org.id, name: bus.org.name },
  created_at: bus.created_at,
  updated_at: bus.updated_at,
});

// The plate and tracker device_id are both globally unique; a collision surfaces as a
// Prisma P2002. Map each to its specific contract code instead of the generic
// UNIQUE_CONSTRAINT_VIOLATION.
const rethrowUnique = (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.['target'] as string[] | undefined;
    if (target?.includes('plate')) throw new AppError('PLATE_ALREADY_EXISTS', 409);
    if (target?.includes('device_id')) throw new AppError('DEVICE_ALREADY_EXISTS', 409);
  }
  throw err;
};

// A driver must be a staff user in the bus's own org (404 otherwise).
const assertDriver = async (driverId: string | null | undefined, orgId: string): Promise<void> => {
  if (!driverId) return;
  const driver = await prisma.staffUser.findFirst({ where: { id: driverId, org_id: orgId } });
  if (!driver) throw new AppError('DRIVER_NOT_FOUND', 404);
};

// Every route_id must resolve to a route visible to the org — a platform default
// or one of the org's own rows (copy-on-write forks keep their own id).
const assertRoutes = async (routeIds: string[] | undefined, orgId: string): Promise<void> => {
  if (!routeIds || routeIds.length === 0) return;
  const unique = [...new Set(routeIds)];
  const found = await prisma.route.count({
    where: { id: { in: unique }, OR: [{ org_id: null }, { org_id: orgId }] },
  });
  if (found !== unique.length) throw new AppError('ROUTE_NOT_FOUND', 404);
};

export const createBus = async (data: {
  org_id: string;
  plate: string;
  type: string;
  capacity: number;
  device_id?: string | null;
  driver_id?: string | null;
  route_ids?: string[];
}) => {
  await assertDriver(data.driver_id, data.org_id);
  await assertRoutes(data.route_ids, data.org_id);

  try {
    const bus = await prisma.bus.create({
      data: {
        org_id: data.org_id,
        plate: data.plate,
        type: data.type,
        total_seats: data.capacity,
        device_id: data.device_id ?? null,
        driver_id: data.driver_id ?? null,
        ...(data.route_ids?.length
          ? { routes: { connect: data.route_ids.map((id) => ({ id })) } }
          : {}),
      },
      include: busInclude,
    });
    return serializeBus(bus);
  } catch (err) {
    return rethrowUnique(err);
  }
};

// List payload is lighter than the detail view: no routes, no updated_at.
const busListInclude = {
  driver: { select: { id: true, first_name: true, last_name: true, avatar_path: true } },
  org: { select: { id: true, name: true } },
} as const;

type BusListRow = Prisma.BusGetPayload<{ include: typeof busListInclude }>;

const serializeBusListItem = (bus: BusListRow) => ({
  id: bus.id,
  plate: bus.plate,
  type: bus.type,
  device_id: bus.device_id,
  capacity: bus.total_seats,
  status: bus.is_active ? 'active' : 'inactive',
  driver: bus.driver
    ? {
        id: bus.driver.id,
        first_name: bus.driver.first_name,
        last_name: bus.driver.last_name,
        avatar_path: bus.driver.avatar_path,
      }
    : null,
  org: { id: bus.org.id, name: bus.org.name },
  created_at: bus.created_at,
});

export const listBuses = async (params: {
  org_id?: string;
  q?: string;
  status?: 'active' | 'inactive';
  driver_id?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.BusWhereInput = {
    ...(params.org_id ? { org_id: params.org_id } : {}),
    ...(params.status ? { is_active: params.status === 'active' } : {}),
    ...(params.driver_id ? { driver_id: params.driver_id } : {}),
    ...(params.q
      ? {
          OR: [
            { plate: { contains: params.q, mode: 'insensitive' } },
            { type: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [buses, total] = await Promise.all([
    prisma.bus.findMany({ where, orderBy: { plate: 'asc' }, skip, take: limit, include: busListInclude }),
    prisma.bus.count({ where }),
  ]);

  return { data: buses.map(serializeBusListItem), total, page, limit };
};

// Loads a bus, enforcing org ownership when orgId is provided (platform admins
// pass undefined to bypass the scope check). Returns the raw row for internal use.
const loadBus = async (id: string, orgId?: string) => {
  const bus = await prisma.bus.findUnique({ where: { id } });
  if (!bus) throw new AppError('BUS_NOT_FOUND', 404);
  if (orgId && bus.org_id !== orgId) throw new AppError('FORBIDDEN', 403);
  return bus;
};

export const getBus = async (id: string, orgId?: string) => {
  await loadBus(id, orgId);
  const bus = await prisma.bus.findUnique({ where: { id }, include: busInclude });
  return serializeBus(bus!);
};

export const updateBus = async (
  id: string,
  orgId: string | undefined,
  data: Partial<{
    plate: string;
    type: string;
    capacity: number;
    device_id: string | null;
    status: 'active' | 'inactive';
    driver_id: string | null;
    route_ids: string[];
  }>,
) => {
  const existing = await loadBus(id, orgId);

  if ('driver_id' in data) await assertDriver(data.driver_id, existing.org_id);
  if (data.route_ids) await assertRoutes(data.route_ids, existing.org_id);

  const patch: Prisma.BusUpdateInput = {};
  if (data.plate !== undefined) patch.plate = data.plate;
  if (data.type !== undefined) patch.type = data.type;
  if (data.capacity !== undefined) patch.total_seats = data.capacity;
  // device_id is explicitly nullable — `null` detaches the tracker from the bus.
  if ('device_id' in data) patch.device_id = data.device_id;
  if (data.status !== undefined) patch.is_active = data.status === 'active';
  if ('driver_id' in data) {
    patch.driver = data.driver_id ? { connect: { id: data.driver_id } } : { disconnect: true };
  }
  // route_ids is a full replacement of the assigned set.
  if (data.route_ids) patch.routes = { set: data.route_ids.map((rid) => ({ id: rid })) };

  try {
    const bus = await prisma.bus.update({ where: { id }, data: patch, include: busInclude });
    return serializeBus(bus);
  } catch (err) {
    return rethrowUnique(err);
  }
};

export const deleteBus = async (id: string, orgId?: string) => {
  await loadBus(id, orgId);
  const inUse = await prisma.trip.count({
    where: { bus_id: id, status: 'scheduled', departure_at: { gt: new Date() } },
  });
  if (inUse > 0) throw new AppError('BUS_IN_USE', 409);
  await prisma.bus.delete({ where: { id } });
};

// Upcoming trips assigned to this bus, paginated, with occupancy figures.
export const getBusTrips = async (
  id: string,
  orgId: string | undefined,
  params: { page?: number; limit?: number },
) => {
  await loadBus(id, orgId);

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.TripWhereInput = { bus_id: id, departure_at: { gte: new Date() } };

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: { route: { select: { id: true, name: true } } },
      orderBy: { departure_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where }),
  ]);

  const data = trips.map((t) => ({
    id: t.id,
    departure_at: t.departure_at,
    status: t.status,
    route: { id: t.route.id, name: t.route.name },
    booked_seats: t.total_seats - t.available_seats,
    total_seats: t.total_seats,
    remaining_seats: t.available_seats,
  }));

  return { data, total, page, limit };
};
