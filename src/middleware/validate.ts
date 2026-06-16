import type { Request, Response, NextFunction } from 'express';
import type Joi from 'joi';
import { AppError } from '../utils/AppError.js';

export const validate =
  (schema: Joi.ObjectSchema) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return next(new AppError('VALIDATION_ERROR', 422, error.details));
    req.body = value;
    next();
  };

export const validateQuery =
  (schema: Joi.ObjectSchema) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, { abortEarly: false });
    if (error) return next(new AppError('VALIDATION_ERROR', 422, error.details));
    // Express 5 exposes `req.query` via a getter-only accessor on the prototype, so a
    // plain assignment throws in strict mode. Define an own data property instead to
    // shadow it with the validated/coerced value (defaults applied, types converted).
    Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
    next();
  };
