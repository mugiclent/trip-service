import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { buildAbilityFromRules } from '../utils/ability.js';
import type { Actions, Subjects, AuthenticatedUser } from '../utils/ability.js';

export const authorize = (action: Actions, subject: Subjects) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const ability = buildAbilityFromRules((req.user as AuthenticatedUser).rules);
    if (!ability.can(action, subject)) return next(new AppError('FORBIDDEN', 403));
    next();
  };
