import type { Request, Response, NextFunction } from 'express';
import * as stopsService from '../services/stops.service.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.createStop(req.body as Parameters<typeof stopsService.createStop>[0]);
    res.status(201).json({ stop });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stops = await stopsService.listStops(req.query['q'] as string | undefined);
    res.status(200).json({ stops });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.getStop(req.params['id'] as string);
    res.status(200).json({ stop });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.updateStop(req.params['id'] as string, req.body as Parameters<typeof stopsService.updateStop>[1]);
    res.status(200).json({ stop });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await stopsService.deleteStop(req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};
