import type { Request, Response, NextFunction } from 'express';
import * as pricesService from '../services/prices.service.js';
import { Prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

// Acting org for copy-on-write: an org admin's org_id, or null for a platform
// admin operating on the shared defaults.
const actingOrg = (req: Request): string | null => req.user?.org_id ?? null;

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const price = await pricesService.createPrice(actingOrg(req), req.body as { boarding_stop_id: string; alighting_stop_id: string; amount: number });
    res.status(201).json({ price });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const prices = await pricesService.listEffectivePrices(actingOrg(req));
    res.status(200).json({ prices, count: prices.length });
  } catch (err) { next(err); }
};

// GET /prices serves two needs:
//   • both boarding_stop_id + alighting_stop_id → a single fare (booking lookup, 404)
//   • otherwise (neither, or one as a filter)   → the paginated price-matrix grid
export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { boarding_stop_id?: string; alighting_stop_id?: string; page?: string; limit?: string };

    if (q.boarding_stop_id && q.alighting_stop_id) {
      const price = await pricesService.getPrice(actingOrg(req), q.boarding_stop_id, q.alighting_stop_id);
      // Bare fare shape for the booking popup — just the pair, amount and currency.
      res.status(200).json({
        boarding_stop_id: price.boarding_stop_id,
        alighting_stop_id: price.alighting_stop_id,
        amount: price.amount,
        currency: price.currency,
      });
      return;
    }

    // Grid mode — paginated, optionally filtered by a single origin or destination.
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 50;
    const all = await pricesService.listEffectivePricesDetailed(actingOrg(req), {
      boarding_stop_id: q.boarding_stop_id,
      alighting_stop_id: q.alighting_stop_id,
    });
    const start = (page - 1) * limit;
    const data = all.slice(start, start + limit).map((p) => ({
      id: p.id,
      boarding_stop: { id: p.boarding_stop.id, name: p.boarding_stop.name },
      alighting_stop: { id: p.alighting_stop.id, name: p.alighting_stop.name },
      amount: p.amount,
      currency: p.currency,
    }));
    res.status(200).json({ data, total: all.length, page, limit });
  } catch (err) { next(err); }
};

// PUT /prices — idempotent upsert of a stop-pair fare.
export const upsert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { boarding_stop_id: string; alighting_stop_id: string; amount: number; currency?: string };
    if (body.boarding_stop_id === body.alighting_stop_id) throw new AppError('INVALID_STOP_PAIR', 422);
    try {
      const price = await pricesService.createPrice(actingOrg(req), body);
      res.status(200).json({
        id: price.id,
        boarding_stop_id: price.boarding_stop_id,
        alighting_stop_id: price.alighting_stop_id,
        amount: price.amount,
        currency: price.currency,
      });
    } catch (err) {
      // A non-existent stop fails the FK — surface it as an invalid pair.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new AppError('INVALID_STOP_PAIR', 422);
      }
      throw err;
    }
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const price = await pricesService.updatePrice(actingOrg(req), req.params['id'] as string, req.body as { amount: number });
    res.status(200).json({ price });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await pricesService.deletePrice(actingOrg(req), req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const bulkUpsert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const prices = await pricesService.bulkUpsertPrices(actingOrg(req), (req.body as { prices: Array<{ boarding_stop_id: string; alighting_stop_id: string; amount: number }> }).prices);
    res.status(200).json({ prices, count: prices.length });
  } catch (err) { next(err); }
};
