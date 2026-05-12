import type { Request, Response, NextFunction } from 'express';
import * as ticketsService from '../services/tickets.service.js';
import { streamTicketStatus } from '../services/sse.service.js';
import type { AuthenticatedUser } from '../utils/ability.js';
import { AppError } from '../utils/AppError.js';

export const book = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    const body = req.body as {
      trip_id: string;
      boarding_stop_id: string;
      alighting_stop_id: string;
      seats_count?: number;
      payment_method?: 'mtn' | 'airtel';
      phone?: string;
      passenger_name?: string;
    };

    const seatsCount = body.seats_count ?? 1;

    if (user) {
      const result = await ticketsService.bookWalletTicket(user, {
        trip_id: body.trip_id,
        boarding_stop_id: body.boarding_stop_id,
        alighting_stop_id: body.alighting_stop_id,
        seats_count: seatsCount,
      });
      res.status(202).json(result);
    } else {
      if (!body.phone || !body.passenger_name) {
        return next(new AppError('VALIDATION_ERROR', 422, 'phone and passenger_name required for guest booking'));
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
    }
  } catch (err) { next(err); }
};

export const bookCash = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as AuthenticatedUser;
    const result = await ticketsService.bookCashTicket(user, req.body as Parameters<typeof ticketsService.bookCashTicket>[1]);
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
