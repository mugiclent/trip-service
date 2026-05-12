import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { orgBlocking } from '../middleware/orgBlocking.js';
import * as ctrl from '../controllers/driver.controller.js';

const router = Router();

router.get('/trips', authenticate, orgBlocking, ctrl.myTrips);

export default router;
