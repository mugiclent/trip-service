import type { Request, Response, NextFunction } from 'express';
import * as routesService from '../services/routes.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const route = await routesService.createRoute({ ...req.body as { stop_ids: string[]; name?: string }, org_id: user.org_id ?? (req.body as { org_id?: string }).org_id ?? '' });
    res.status(201).json({ route });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const orgId = user?.user_type === 'staff' ? user.org_id ?? undefined : undefined;
    const routes = await routesService.listRoutes(orgId, !user);
    res.status(200).json({ routes });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const route = await routesService.getRoute(req.params['id'] as string);
    res.status(200).json({ route });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const route = await routesService.updateRoute(req.params['id'] as string, req.body as Parameters<typeof routesService.updateRoute>[1]);
    res.status(200).json({ route });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.deleteRoute(req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const addStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rs = await routesService.addStopToRoute(req.params['id'] as string, (req.body as { stop_id: string; order: number }).stop_id, (req.body as { stop_id: string; order: number }).order);
    res.status(201).json({ route_stop: rs });
  } catch (err) { next(err); }
};

export const removeStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.removeStopFromRoute(req.params['id'] as string, req.params['stopId'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const reorderStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.reorderStop(req.params['id'] as string, req.params['stopId'] as string, (req.body as { order: number }).order);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
};
