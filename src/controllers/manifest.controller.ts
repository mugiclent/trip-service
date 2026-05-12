import type { Request, Response, NextFunction } from 'express';
import { getTripManifest } from '../services/manifest.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const manifest = await getTripManifest(req.params['id'] as string, user);
    res.status(200).json(manifest);
  } catch (err) { next(err); }
};
