import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/prices.controller.js';

const router = Router();

const createSchema = Joi.object({
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  amount: Joi.number().integer().min(0).required(),
});

const upsertSchema = Joi.object({
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  amount: Joi.number().integer().min(0).required(),
  currency: Joi.string().length(3).optional(),
});

const updateSchema = Joi.object({
  amount: Joi.number().integer().min(0).required(),
});

const bulkSchema = Joi.object({
  prices: Joi.array().items(Joi.object({
    boarding_stop_id: Joi.string().uuid().required(),
    alighting_stop_id: Joi.string().uuid().required(),
    amount: Joi.number().integer().min(0).required(),
  })).min(1).required(),
});

// Public fare browsing: anonymous callers get the platform defaults; a logged-in
// org's staff get their effective (overridden) fares via optionalAuthenticate.
router.get('/', optionalAuthenticate, ctrl.get);
router.get('/list', optionalAuthenticate, ctrl.list);
router.post('/', authenticate, authorize('create', 'Price'), validate(createSchema), ctrl.create);
router.put('/', authenticate, authorize('create', 'Price'), validate(upsertSchema), ctrl.upsert);
router.patch('/:id', authenticate, authorize('update', 'Price'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, authorize('delete', 'Price'), ctrl.remove);
router.post('/bulk', authenticate, authorize('create', 'Price'), validate(bulkSchema), ctrl.bulkUpsert);

export default router;
