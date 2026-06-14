import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/buses.controller.js';

const router = Router();

const createSchema = Joi.object({
  plate: Joi.string().max(20).required(),
  type: Joi.string().max(100).required(),
  capacity: Joi.number().integer().min(1).required(),
  driver_id: Joi.string().uuid().allow(null).optional(),
  route_ids: Joi.array().items(Joi.string().uuid()).optional(),
  org_id: Joi.string().uuid().optional(), // platform scope only; ignored for org callers
});

const updateSchema = Joi.object({
  plate: Joi.string().max(20).optional(),
  type: Joi.string().max(100).optional(),
  capacity: Joi.number().integer().min(1).optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  driver_id: Joi.string().uuid().allow(null).optional(),
  route_ids: Joi.array().items(Joi.string().uuid()).optional(),
}).min(1);

router.get('/', authenticate, orgBlocking, authorize('read', 'Bus'), ctrl.list);
router.get('/:id', authenticate, orgBlocking, authorize('read', 'Bus'), ctrl.get);
router.get('/:id/trips', authenticate, orgBlocking, authorize('read', 'Bus'), ctrl.trips);
router.post('/', authenticate, orgBlocking, authorize('create', 'Bus'), validate(createSchema), ctrl.create);
router.patch('/:id', authenticate, orgBlocking, authorize('update', 'Bus'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, orgBlocking, authorize('delete', 'Bus'), ctrl.remove);

export default router;
