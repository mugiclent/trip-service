import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const createStop = async (data: {
  name: string;
  lat: number;
  lng: number;
  city?: string;
}) => {
  return prisma.stop.create({ data });
};

export const listStops = async (q?: string) => {
  return prisma.stop.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
    orderBy: { name: 'asc' },
  });
};

export const getStop = async (id: string) => {
  const stop = await prisma.stop.findUnique({ where: { id } });
  if (!stop) throw new AppError('STOP_NOT_FOUND', 404);
  return stop;
};

export const updateStop = async (id: string, data: Partial<{ name: string; lat: number; lng: number; city: string }>) => {
  await getStop(id);
  return prisma.stop.update({ where: { id }, data });
};

export const deleteStop = async (id: string) => {
  await getStop(id);
  const inUse = await prisma.routeStop.count({ where: { stop_id: id } });
  if (inUse > 0) throw new AppError('STOP_IN_USE', 409);
  await prisma.stop.delete({ where: { id } });
};
