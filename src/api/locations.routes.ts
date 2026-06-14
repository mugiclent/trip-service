import { Router } from 'express';
import Joi from 'joi';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/locations.controller.js';

const router = Router();

const PROVINCES = ['Kigali City', 'Northern Province', 'Southern Province', 'Eastern Province', 'Western Province'];

const createSchema = Joi.object({
  name: Joi.string().max(255).required(),
  province: Joi.string().valid(...PROVINCES).optional(),
  lat: Joi.number().required(),
  lng: Joi.number().required(),
  city: Joi.string().max(255).optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().max(255).optional(),
  province: Joi.string().valid(...PROVINCES).optional(),
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  city: Joi.string().max(255).optional(),
}).min(1);

router.get('/', optionalAuthenticate, ctrl.list);
router.get('/:id', optionalAuthenticate, ctrl.get);
router.post('/', authenticate, authorize('create', 'Location'), validate(createSchema), ctrl.create);
router.patch('/:id', authenticate, authorize('update', 'Location'), validate(updateSchema), ctrl.update);
router.delete('/:id', authenticate, authorize('delete', 'Location'), ctrl.remove);

export default router;
