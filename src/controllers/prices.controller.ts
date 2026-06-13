import type { Request, Response, NextFunction } from 'express';
import * as pricesService from '../services/prices.service.js';

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

// GET /prices is a collection endpoint:
//   • both boarding_stop_id + alighting_stop_id  → a single fare  { price }
//   • neither                                    → the full list  { prices, count }
//   • exactly one                                → 400 (incomplete pair)
export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { boarding_stop_id, alighting_stop_id } = req.query as { boarding_stop_id?: string; alighting_stop_id?: string };
    if (!boarding_stop_id && !alighting_stop_id) {
      const prices = await pricesService.listEffectivePrices(actingOrg(req));
      res.status(200).json({ prices, count: prices.length });
      return;
    }
    if (!boarding_stop_id || !alighting_stop_id) {
      res.status(400).json({ error: { code: 'INCOMPLETE_STOP_PAIR', message: 'Provide both boarding_stop_id and alighting_stop_id, or neither.' } });
      return;
    }
    const price = await pricesService.getPrice(actingOrg(req), boarding_stop_id, alighting_stop_id);
    res.status(200).json({ price });
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
