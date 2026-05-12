import 'dotenv/config';
import { config } from './config/index.js';
import { buildApp } from './loaders/express.js';
import { initPrisma } from './loaders/prisma.js';
import { initRedis } from './loaders/redis.js';
import { initRabbitMQ, closeRabbitMQ } from './loaders/rabbitmq.js';
import { initBullMQ, closeBullMQ } from './loaders/bullmq.js';
import { initUsersSubscriber } from './subscribers/users.subscriber.js';
import { initPaymentSubscriber } from './subscribers/payment.subscriber.js';
import { initTaxSubscriber } from './subscribers/tax.subscriber.js';
import { prisma } from './models/index.js';

const start = async (): Promise<void> => {
  await initPrisma();
  initRedis();
  await initRabbitMQ();
  initBullMQ();

  await initUsersSubscriber();
  await initPaymentSubscriber();
  await initTaxSubscriber();

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
