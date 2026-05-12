import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';

let connection: ChannelModel;
let publishChannel: Channel;
let consumerChannel: Channel;

const connectWithRetry = async (): Promise<ChannelModel> => {
  for (;;) {
    try {
      const conn = await amqplib.connect(config.rabbitmq.url);
      console.warn('[rabbitmq] Connected');
      return conn;
    } catch (err) {
      console.error('[rabbitmq] Connection failed, retrying in 3s', err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

export const initRabbitMQ = async (): Promise<void> => {
  connection = await connectWithRetry();

  connection.on('close', () => {
    console.warn('[rabbitmq] Connection closed — reconnecting');
    void initRabbitMQ();
  });

  publishChannel = await connection.createChannel();
  consumerChannel = await connection.createChannel();
  await consumerChannel.prefetch(1);

  // Assert own exchange
  await publishChannel.assertExchange('trips', 'topic', { durable: true });

  // Assert shared exchanges we publish to
  await publishChannel.assertExchange('logs', 'topic', { durable: true });
  await publishChannel.assertExchange('notifications', 'topic', { durable: true });

  // Assert exchanges we consume from (idempotent — producers assert these too)
  await consumerChannel.assertExchange('users', 'topic', { durable: true });
  await consumerChannel.assertExchange('payment', 'topic', { durable: true });
  await consumerChannel.assertExchange('tax', 'topic', { durable: true });

  // Assert consumer queues + bindings
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
  await consumerChannel.bindQueue('payment-trip-svc', 'payment', '#');

  await consumerChannel.assertQueue('tax-trip-svc', {
    durable: true,
  });
  await consumerChannel.bindQueue('tax-trip-svc', 'tax', '#');
};

export const getRabbitMQChannel = (): Channel => {
  if (!publishChannel) throw new Error('RabbitMQ publish channel not initialized');
  return publishChannel;
};

export const getConsumerChannel = (): Channel => {
  if (!consumerChannel) throw new Error('RabbitMQ consumer channel not initialized');
  return consumerChannel;
};

export const closeRabbitMQ = async (): Promise<void> => {
  await consumerChannel?.close();
  await publishChannel?.close();
  await connection?.close();
};
