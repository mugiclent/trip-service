import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../loaders/redis.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const orgBlocking = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) return next();

  const user = req.user as AuthenticatedUser;

  if (user.user_type === 'passenger') return next();
  if (!user.org_id) return next();

  try {
    const blocked = await getRedisClient().get(`org_blocked:${user.org_id}`);
    if (blocked) {
      res.status(403).json({
        error: {
          code: 'ORG_BILLING_OVERDUE',
          message: 'Your organisation account is suspended due to an outstanding balance. Please contact your administrator.',
        },
      });
      return;
    }
  } catch (err) {
    console.error('[orgBlocking] Redis check failed', err);
  }

  next();
};
