import express from 'express';
import type { Application, Request, Response } from 'express';
import helmet from 'helmet';
import { config } from '../config/index.js';
import { createSwaggerRouter } from './swagger.js';
import healthRouter from '../api/health.routes.js';
import locationsRouter from '../api/locations.routes.js';
import routesRouter from '../api/routes.routes.js';
import pricesRouter from '../api/prices.routes.js';
import busesRouter from '../api/buses.routes.js';
import tripsRouter from '../api/trips.routes.js';
import ticketsRouter from '../api/tickets.routes.js';
import driverRouter from '../api/driver.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

export const buildApp = (): Application => {
  const app = express();

  app.set('trust proxy', 1);

  // Mount docs before helmet so swagger-ui inline scripts are not blocked by CSP
  app.use('/api/v1/trips/docs', createSwaggerRouter());

  app.use(helmet());
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/routes', routesRouter);
  app.use('/api/v1/prices', pricesRouter);
  app.use('/api/v1/buses', busesRouter);
  app.use('/api/v1/trips', tripsRouter);
  app.use('/api/v1/tickets', ticketsRouter);
  app.use('/api/v1/driver', driverRouter);
  app.use('/health', healthRouter);

  app.use(errorHandler);

  return app;
};

// Suppress unused import warning for config (used via module side effects)
void config;
