import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/tickets.controller.js';

const router = Router();

// Unified booking endpoint. payment_method selects the flow:
//   wallet           → authenticated passenger wallet purchase (sudo step-up)
//   mtn | airtel     → mobile-money purchase (provider verified from phone)
//   cash             → staff walk-in sale (requires create:Ticket; checked in controller)
// An authenticated passenger omitting payment_method defaults to wallet.
const bookSchema = Joi.object({
  trip_id: Joi.string().uuid().required(),
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  seats_count: Joi.number().integer().min(1).default(1),
  payment_method: Joi.string().valid('wallet', 'mtn', 'airtel', 'cash').optional(),
  phone: Joi.string().max(20).optional(),
  passenger_name: Joi.string().max(255).optional(),
});

const cancelSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

router.post('/', optionalAuthenticate, validate(bookSchema), ctrl.book);
router.get('/me', authenticate, ctrl.myTickets);
router.get('/:id', authenticate, ctrl.get);
router.get('/:id/stream', optionalAuthenticate, ctrl.stream);
router.post('/:id/cancel', authenticate, validate(cancelSchema), ctrl.cancel);
router.post('/:id/validate', authenticate, orgBlocking, authorize('validate', 'Ticket'), ctrl.validate);

router.get('/', authenticate, authorize('read', 'Ticket'), ctrl.listOrg);

export default router;
