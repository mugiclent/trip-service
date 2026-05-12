import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../models/index.js';
import type { AuthenticatedUser } from '../utils/ability.js';

export const myTrips = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const trips = await prisma.trip.findMany({
      where: {
        driver_id: user.id,
        departure_at: { gte: startOfDay },
        status: { in: ['scheduled', 'active'] },
      },
      include: {
        route: { include: { route_stops: { include: { stop: true }, orderBy: { order: 'asc' } } } },
        bus: true,
        org: { select: { id: true, name: true, logo_path: true } },
      },
      orderBy: { departure_at: 'asc' },
    });

    res.status(200).json({ trips });
  } catch (err) { next(err); }
};
