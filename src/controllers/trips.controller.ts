import type { Request, Response, NextFunction } from 'express';
import * as tripsService from '../services/trips.service.js';
import { buildAbilityFromRules, getScopeFor } from '../utils/ability.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await tripsService.createTrips(user, req.body as Parameters<typeof tripsService.createTrips>[1]);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

// GET /trips — staff/admin get a paginated management list scoped by CASL;
// unauthenticated callers (or passengers) get the public stop-pair search.
export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const ability = user ? buildAbilityFromRules(user.rules) : null;
    const scope = ability ? getScopeFor(ability, 'read', 'Trip') : null;

    if (scope === 'org' || scope === 'platform') {
      const result = await tripsService.listTrips(user!, req.query as Parameters<typeof tripsService.listTrips>[1]);
      return void res.status(200).json(result);
    }

    const q = req.query as { boarding_stop_id: string; alighting_stop_id: string; date: string; seats?: string };
    const trips = await tripsService.searchTrips({
      boarding_stop_id: q.boarding_stop_id,
      alighting_stop_id: q.alighting_stop_id,
      date: q.date,
      seats: q.seats ? Number(q.seats) : 1,
    });
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.status(200).json({ trips });
  } catch (err) { next(err); }
};

export const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const trip = await tripsService.getTripById(req.params['id'] as string);
    res.status(200).json({ trip });
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const { scope, ...data } = req.body as { scope: 'this' | 'future' } & Parameters<typeof tripsService.updateTrip>[3];
    const result = await tripsService.updateTrip(user, req.params['id'] as string, scope, data);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const body = req.body as { scope: 'this' | 'future'; reason?: string };
    const result = await tripsService.cancelTrip(user, req.params['id'] as string, body.scope, body.reason);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const activate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await tripsService.activateTrip(user, req.params['id'] as string);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const complete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await tripsService.completeTrip(user, req.params['id'] as string);
    res.status(200).json(result);
  } catch (err) { next(err); }
};
