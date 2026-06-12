import type { Request, Response, NextFunction } from 'express';
import * as routesService from '../services/routes.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

// Acting org for copy-on-write: an org admin's org_id, or null (anonymous / platform
// admin) which resolves to the shared default routes.
const actingOrg = (req: Request): string | null => req.user?.org_id ?? null;

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const route = await routesService.createRoute({ ...req.body as { stop_ids: string[]; name?: string }, org_id: actingOrg(req) });
    res.status(201).json({ route });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const orgId = user?.user_type === 'staff' ? user.org_id ?? null : null;
    const routes = await routesService.listRoutes(orgId, !user);
    res.status(200).json({ routes });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const route = await routesService.getRoute(actingOrg(req), req.params['id'] as string);
    res.status(200).json({ route });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const route = await routesService.updateRoute(actingOrg(req), req.params['id'] as string, req.body as Partial<{ name: string; is_active: boolean }>);
    res.status(200).json({ route });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.deleteRoute(actingOrg(req), req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const addStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { stop_id: string; order: number };
    const rs = await routesService.addStopToRoute(actingOrg(req), req.params['id'] as string, body.stop_id, body.order);
    res.status(201).json({ route_stop: rs });
  } catch (err) { next(err); }
};

export const removeStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.removeStopFromRoute(actingOrg(req), req.params['id'] as string, req.params['stopId'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const reorderStop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await routesService.reorderStop(actingOrg(req), req.params['id'] as string, req.params['stopId'] as string, (req.body as { order: number }).order);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
};
