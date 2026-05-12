import type { Request, Response, NextFunction } from 'express';
import * as pricesService from '../services/prices.service.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const price = await pricesService.createPrice(req.body as Parameters<typeof pricesService.createPrice>[0]);
    res.status(201).json({ price });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { boarding_stop_id, alighting_stop_id } = req.query as { boarding_stop_id: string; alighting_stop_id: string };
    const price = await pricesService.getPrice(boarding_stop_id, alighting_stop_id);
    res.status(200).json({ price });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const price = await pricesService.updatePrice(req.params['id'] as string, req.body as { amount: number });
    res.status(200).json({ price });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await pricesService.deletePrice(req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const bulkUpsert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const prices = await pricesService.bulkUpsertPrices((req.body as { prices: Array<{ boarding_stop_id: string; alighting_stop_id: string; amount: number }> }).prices);
    res.status(200).json({ prices, count: prices.length });
  } catch (err) { next(err); }
};
