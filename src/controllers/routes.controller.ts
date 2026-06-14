import type { Request, Response, NextFunction } from 'express';
import * as routesService from '../services/routes.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

// Acting org for copy-on-write: an org admin's org_id, or null (anonymous / platform
// admin) which resolves to the shared default routes.
const actingOrg = (req: Request): string | null => req.user?.org_id ?? null;

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const body = req.body as { name?: string; stops: { location_id: string; order: number }[]; org_id?: string };
    // Org-scope callers are pinned to their own org; platform-scope callers may
    // target any org via org_id (or null for a shared platform default).
    const orgId = user.org_id ?? body.org_id ?? null;
    const stop_ids = [...body.stops].sort((a, b) => a.order - b.order).map((s) => s.location_id);

    const route = await routesService.createRoute({ org_id: orgId, stop_ids, name: body.name });
    res.status(201).json(routesService.serializeRouteDetail(route));
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const orgId = user?.user_type === 'staff' ? user.org_id ?? null : null;
    const q = (req.query['q'] as string | undefined)?.toLowerCase();
    const status = req.query['status'] as string | undefined; // active | inactive
    const page = Number(req.query['page']) || 1;
    const limit = Number(req.query['limit']) || 20;

    // Anonymous callers see active routes only; staff see active + inactive so the
    // status filter is meaningful. The effective set is resolved in-memory, so q/
    // status filtering and paging happen here.
    let all = await routesService.listRoutes(orgId, !user);
    if (q) all = all.filter((r) => r.name.toLowerCase().includes(q));
    if (status === 'active') all = all.filter((r) => r.is_active);
    else if (status === 'inactive') all = all.filter((r) => !r.is_active);

    const start = (page - 1) * limit;
    const data = all.slice(start, start + limit).map(routesService.serializeRouteListItem);
    res.status(200).json({ data, total: all.length, page, limit });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = actingOrg(req);
    const route = await routesService.getRoute(orgId, req.params['id'] as string);
    res.status(200).json(await routesService.serializeRouteFull(orgId, route));
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = actingOrg(req);
    const body = req.body as { name?: string; status?: 'active' | 'inactive'; stops?: { location_id: string; order: number }[] };
    const route = await routesService.updateRoute(orgId, req.params['id'] as string, {
      name: body.name,
      is_active: body.status !== undefined ? body.status === 'active' : undefined,
      stops: body.stops,
    });
    res.status(200).json(await routesService.serializeRouteFull(orgId, route));
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
