import type { Request, Response, NextFunction } from 'express';
import * as analyticsService from '../services/analytics.service.js';
import type { AnalyticsQuery } from '../services/analytics.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';

// GET /analytics/overview — single dashboard payload (cards, revenue-by-route,
// top destinations, peak times) for the caller's scope.
export const overview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const q = req.query as unknown as AnalyticsQuery;
    const result = await analyticsService.getOverview(user, q);
    res.status(200).json(result);
  } catch (err) { next(err); }
};
