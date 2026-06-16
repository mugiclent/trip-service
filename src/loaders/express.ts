import express from 'express';
import type { Application, Request, Response } from 'express';
import helmet from 'helmet';
import { config } from '../config/index.js';
import { createSwaggerRouter } from './swagger.js';
import { checkDbHealth } from './prisma.js';
import { getRabbitMQHealth } from './rabbitmq.js';
import { getRedisHealth } from './redis.js';
import locationsRouter from '../api/locations.routes.js';
import routesRouter from '../api/routes.routes.js';
import pricesRouter from '../api/prices.routes.js';
import busesRouter from '../api/buses.routes.js';
import tripsRouter from '../api/trips.routes.js';
import ticketsRouter from '../api/tickets.routes.js';
import driverRouter from '../api/driver.routes.js';
import analyticsRouter from '../api/analytics.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

export const buildApp = (): Application => {
  const app = express();

  app.set('trust proxy', 1);

  // Mount docs before helmet so swagger-ui inline scripts are not blocked by CSP
  app.use('/api/v1/trips/docs', createSwaggerRouter());

  app.use(helmet());
  app.use(express.json());

  // Health — unauthenticated, for gateway / load-balancer probes. Reports each
  // hard dependency and returns 503 when any is down (per platform contract).
  app.get('/health', (_req: Request, res: Response) => {
    void (async () => {
      const [db, rabbit, redis] = await Promise.all([
        checkDbHealth(),
        Promise.resolve(getRabbitMQHealth()),
        Promise.resolve(getRedisHealth()),
      ]);
      const allOk = db.ok && rabbit.ok && redis.ok;
      res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ok' : 'degraded',
        service: 'trip-svc',
        timestamp: new Date().toISOString(),
        checks: {
          database: db.ok ? 'up' : { status: 'down', error: db.error },
          rabbitmq: rabbit.ok ? 'up' : { status: 'down', error: rabbit.error },
          redis: redis.ok ? 'up' : { status: 'down', error: redis.error },
        },
      });
    })();
  });

  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/routes', routesRouter);
  app.use('/api/v1/prices', pricesRouter);
  app.use('/api/v1/buses', busesRouter);
  app.use('/api/v1/trips', tripsRouter);
  app.use('/api/v1/tickets', ticketsRouter);
  app.use('/api/v1/driver', driverRouter);
  app.use('/api/v1/analytics', analyticsRouter);

  app.use(errorHandler);

  return app;
};

// Suppress unused import warning for config (used via module side effects)
void config;
