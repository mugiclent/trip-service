import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const createBus = async (data: {
  org_id: string;
  plate: string;
  type: string;
  total_seats: number;
}) => {
  return prisma.bus.create({ data });
};

export const listBuses = async (orgId: string) => {
  return prisma.bus.findMany({
    where: { org_id: orgId },
    orderBy: { plate: 'asc' },
  });
};

export const getBus = async (id: string, orgId?: string) => {
  const bus = await prisma.bus.findUnique({ where: { id } });
  if (!bus) throw new AppError('BUS_NOT_FOUND', 404);
  if (orgId && bus.org_id !== orgId) throw new AppError('FORBIDDEN', 403);
  return bus;
};

export const updateBus = async (id: string, orgId: string, data: Partial<{ plate: string; type: string; total_seats: number; is_active: boolean }>) => {
  await getBus(id, orgId);
  return prisma.bus.update({ where: { id }, data });
};

export const deleteBus = async (id: string, orgId: string) => {
  await getBus(id, orgId);
  const inUse = await prisma.trip.count({
    where: { bus_id: id, status: 'scheduled', departure_at: { gt: new Date() } },
  });
  if (inUse > 0) throw new AppError('BUS_IN_USE', 409);
  await prisma.bus.delete({ where: { id } });
};
