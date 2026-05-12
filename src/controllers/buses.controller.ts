import type { Request, Response, NextFunction } from 'express';
import * as busesService from '../services/buses.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const bus = await busesService.createBus({ ...req.body as Omit<Parameters<typeof busesService.createBus>[0], 'org_id'>, org_id: user.org_id ?? '' });
    res.status(201).json({ bus });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const buses = await busesService.listBuses(user.org_id ?? '');
    res.status(200).json({ buses });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const bus = await busesService.getBus(req.params['id'] as string, user.org_id ?? undefined);
    res.status(200).json({ bus });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const bus = await busesService.updateBus(req.params['id'] as string, user.org_id ?? '', req.body as Parameters<typeof busesService.updateBus>[2]);
    res.status(200).json({ bus });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    await busesService.deleteBus(req.params['id'] as string, user.org_id ?? '');
    res.status(204).end();
  } catch (err) { next(err); }
};
