import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';
import { initUsersSubscriber } from '../subscribers/users.subscriber.js';
import { initPaymentSubscriber } from '../subscribers/payment.subscriber.js';
import { initTaxSubscriber } from '../subscribers/tax.subscriber.js';

const RETRY_DELAY_MS = 3_000;

let connection: ChannelModel;
let publishChannel: Channel;
let consumerChannel: Channel;
let isShuttingDown = false;
let isReconnecting = false;
let isReconnectingChannel = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Health state ──────────────────────────────────────────────────────────────

type RabbitHealth = { ok: boolean; error?: string };
let rabbitHealth: RabbitHealth = { ok: false, error: 'not yet connected' };

export const getRabbitMQHealth = (): RabbitHealth => rabbitHealth;

// ── Channel setup ─────────────────────────────────────────────────────────────

const setupChannels = async (): Promise<void> => {
  publishChannel  = await connection.createChannel();
  consumerChannel = await connection.createChannel();

  // Backpressure: at most one unacked message in flight while a handler runs.
  await consumerChannel.prefetch(1);

  // Broker-owned exchanges (defined in rabbitmq/config/definitions.json) are checkExchange'd
  // so a missing one fails fast instead of being silently re-declared with wrong parameters.
  // `trips` is also broker-defined but we own it and publish to it, so we assert (idempotent
  // with matching params). `tax` is NOT broker-defined and no other service declares it, so
  // trip-service is its de-facto owner and must assert it.
  await publishChannel.assertExchange('trips', 'topic', { durable: true });
  await publishChannel.checkExchange('logs');
  await publishChannel.checkExchange('notifications');
  await consumerChannel.checkExchange('users');
  await consumerChannel.checkExchange('payment');
  await consumerChannel.assertExchange('tax', 'topic', { durable: true });

  await consumerChannel.assertQueue('users-trip-svc', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'users.dlx' },
  });
  await consumerChannel.bindQueue('users-trip-svc', 'users', 'org.events');
  await consumerChannel.bindQueue('users-trip-svc', 'users', 'user.events');

  await consumerChannel.assertQueue('payment-trip-svc', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'payment.dlx' },
  });
  // Bind only the ticket-payment outcomes the bridge handles. topup.*/wallet.events on the
  // same exchange are for user-service. Drop the legacy catch-all `#` (idempotent no-op once
  // gone) so this queue stops receiving — and DLX'ing churn from — events it never used.
  await consumerChannel.bindQueue('payment-trip-svc', 'payment', 'payment.confirmed');
  await consumerChannel.bindQueue('payment-trip-svc', 'payment', 'payment.failed');
  await consumerChannel.unbindQueue('payment-trip-svc', 'payment', '#');

  await consumerChannel.assertQueue('tax-trip-svc', { durable: true });
  await consumerChannel.bindQueue('tax-trip-svc', 'tax', '#');

  // (Re)attach consumers on the fresh channel — must run on every (re)connect,
  // otherwise the queues exist with nothing consuming them after a reconnect.
  await initUsersSubscriber(consumerChannel);
  await initPaymentSubscriber(consumerChannel);
  await initTaxSubscriber(consumerChannel);

  rabbitHealth = { ok: true };
  console.warn('[rabbitmq] Connected — consumers listening');

  // Channel-level handlers — a broker-forced channel close kills the consumer
  // without closing the connection. Recreate channels without a full reconnect.
  for (const [name, ch] of [
    ['publish', publishChannel],
    ['consumer', consumerChannel],
  ] as [string, Channel][]) {
    ch.on('error', (err: Error) => {
      console.warn(`[rabbitmq] ${name}Channel error:`, err.message);
    });
    ch.on('close', () => {
      if (isShuttingDown || isReconnecting || isReconnectingChannel) return;
      isReconnectingChannel = true;
      rabbitHealth = { ok: false, error: `${name}Channel closed — re-creating` };
      console.warn(`[rabbitmq] ${name}Channel closed — re-creating in ${RETRY_DELAY_MS / 1000}s`);
      setTimeout(() => {
        void setupChannels()
          .catch((err: Error) => {
            console.warn('[rabbitmq] Failed to re-create channels:', err.message);
          })
          .finally(() => {
            isReconnectingChannel = false;
          });
      }, RETRY_DELAY_MS);
    });
  }
};

// ── Connection setup ──────────────────────────────────────────────────────────

const setup = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      connection = await amqplib.connect(config.rabbitmq.url);
      break;
    } catch {
      console.warn(`[rabbitmq] Broker not ready (attempt ${attempt}) — retrying in ${RETRY_DELAY_MS / 1000}s`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  // Register BEFORE channel work — if setupChannels() throws, the connection
  // still has a close handler so scheduleReconnect fires correctly.
  connection.on('close', scheduleReconnect);
  connection.on('error', (err: Error) => {
    console.warn('[rabbitmq] Connection error:', err.message);
  });

  await setupChannels();
};

const scheduleReconnect = (): void => {
  if (isShuttingDown || isReconnecting) return;
  isReconnecting = true;
  rabbitHealth = { ok: false, error: 'connection lost — reconnecting' };
  console.warn('[rabbitmq] Connection lost — reconnecting...');

  void (async () => {
    for (;;) {
      await sleep(RETRY_DELAY_MS);
      try {
        await setup();
        isReconnecting = false;
        return;
      } catch (err) {
        console.warn('[rabbitmq] Reconnect attempt failed:', (err as Error).message);
        try { await connection?.close(); } catch { /* already closed */ }
      }
    }
  })();
};

// ── Public API ────────────────────────────────────────────────────────────────

export const getRabbitMQChannel = (): Channel => {
  if (!publishChannel) throw new Error('RabbitMQ publish channel not initialized');
  return publishChannel;
};

export const initRabbitMQ = async (): Promise<void> => {
  await setup();
};

export const closeRabbitMQ = async (): Promise<void> => {
  isShuttingDown = true;
  await consumerChannel?.close();
  await publishChannel?.close();
  await connection?.close();
};
