import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/trips.controller.js';
import * as manifestCtrl from '../controllers/manifest.controller.js';

const router = Router();

const createSchema = Joi.object({
  route_id: Joi.string().uuid().required(),
  bus_id: Joi.string().uuid().optional(),
  driver_id: Joi.string().uuid().optional(),
  total_seats: Joi.number().integer().min(1).optional(),
  is_express: Joi.boolean().default(false),
  departure_time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  starts_on: Joi.string().isoDate().required(),
  repeat_daily: Joi.boolean().default(false),
  frequency_minutes: Joi.valid(null, 30, 60, 90, 120, 180, 240).optional(),
  ends_on: Joi.string().isoDate().allow(null).optional(),
});

const updateSchema = Joi.object({
  scope: Joi.string().valid('this', 'future').required(),
  departure_time: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
  bus_id: Joi.string().uuid().allow(null).optional(),
  driver_id: Joi.string().uuid().allow(null).optional(),
  total_seats: Joi.number().integer().min(1).optional(),
  is_express: Joi.boolean().optional(),
  cancellation_allowed: Joi.boolean().optional(),
}).min(2);

const cancelSchema = Joi.object({
  scope: Joi.string().valid('this', 'future').required(),
  reason: Joi.string().max(500).optional(),
});

router.get('/', optionalAuthenticate, ctrl.list);
router.get('/:id', optionalAuthenticate, ctrl.getById);
router.post('/', authenticate, orgBlocking, authorize('create', 'Trip'), validate(createSchema), ctrl.create);
router.patch('/:id', authenticate, orgBlocking, authorize('update', 'Trip'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, orgBlocking, authorize('cancel', 'Trip'), validate(cancelSchema), ctrl.cancel);
router.post('/:id/activate', authenticate, orgBlocking, authorize('update', 'Trip'), ctrl.activate);
router.post('/:id/complete', authenticate, orgBlocking, authorize('update', 'Trip'), ctrl.complete);
router.get('/:id/manifest', authenticate, orgBlocking, authorize('read_manifest', 'Trip'), manifestCtrl.get);

export default router;
