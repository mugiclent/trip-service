import type { Request, Response, NextFunction } from 'express';
import * as ticketsService from '../services/tickets.service.js';
import { streamTicketStatus } from '../services/sse.service.js';
import { buildAbilityFromRules } from '../utils/ability.js';
import type { AuthenticatedUser } from '../utils/ability.js';
import { AppError } from '../utils/AppError.js';
import { consumeSudoToken } from '../middleware/consumeSudoToken.js';
import { getRedisClient } from '../loaders/redis.js';

export const book = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const body = req.body as {
      trip_id: string;
      boarding_stop_id: string;
      alighting_stop_id: string;
      seats_count?: number;
      payment_method?: 'wallet' | 'mtn' | 'airtel' | 'cash';
      phone?: string;
      passenger_name?: string;
    };

    const seatsCount = body.seats_count ?? 1;

    // Cash — staff walk-in sale. Requires an authenticated caller with create:Ticket.
    if (body.payment_method === 'cash') {
      if (!user) return next(new AppError('UNAUTHENTICATED', 401));
      if (!buildAbilityFromRules(user.rules).can('create', 'Ticket')) return next(new AppError('FORBIDDEN', 403));
      if (!body.passenger_name) return next(new AppError('VALIDATION_ERROR', 422, 'passenger_name required for cash ticket'));
      const result = await ticketsService.bookCashTicket(user, {
        trip_id: body.trip_id,
        boarding_stop_id: body.boarding_stop_id,
        alighting_stop_id: body.alighting_stop_id,
        seats_count: seatsCount,
        passenger_name: body.passenger_name,
        passenger_phone: body.phone,
      });
      res.status(202).json(result);
      return;
    }

    // Wallet — authenticated purchase. An authenticated passenger omitting
    // payment_method defaults here for back-compat; otherwise it must be explicit.
    const method = body.payment_method ?? (user?.user_type === 'passenger' ? 'wallet' : undefined);

    if (method === 'wallet') {
      if (!user) return next(new AppError('UNAUTHENTICATED', 401));
      // Passengers must step up — spending real wallet money requires a fresh
      // password re-auth (≤3 min, single-use sudo token).
      if (user.user_type === 'passenger') {
        await consumeSudoToken(
          req.headers['x-sudo-token'] as string | undefined,
          user.id,
          'purchase_ticket',
          getRedisClient(),
        );
      }
      // The account already holds a verified phone, so we never force it in the
      // request. (Wiring that phone onto the ticket for the confirmation SMS is TODO.)
      const result = await ticketsService.bookWalletTicket(user, {
        trip_id: body.trip_id,
        boarding_stop_id: body.boarding_stop_id,
        alighting_stop_id: body.alighting_stop_id,
        seats_count: seatsCount,
      });
      res.status(202).json(result);
      return;
    }

    // mtn | airtel — mobile money (guest or passenger); the provider is verified
    // from the phone number.
    if (!body.phone || !body.passenger_name) {
      return next(new AppError('VALIDATION_ERROR', 422, 'phone and passenger_name required for mobile-money booking'));
    }
    const result = await ticketsService.bookMomoTicket({
      trip_id: body.trip_id,
      boarding_stop_id: body.boarding_stop_id,
      alighting_stop_id: body.alighting_stop_id,
      seats_count: seatsCount,
      phone: body.phone,
      passenger_name: body.passenger_name,
    });
    res.status(202).json(result);
  } catch (err) { next(err); }
};

export const stream = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    await streamTicketStatus(req, res, req.params['id'] as string, user);
  } catch (err) { next(err); }
};

export const get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const ticket = await ticketsService.getTicket(req.params['id'] as string, user);
    res.status(200).json({ ticket });
  } catch (err) { next(err); }
};

export const myTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await ticketsService.listMyTickets(user.id, req.query as Parameters<typeof ticketsService.listMyTickets>[1]);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const ticket = await ticketsService.cancelTicket(user, req.params['id'] as string, (req.body as { reason?: string }).reason);
    res.status(200).json({ ticket });
  } catch (err) { next(err); }
};

export const validate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await ticketsService.validateTicket(user, req.params['id'] as string);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const listOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await ticketsService.listTickets(user, req.query as Parameters<typeof ticketsService.listTickets>[1]);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

// GET /trips/:id/tickets — paginated ticket list for the trip detail screen.
export const listForTrip = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await ticketsService.listTripTickets(
      user,
      req.params['id'] as string,
      req.query as Parameters<typeof ticketsService.listTripTickets>[2],
    );
    res.status(200).json(result);
  } catch (err) { next(err); }
};
