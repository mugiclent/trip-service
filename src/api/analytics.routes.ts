import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateQuery } from '../middleware/validate.js';
import * as ctrl from '../controllers/analytics.controller.js';

const router = Router();

const overviewSchema = Joi.object({
  period: Joi.string().valid('today', 'yesterday', 'this_week', 'this_month', 'custom').default('today'),
  // Required (and only used) when period=custom. Local calendar days in `tz`, inclusive.
  from: Joi.string().isoDate().when('period', { is: 'custom', then: Joi.required() }),
  to: Joi.string().isoDate().when('period', { is: 'custom', then: Joi.required() }),
  // IANA zone; constrained to a safe shape (the value is also a bound SQL parameter).
  tz: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9+_\-/]{1,63}$/).default('Africa/Kigali'),
  org_id: Joi.string().uuid(), // platform-admin only; ignored for org-scoped callers
  peak: Joi.string().valid('hour', 'day').default('hour'),
  compare: Joi.boolean().default(true),
});

// Single analytics endpoint. Requires `read` on `Report`; scope (platform vs org) is
// derived from the caller's rules inside the service.
router.get('/overview', authenticate, authorize('read', 'Report'), validateQuery(overviewSchema), ctrl.overview);

export default router;
