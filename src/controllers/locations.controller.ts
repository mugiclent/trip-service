import type { Request, Response, NextFunction } from 'express';
import * as stopsService from '../services/stops.service.js';

// Acting org for copy-on-write: an org admin's org_id, or null (anonymous browse /
// platform admin) which resolves to the shared defaults.
const actingOrg = (req: Request): string | null => req.user?.org_id ?? null;

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.createStop(actingOrg(req), req.body as { name: string; lat: number; lng: number; city?: string; province?: string });
    res.status(201).json({
      id: stop.id,
      name: stop.name,
      province: stop.province,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      created_at: stop.created_at,
    });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query['q'] as string | undefined;
    const page = Number(req.query['page']) || 1;
    const limit = Number(req.query['limit']) || 20;

    // The effective stop set (copy-on-write overlay) is resolved in-memory, so we
    // page the sorted result here rather than in the DB query.
    const all = await stopsService.listStops(actingOrg(req), q);
    const start = (page - 1) * limit;
    // Expose only the locating fields, not the copy-on-write internals
    // (org_id/override_of/is_hidden). Superset of the autocomplete payload.
    const data = all.slice(start, start + limit).map((s) => ({
      id: s.id,
      name: s.name,
      province: s.province,
      lat: Number(s.lat),
      lng: Number(s.lng),
      created_at: s.created_at,
    }));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ data, total: all.length, page, limit });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.getStop(actingOrg(req), req.params['id'] as string);
    res.status(200).json({
      id: stop.id,
      name: stop.name,
      province: stop.province,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      created_at: stop.created_at,
      updated_at: stop.updated_at,
    });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.updateStop(actingOrg(req), req.params['id'] as string, req.body as Partial<{ name: string; lat: number; lng: number; city: string; province: string }>);
    res.status(200).json({
      id: stop.id,
      name: stop.name,
      province: stop.province,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      updated_at: stop.updated_at,
    });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await stopsService.deleteStop(actingOrg(req), req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};
