import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/routes.controller.js';

const router = Router();

const createSchema = Joi.object({
  stop_ids: Joi.array().items(Joi.string().uuid()).min(2).required(),
  name: Joi.string().max(255).optional(),
  org_id: Joi.string().uuid().optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().max(255).optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

const addStopSchema = Joi.object({
  stop_id: Joi.string().uuid().required(),
  order: Joi.number().integer().min(1).required(),
});

const reorderSchema = Joi.object({
  order: Joi.number().integer().min(1).required(),
});

router.get('/', optionalAuthenticate, ctrl.list);
router.get('/:id', optionalAuthenticate, ctrl.get);
router.post('/', authenticate, orgBlocking, authorize('create', 'Route'), validate(createSchema), ctrl.create);
router.patch('/:id', authenticate, orgBlocking, authorize('update', 'Route'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, orgBlocking, authorize('delete', 'Route'), ctrl.remove);
router.post('/:id/stops', authenticate, orgBlocking, authorize('update', 'Route'), validate(addStopSchema), ctrl.addStop);
router.delete('/:id/stops/:stopId', authenticate, orgBlocking, authorize('update', 'Route'), ctrl.removeStop);
router.patch('/:id/stops/:stopId', authenticate, orgBlocking, authorize('update', 'Route'), validate(reorderSchema), ctrl.reorderStop);

export default router;
