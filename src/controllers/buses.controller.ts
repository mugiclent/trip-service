import type { Request, Response, NextFunction } from 'express';
import * as busesService from '../services/buses.service.js';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const body = req.body as {
      plate: string;
      type: string;
      capacity: number;
      driver_id?: string | null;
      route_ids?: string[];
      org_id?: string;
    };
    // Org-scope callers always create within their own org; platform-scope callers
    // (no org_id of their own) must name the target org.
    const orgId = user.org_id ?? body.org_id;
    if (!orgId) throw new AppError('ORG_ID_REQUIRED', 400);

    const bus = await busesService.createBus({
      org_id: orgId,
      plate: body.plate,
      type: body.type,
      capacity: body.capacity,
      driver_id: body.driver_id ?? null,
      route_ids: body.route_ids,
    });
    res.status(201).json(bus);
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const q = req.query as {
      q?: string;
      status?: 'active' | 'inactive';
      org_id?: string;
      driver_id?: string;
      page?: string;
      limit?: string;
    };
    // Org-scope callers are pinned to their own org; platform-scope callers may
    // optionally narrow by org_id (otherwise they see every org's fleet).
    const orgId = user.org_id ?? q.org_id;
    const result = await busesService.listBuses({
      org_id: orgId,
      q: q.q,
      status: q.status,
      driver_id: q.driver_id,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const bus = await busesService.getBus(req.params['id'] as string, user.org_id ?? undefined);
    res.status(200).json(bus);
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const bus = await busesService.updateBus(
      req.params['id'] as string,
      user.org_id ?? undefined,
      req.body as Parameters<typeof busesService.updateBus>[2],
    );
    res.status(200).json(bus);
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    await busesService.deleteBus(req.params['id'] as string, user.org_id ?? undefined);
    res.status(204).end();
  } catch (err) { next(err); }
};

export const trips = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const q = req.query as { page?: string; limit?: string };
    const result = await busesService.getBusTrips(req.params['id'] as string, user.org_id ?? undefined, {
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.status(200).json(result);
  } catch (err) { next(err); }
};
