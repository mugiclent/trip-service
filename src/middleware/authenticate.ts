import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import type { AppRule } from '../utils/ability.js';

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const id        = req.headers['x-user-id'] as string | undefined;
  const org_id    = (req.headers['x-org-id'] as string | undefined) ?? null;
  const user_type = (req.headers['x-user-type'] as string | undefined) ?? 'passenger';
  const roles     = req.headers['x-user-roles'] as string | undefined;
  const rules     = req.headers['x-user-rules'] as string | undefined;
  const locale    = (req.headers['x-user-locale'] as string | undefined) ?? 'rw';
  const phone     = (req.headers['x-user-phone'] as string | undefined) ?? null;

  if (!id) return next(new AppError('UNAUTHORIZED', 401));

  try {
    const packedRules = JSON.parse(rules ?? '[]') as PackRule<AppRule>[];
    req.user = {
      id,
      org_id,
      user_type: user_type as 'passenger' | 'staff',
      role_slugs: roles ? (JSON.parse(roles) as string[]) : [],
      rules: unpackRules(packedRules),
      locale,
      phone,
    };
    next();
  } catch {
    next(new AppError('UNAUTHORIZED', 401));
  }
};

export const optionalAuthenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const id = req.headers['x-user-id'] as string | undefined;
  if (!id) return next();
  authenticate(req, _res, next);
};
