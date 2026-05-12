import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/tickets.controller.js';

const router = Router();

const bookSchema = Joi.object({
  trip_id: Joi.string().uuid().required(),
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  seats_count: Joi.number().integer().min(1).default(1),
  payment_method: Joi.string().valid('mtn', 'airtel').optional(),
  phone: Joi.string().max(20).optional(),
  passenger_name: Joi.string().max(255).optional(),
});

const cashSchema = Joi.object({
  trip_id: Joi.string().uuid().required(),
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  seats_count: Joi.number().integer().min(1).default(1),
  passenger_name: Joi.string().max(255).required(),
  passenger_phone: Joi.string().max(20).optional(),
});

const cancelSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

router.post('/', optionalAuthenticate, validate(bookSchema), ctrl.book);
router.post('/cash', authenticate, orgBlocking, authorize('create', 'Ticket'), validate(cashSchema), ctrl.bookCash);
router.get('/me', authenticate, ctrl.myTickets);
router.get('/:id', authenticate, ctrl.get);
router.get('/:id/stream', optionalAuthenticate, ctrl.stream);
router.post('/:id/cancel', authenticate, validate(cancelSchema), ctrl.cancel);
router.post('/:id/validate', authenticate, orgBlocking, authorize('validate', 'Ticket'), ctrl.validate);

router.get('/', authenticate, authorize('read', 'Ticket'), ctrl.listOrg);

export default router;
