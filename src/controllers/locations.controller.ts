import type { Request, Response, NextFunction } from 'express';
import * as stopsService from '../services/stops.service.js';

// Acting org for copy-on-write: an org admin's org_id, or null (anonymous browse /
// platform admin) which resolves to the shared defaults.
const actingOrg = (req: Request): string | null => req.user?.org_id ?? null;

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.createStop(actingOrg(req), req.body as { name: string; lat: number; lng: number; city?: string });
    res.status(201).json({ stop });
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stops = await stopsService.listStops(actingOrg(req), req.query['q'] as string | undefined);
    // Public autocomplete payload — expose only the locating fields, not the
    // copy-on-write internals (org_id/override_of/is_hidden/timestamps).
    const data = stops.map((s) => ({ id: s.id, name: s.name, lat: Number(s.lat), lng: Number(s.lng) }));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ data });
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.getStop(actingOrg(req), req.params['id'] as string);
    res.status(200).json({ stop });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stop = await stopsService.updateStop(actingOrg(req), req.params['id'] as string, req.body as Partial<{ name: string; lat: number; lng: number; city: string }>);
    res.status(200).json({ stop });
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await stopsService.deleteStop(actingOrg(req), req.params['id'] as string);
    res.status(204).end();
  } catch (err) { next(err); }
};
