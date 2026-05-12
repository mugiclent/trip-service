import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/prices.controller.js';

const router = Router();

const createSchema = Joi.object({
  boarding_stop_id: Joi.string().uuid().required(),
  alighting_stop_id: Joi.string().uuid().required(),
  amount: Joi.number().integer().min(0).required(),
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

router.get('/', ctrl.get);
router.post('/', authenticate, authorize('create', 'Price'), validate(createSchema), ctrl.create);
router.patch('/:id', authenticate, authorize('update', 'Price'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, authorize('delete', 'Price'), ctrl.remove);
router.post('/bulk', authenticate, authorize('create', 'Price'), validate(bulkSchema), ctrl.bulkUpsert);

export default router;
