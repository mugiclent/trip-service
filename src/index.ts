import 'dotenv/config';
import { config } from './config/index.js';
import { buildApp } from './loaders/express.js';
import { initPrisma } from './loaders/prisma.js';
import { initRedis } from './loaders/redis.js';
import { initRabbitMQ, closeRabbitMQ } from './loaders/rabbitmq.js';
import { initBullMQ, closeBullMQ } from './loaders/bullmq.js';
import { bootstrap } from './loaders/bootstrap.js';
import { prisma } from './models/index.js';

const start = async (): Promise<void> => {
  await initPrisma();
  // Idempotently sync the canonical reference network (stops, routes, fares).
  await bootstrap();
  initRedis();
  // Subscribers are (re)attached inside the RabbitMQ loader's setupChannels, so
  // they survive reconnects — no separate init needed here.
  await initRabbitMQ();
  initBullMQ();

  const app = buildApp();
  const server = app.listen(config.port, () => {
    console.warn(`[server] trip-svc listening on port ${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`[server] ${signal} — shutting down`);
    server.close(async () => {
      await closeBullMQ();
      await prisma.$disconnect();
      await closeRabbitMQ();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
};

start().catch((err) => {
  console.error('[server] Failed to start', err);
  process.exit(1);
});
