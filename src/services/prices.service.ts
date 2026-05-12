import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const createPrice = async (data: {
  boarding_stop_id: string;
  alighting_stop_id: string;
  amount: number;
}) => {
  return prisma.price.create({ data });
};

export const getPrice = async (boarding_stop_id: string, alighting_stop_id: string) => {
  const price = await prisma.price.findUnique({
    where: { boarding_stop_id_alighting_stop_id: { boarding_stop_id, alighting_stop_id } },
  });
  if (!price) throw new AppError('PRICE_NOT_FOUND', 404);
  return price;
};

export const getPriceById = async (id: string) => {
  const price = await prisma.price.findUnique({ where: { id } });
  if (!price) throw new AppError('PRICE_NOT_FOUND', 404);
  return price;
};

export const updatePrice = async (id: string, data: { amount: number }) => {
  await getPriceById(id);
  return prisma.price.update({ where: { id }, data });
};

export const deletePrice = async (id: string) => {
  await getPriceById(id);
  await prisma.price.delete({ where: { id } });
};

export const bulkUpsertPrices = async (
  prices: Array<{ boarding_stop_id: string; alighting_stop_id: string; amount: number }>,
) => {
  const ops = prices.map((p) =>
    prisma.price.upsert({
      where: { boarding_stop_id_alighting_stop_id: { boarding_stop_id: p.boarding_stop_id, alighting_stop_id: p.alighting_stop_id } },
      create: p,
      update: { amount: p.amount },
    }),
  );
  return prisma.$transaction(ops);
};
