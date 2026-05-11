# Trip Service — Build Specification

This is a complete prompt for Claude Code to bootstrap the `trip-svc` microservice.
Read every section before writing any code. All decisions here are final unless
explicitly marked as flexible.

---

## What this service does

The trip service manages the core transport domain: routes, buses, trips, locations,
and ticket sales. It is the largest domain service on the platform. This SPEC covers
only the infrastructure bootstrapping — the business domain will be added incrementally.

---

## Before you start — read these files

The platform has shared conventions that **all** services must follow. Read them
before touching any code:

1. `../CLAUDE.md` — platform-wide contracts (ports, headers, error shape, RabbitMQ topology, pgbouncer rules). Hard constraints — violating them breaks other services silently.
2. `../user-service/skills/DEVOPS.md` — canonical Dockerfile, docker-compose, CI/CD pipeline pattern.
3. `../user-service/skills/PRISMA.md` — Prisma 7 conventions: `prisma.config.ts`, two connection strings, migration workflow, shadow DB.
4. `../user-service/skills/SERVICE.md` — service layer conventions, AppError, publishers.
5. `../user-service/skills/CONTROLLER.md` — controller pattern (thin HTTP adapter, always try/catch → next(err)).
6. `../user-service/skills/ROUTE.md` — route file conventions, middleware ordering, authorize() gate.
7. `../user-service/skills/CONFIG.md` — env validation with Joi, fail-fast at startup.
8. `../user-service/skills/OPENAPI.md` — when and how to keep `docs/openapi.yaml` in sync.

Do not substitute patterns. If a skill file says "always do X", do X.

---

## Platform services this service integrates with

### Services it calls or receives identity from

| Service | Container | Port | How trip-svc talks to it |
|---|---|---|---|
| `api-gw` | `katisha-api-gw` | `8090` | Receives identity headers — never verify JWTs directly |
| `user-svc` | `user-svc` | `8091` | **Never call directly** — consume RabbitMQ events instead |
| `payment-svc` | `payment-svc` | `8098` | Publishes ticket payment requests via `trips` exchange; consumes payment events via `payment` exchange |
| `notification-svc` | `notifications-svc` | `8100` | Publish to `notifications` exchange (sms/mail/push) — never call directly |
| `audit-svc` | `audit-svc` | `8101` | Publish to `logs` exchange (audit.logs) — never call directly |

### Infrastructure services (never connect to directly except as noted)

| Container | Port | How to connect |
|---|---|---|
| `pgbouncer` | `6432` | `DATABASE_URL` for app runtime — **never** use `db:5432` at runtime |
| `db` | `5432` | `DIRECT_DATABASE_URL` for Prisma CLI migrations only |
| `redis` | `6379` | `ioredis` for rate limiting and caching |
| `rabbitmq` | `5672` | `amqplib` — see topology section below |

---

## Identity — how authentication works

The `api-gw` is the **only** service that verifies JWTs. It strips the
`Authorization` header and injects these headers before proxying to this service:

| Header | Type | Notes |
|---|---|---|
| `X-User-ID` | `string` (UUID) | Always present on authenticated routes |
| `X-Org-ID` | `string` (UUID) \| absent | Omitted for passengers |
| `X-User-Type` | `"passenger"` \| `"staff"` | Always present |
| `X-User-Roles` | JSON `string[]` | Role slugs |
| `X-User-Rules` | JSON `PackRule[]` | Packed CASL rules |
| `X-User-Locale` | `"rw"` \| `"en"` \| `"fr"` | User's preferred locale |

**Never install Passport, never call `jsonwebtoken.verify`.** Trust these headers
unconditionally. The `authenticate` middleware reconstructs `req.user` from them:

```typescript
// src/middleware/authenticate.ts
import { unpackRules } from '@casl/ability/extra';
import type { Request, Response, NextFunction } from 'express';

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const id        = req.headers['x-user-id'] as string | undefined;
  const org_id    = req.headers['x-org-id']  as string | undefined ?? null;
  const user_type = (req.headers['x-user-type'] as string | undefined) ?? 'passenger';
  const roles     = req.headers['x-user-roles'] as string | undefined;
  const rules     = req.headers['x-user-rules'] as string | undefined;
  const locale    = (req.headers['x-user-locale'] as string | undefined) ?? 'rw';

  if (!id) return next(new AppError('UNAUTHORIZED', 401));

  req.user = {
    id,
    org_id,
    user_type,
    role_slugs: roles ? (JSON.parse(roles) as string[]) : [],
    rules:      rules ? unpackRules(JSON.parse(rules)) : [],
    locale,
  };
  next();
};
```

Copy the `AuthenticatedUser` type and `buildAbilityFromRules` / `getScopeFor`
utils from `../user-service/src/utils/ability.ts` — they are platform-shared.

---

## RabbitMQ topology

### This service owns the `trips` exchange

```
trips (topic exchange) — owned by trip-svc, only trip-svc publishes here
  routing keys:
    trip.events          → consumed by downstream services (booking, billing)
    ticket.events        → consumed by payment-svc
```

### Exchanges this service subscribes to

| Exchange | Queue name | Routing key | What it carries |
|---|---|---|---|
| `users` | `users-trip-svc` | `org.events` | `org.activated`, `org.updated`, `org.suspended` — keep a local org cache |
| `payment` | `payment-trip-svc` | `#` | `ticket.payment.confirmed`, `refund.completed` |

### Exchanges this service publishes to (shared)

| Exchange | Routing key | Purpose |
|---|---|---|
| `notifications` | `sms.notifications` | SMS to passengers / drivers |
| `notifications` | `mail.notifications` | Email receipts, confirmations |
| `notifications` | `push.notifications` | Push to mobile app |
| `logs` | `audit.logs` | Audit trail for every state-changing action |

### DLX convention

Every consumer queue must be asserted with `x-dead-letter-exchange`:

```typescript
await ch.assertQueue('users-trip-svc', {
  durable: true,
  arguments: { 'x-dead-letter-exchange': 'users.dlx' },
});
await ch.assertQueue('payment-trip-svc', {
  durable: true,
  arguments: { 'x-dead-letter-exchange': 'payment.dlx' },
});
```

These DLX exchanges already exist on the broker — the user-service and payment-service
asserted them. Do not declare them here; just reference them.

### RabbitMQ loader pattern

Model the loader exactly after `../user-service/src/loaders/rabbitmq.ts`:
- `connectWithRetry` — loops forever until the broker accepts a connection (3 s delay)
- Separate `publishChannel` and `consumerChannel` (consumer has `prefetch(1)`)
- Auto-reconnect on unexpected `connection.on('close')` 
- `initRabbitMQ()` asserts the `trips` exchange + all consumer queues + bindings
- `closeRabbitMQ()` closes channels then connection

```typescript
// Assert own exchange
await publishChannel.assertExchange('trips', 'topic', { durable: true });

// Assert consumer queues + bindings
await consumerChannel.assertQueue('users-trip-svc', {
  durable: true,
  arguments: { 'x-dead-letter-exchange': 'users.dlx' },
});
await consumerChannel.bindQueue('users-trip-svc', 'users', 'org.events');

await consumerChannel.assertQueue('payment-trip-svc', {
  durable: true,
  arguments: { 'x-dead-letter-exchange': 'payment.dlx' },
});
await consumerChannel.bindQueue('payment-trip-svc', 'payment', '#');
```

---

## Database

### Connection strings — two, always

| Variable | Points to | Used by |
|---|---|---|
| `DATABASE_URL` | `pgbouncer:6432` (transaction mode) | App runtime (`src/models/index.ts`) |
| `DIRECT_DATABASE_URL` | `db:5432` (direct PostgreSQL) | Prisma CLI (`migrate dev`, `migrate deploy`) |
| `SHADOW_DATABASE_URL` | `db:5432/katisha_trips_shadow` | `migrate dev` local shadow DB only |

**Never** use `db:5432` in the running application. All runtime queries go through
`pgbouncer:6432`.

The `DATABASE_URL` connection string must include PgBouncer flags:
```
postgresql://trip_svc:<password>@pgbouncer:6432/katisha_trips?pgbouncer=true&connect_timeout=5&pool_timeout=5
```

### `prisma.config.ts` (project root)

```typescript
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env['DIRECT_DATABASE_URL']!,
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
```

**No `url` in the `datasource` block inside `schema.prisma`.** Prisma 7 reads the
connection from `prisma.config.ts` only.

### DB init script

Create `../db/init/08-trip-service.sql` (same pattern as `07-user-service.sql`):

```sql
-- trip-svc: postgres user, database, and permissions.
-- Idempotent — safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trip_svc') THEN
    CREATE USER trip_svc;
  END IF;
END
$$;

SELECT 'CREATE DATABASE katisha_trips OWNER trip_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'katisha_trips')\gexec

GRANT ALL PRIVILEGES ON DATABASE katisha_trips TO trip_svc;

SELECT 'CREATE DATABASE katisha_trips_shadow OWNER trip_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'katisha_trips_shadow')\gexec

GRANT ALL PRIVILEGES ON DATABASE katisha_trips_shadow TO trip_svc;
```

### pgbouncer.ini

Add to `../pgbouncer/config/pgbouncer.ini` under `[databases]`:
```ini
katisha_trips = host=db port=5432 dbname=katisha_trips
```

After adding, send SIGHUP (not restart) to pgbouncer — see CLAUDE.md for the procedure.

---

## Redis

Use `ioredis` exactly as in `../user-service/src/loaders/redis.ts`:

```typescript
import { Redis } from 'ioredis';
import { config } from '../config/index.js';

let redisClient: Redis;

export const initRedis = (): void => {
  redisClient = new Redis(config.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  redisClient.on('error', (err: Error) => {
    console.error('[redis] Connection error', err);
  });
};

export const getRedisClient = (): Redis => {
  if (!redisClient) throw new Error('Redis client not initialized');
  return redisClient;
};
```

---

## Notification service

Never call the notification service directly. Always publish to the `notifications`
exchange on RabbitMQ. The notification-svc consumes the `sms` and `mail` queues.

The canonical event types (SMS, mail, push) are defined in
`../user-service/src/utils/publishers.ts`. When the trip service needs a new
notification type (e.g. `trip.booking.confirmed`), add it there — that file is
the platform-wide type registry for notification events.

Event envelope (required on every message published to any exchange):
```json
{
  "event_id": "<uuid-v4>",
  "version": 1,
  "source": "trip-service",
  "timestamp": "<ISO-8601>",
  ...eventPayload
}
```

`source` must be `"trip-service"` (kebab-case, matches the service directory name).

---

## Tech stack

| Concern | Package |
|---|---|
| Runtime | Node.js 22 + TypeScript (strict) |
| HTTP framework | Express 5 |
| ORM | Prisma 7 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`) |
| DB driver | `pg` (via `@prisma/adapter-pg`) |
| Redis | `ioredis` |
| Message broker | `amqplib` |
| Authorization | `@casl/ability` (copy ability utils from user-service) |
| Validation | `joi` |
| Env validation | `joi` (fail-fast at startup) |
| Linter | ESLint (typescript-eslint) |

No Passport. No JWT verification. No `jsonwebtoken`. No test runner yet.

---

## Project structure

```
trip-service/
  src/
    api/                  # Controllers + route files (flat, no subfolders)
      health.routes.ts    # GET /health
    config/
      env.ts              # Joi schema — validates process.env at startup
      index.ts            # Typed config object — never use process.env outside here
    loaders/
      express.ts          # App factory, mounts all routers, error handler
      rabbitmq.ts         # initRabbitMQ, getRabbitMQChannel, getConsumerChannel, closeRabbitMQ
      redis.ts            # initRedis, getRedisClient
      prisma.ts           # initPrisma (test connection + log)
    middleware/
      authenticate.ts     # Reconstructs req.user from X-User-* headers
      authorize.ts        # Route-level CASL gate (copy from user-service)
      errorHandler.ts     # Maps AppError + unknown errors → platform wire format
      validate.ts         # Joi request body validator factory
    models/
      index.ts            # PrismaClient with PrismaPg adapter — DATABASE_URL
    subscribers/
      users.subscriber.ts   # Consumes users-trip-svc queue (org.events)
      payment.subscriber.ts # Consumes payment-trip-svc queue (ticket/refund events)
    utils/
      AppError.ts         # class AppError extends Error { code, status, details }
      ability.ts          # buildAbilityFromRules, getScopeFor — copy from user-service
      publishers.ts       # publish helpers: publishAudit, publishSms, publishMail, publishPush, publishTripEvent
  prisma/
    schema.prisma         # Minimal schema for now (just generator + datasource)
  docs/
    openapi.yaml          # Start with skeleton — expand as endpoints are added
  tests/                  # Empty for now — tests will be added later
  prisma.config.ts        # DIRECT_DATABASE_URL datasource — required for Prisma 7
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  .dockerignore
  tsconfig.json
  tsconfig.eslint.json
  eslint.config.mjs
  package.json
```

---

## Environment variables

Validate with Joi at startup. Crash immediately on missing/invalid vars.

```typescript
// src/config/env.ts
const schema = Joi.object({
  NODE_ENV:  Joi.string().valid('development', 'test', 'production').required(),
  PORT:      Joi.number().default(8092),

  // Database — credentials only; host/port default to pgbouncer/db
  DB_USER:     Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME:     Joi.string().required(),
  DB_HOST:     Joi.string().default('pgbouncer'),
  DB_PORT:     Joi.number().default(6432),

  // Migrations — direct connection (bypass pgbouncer)
  DIRECT_DATABASE_URL: Joi.string().uri().optional(), // required by prisma.config.ts, not app
  SHADOW_DATABASE_URL: Joi.string().uri().optional(), // local dev only

  // Redis
  REDIS_PASSWORD: Joi.string().required(),
  REDIS_HOST:     Joi.string().default('redis'),
  REDIS_PORT:     Joi.number().default(6379),

  // RabbitMQ
  RABBITMQ_USER:     Joi.string().required(),
  RABBITMQ_PASSWORD: Joi.string().required(),
  RABBITMQ_HOST:     Joi.string().default('rabbitmq'),
  RABBITMQ_PORT:     Joi.number().default(5672),
});
```

The `config/index.ts` builds the connection strings from the parts:

```typescript
db: {
  url: `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}?pgbouncer=true&connect_timeout=5&pool_timeout=5`,
},
redis: {
  url: `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}`,
},
rabbitmq: {
  url: `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}`,
},
```

---

## Dockerfile

Two-stage build. Both stages use `node:22-bookworm-slim` (not distroless) because
the production image is also used as a migration runner in CI (needs `npm`).

```dockerfile
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Prisma 7: generate BEFORE tsc — no auto-generate on npm ci
RUN npm ci && npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
COPY docs ./docs/

RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/docs ./docs

ENV NODE_ENV=production
ENV PORT=8092

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8092/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
```

---

## docker-compose.yml

```yaml
services:
  trip-svc:
    image: ${DOCKER_USERNAME}/trip-svc:${IMAGE_TAG:-latest}
    container_name: trip-svc
    restart: unless-stopped
    environment:
      NODE_ENV:          ${NODE_ENV}
      PORT:              ${PORT}
      DB_USER:           ${DB_USER}
      DB_PASSWORD:       ${DB_PASSWORD}
      DB_NAME:           ${DB_NAME}
      REDIS_PASSWORD:    ${REDIS_PASSWORD}
      RABBITMQ_USER:     ${RABBITMQ_USER}
      RABBITMQ_PASSWORD: ${RABBITMQ_PASSWORD}
    networks:
      - katisha-net

networks:
  katisha-net:
    external: true
```

No exposed ports — nginx is the sole public entry point; trip-svc is reachable only
by container name on `katisha-net`.

---

## CI/CD pipeline (`.github/workflows/ci-cd.yml`)

Follow the user-service pipeline exactly. Three jobs: `checks → build-and-push → deploy`.

**Differences from user-service:**
- `IMAGE_NAME`: `${{ secrets.DOCKER_USERNAME }}/trip-svc`
- `DEPLOY_DIR`: `$HOME/katisha/trip-service`
- Container name in health-check loop: `trip-svc`
- Infisical path: `/trip-svc`
- DB user / DB name: `trip_svc` / `katisha_trips`
- Init migration name: replace with your first migration name once created

```yaml
name: CI / CD

on:
  push:
    branches: [main]
    paths-ignore: ['**.md']
  pull_request:
    branches: [main]
    paths-ignore: ['**.md']

env:
  IMAGE_NAME: ${{ secrets.DOCKER_USERNAME }}/trip-svc
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  checks:
    name: Type-check · Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npx eslint src/

  build-and-push:
    name: Build & push Docker image
    runs-on: ubuntu-latest
    needs: checks
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    outputs:
      image_tag: ${{ steps.meta.outputs.sha_tag }}
    steps:
      - uses: actions/checkout@v4
      - id: meta
        run: echo "sha_tag=sha-${{ github.sha }}" >> $GITHUB_OUTPUT
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_TOKEN }}
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.sha_tag }}
            ${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to production
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - uses: appleboy/ssh-action@v1.0.3
        with:
          host:     ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key:      ${{ secrets.SERVER_SSH_KEY }}
          script: |
            set -e
            export PATH="$HOME/.local/bin:$PATH"

            DEPLOY_DIR="$HOME/katisha/trip-service"
            REPO_URL="https://github.com/${{ github.repository }}.git"

            if [ -d "$DEPLOY_DIR/.git" ]; then
              cd "$DEPLOY_DIR" && git pull origin main
            else
              mkdir -p "$HOME/katisha"
              git clone "$REPO_URL" "$DEPLOY_DIR"
              cd "$DEPLOY_DIR"
            fi

            cat > .env <<ENVEOF
            DOCKER_USERNAME=${{ secrets.DOCKER_USERNAME }}
            IMAGE_TAG=${{ needs.build-and-push.outputs.image_tag }}
            ENVEOF

            INFISICAL_TOKEN=$(infisical login \
              --method=universal-auth \
              --client-id=${{ secrets.INFISICAL_CLIENT_ID }} \
              --client-secret=${{ secrets.INFISICAL_CLIENT_SECRET }} \
              --domain=http://localhost:8080 \
              --plain --silent)

            DB_PASSWORD=$(infisical secrets get DB_PASSWORD \
              --token="$INFISICAL_TOKEN" \
              --projectId=${{ secrets.INFISICAL_PROJECT_ID }} \
              --env=dev \
              --path=/trip-svc \
              --domain=http://localhost:8080 \
              --plain 2>/dev/null)

            # Baseline init migration on first deploy — || true absorbs on subsequent deploys
            docker run --rm \
              --network katisha-net \
              -e DIRECT_DATABASE_URL="postgresql://trip_svc:${DB_PASSWORD}@db:5432/katisha_trips" \
              ${{ secrets.DOCKER_USERNAME }}/trip-svc:${{ needs.build-and-push.outputs.image_tag }} \
              npx prisma migrate resolve --applied <REPLACE_WITH_FIRST_MIGRATION_NAME> || true

            docker run --rm \
              --network katisha-net \
              -e DIRECT_DATABASE_URL="postgresql://trip_svc:${DB_PASSWORD}@db:5432/katisha_trips" \
              ${{ secrets.DOCKER_USERNAME }}/trip-svc:${{ needs.build-and-push.outputs.image_tag }} \
              npm run db:deploy

            infisical run \
              --token="$INFISICAL_TOKEN" \
              --projectId=${{ secrets.INFISICAL_PROJECT_ID }} \
              --env=dev \
              --path=/trip-svc \
              --domain=http://localhost:8080 \
              -- docker compose up -d --no-deps --pull always trip-svc

            echo "Waiting for trip-svc to be healthy..."
            for i in $(seq 1 30); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' trip-svc 2>/dev/null || echo "missing")
              [ "$STATUS" = "healthy" ] && break
              [ $i -eq 30 ] && echo "Timed out waiting for trip-svc" && exit 1
              sleep 3
            done
            echo "trip-svc is up."
```

**GitHub secrets required** (same set as user-service):
`DOCKER_USERNAME`, `DOCKER_TOKEN`, `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`,
`INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`

---

## Error response shape

Every error, without exception:

```json
{ "error": { "code": "SCREAMING_SNAKE_CASE", "message": "Human readable" } }
```

With optional `details` for validation errors:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

Implement `AppError` exactly as in `../user-service/src/utils/AppError.ts` and
`errorHandler.ts` exactly as in `../user-service/src/middleware/errorHandler.ts`.

---

## api-gw route registration

After bootstrapping, add the trip-svc routes to `../config-repo/api-gw/routes.yaml`:

```yaml
  - path: /api/v1/trips
    target: http://trip-svc:8092
    auth: true

  - path: /api/v1/routes
    target: http://trip-svc:8092
    auth: true

  - path: /api/v1/buses
    target: http://trip-svc:8092
    auth: true

  - path: /api/v1/tickets
    target: http://trip-svc:8092
    auth: true
```

The api-gw polls this file every 30 s — no restart needed.

---

## ESLint + TypeScript

Follow `../user-service/skills/LINT.md` exactly:

- `tsconfig.json` covers `src/` only (`"exclude": ["tests"]`, `"rootDir": "src"`)
- `tsconfig.eslint.json` extends it, overrides `exclude` (removes `"tests"`), sets `"rootDir": "."`
- Two config blocks in `eslint.config.mjs`: `src/**` → `tsconfig.json`, `tests/**` → `tsconfig.eslint.json`
- Rules: `no-unused-vars`, `no-explicit-any`, `consistent-type-imports`, `no-require-imports`, `no-console` (allow warn/error)

Copy `eslint.config.mjs`, `tsconfig.json`, `tsconfig.eslint.json` from user-service
and adjust `rootDir`/`outDir`/`paths` for this service.

---

## package.json scripts

```json
"scripts": {
  "build":       "tsc",
  "start":       "node dist/index.js",
  "dev":         "tsx watch src/index.ts",
  "lint":        "eslint src/",
  "db:migrate":  "prisma migrate dev",
  "db:deploy":   "prisma migrate deploy",
  "db:generate": "prisma generate"
}
```

`prisma` must be in **`dependencies`** (not `devDependencies`) — it must survive
`npm prune --omit=dev` so the production container can run `migrate deploy`.

---

## Startup sequence (`src/index.ts`)

```typescript
const start = async (): Promise<void> => {
  await initPrisma();
  initRedis();
  await initRabbitMQ();   // asserts exchanges + queues + starts consumers

  const app = buildApp(); // src/loaders/express.ts
  const server = app.listen(config.port, () => {
    console.warn(`[server] trip-svc listening on port ${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`[server] ${signal} — shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      await closeRabbitMQ();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
};
```

---

## Initial Prisma schema

Start minimal — just the generator block and datasource stub. The datasource has
**no `url` field** (Prisma 7 reads it from `prisma.config.ts`):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

Run `npx prisma migrate dev --name init` to create the first (empty) migration. This
migration name is what you put in the CI pipeline's `migrate resolve --applied` step.

---

## Infisical — secrets management

All runtime secrets are stored in Infisical, not in `.env` files on the server.
The deploy job fetches them at deploy time using the Infisical CLI.

**Infisical project path for this service: `/trip-svc`**

The Infisical instance runs at `http://localhost:8080` on the server (internal only —
same host as the containers, accessed over the Docker bridge, not via `katisha-net`).

### Secrets to add in Infisical under `/trip-svc`

| Key | Description |
|---|---|
| `DB_PASSWORD` | Password for the `trip_svc` postgres user |
| `REDIS_PASSWORD` | Redis AUTH password |
| `RABBITMQ_USER` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | RabbitMQ password |
| `NODE_ENV` | `production` |
| `PORT` | `8092` |
| `DB_USER` | `trip_svc` |
| `DB_NAME` | `katisha_trips` |

The deploy job already injects all of them via:
```bash
infisical run \
  --token="$INFISICAL_TOKEN" \
  --projectId=${{ secrets.INFISICAL_PROJECT_ID }} \
  --env=dev \
  --path=/trip-svc \
  --domain=http://localhost:8080 \
  -- docker compose up -d --no-deps --pull always trip-svc
```

`docker compose up` with `infisical run` injects secrets as environment variables
into the container — no secrets ever touch the server's filesystem.

`DB_PASSWORD` is fetched separately (before `infisical run`) because it is needed
to build the `DIRECT_DATABASE_URL` for the migration runner step.

**The `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` are GitHub Actions secrets**
(not in Infisical) — they are the machine identity credentials used to log in to
Infisical from CI. Store them via `gh secret set`.

---

## Audit trail — how to record who did what

Every state-changing action in the trip service must publish an audit event.
The audit-svc consumes the `audit` queue bound to the `logs` exchange.

### `publishAudit` helper

```typescript
// src/utils/publishers.ts
export interface AuditEvent {
  actor_id:    string;   // UUID of the user who performed the action (req.user.id)
  action:      string;   // 'create' | 'update' | 'delete' | 'approve' | 'cancel' | ...
  resource:    string;   // PascalCase resource name: 'Trip', 'Route', 'Bus', 'Ticket'
  resource_id: string;   // UUID of the affected record
  delta?:      Record<string, { from: unknown; to: unknown }>; // changed fields (update only)
  ip?:         string;   // optional — req.ip if available
}

export const publishAudit = (event: AuditEvent): void =>
  publish('logs', 'audit.logs', event);
```

The `publish` function wraps every message in the platform event envelope:
```json
{
  "event_id": "<uuid-v4>",
  "version": 1,
  "source": "trip-service",
  "timestamp": "<ISO-8601>",
  ...auditEventFields
}
```

### When to publish audit events

Publish **after** the DB write succeeds, inside a `setImmediate` (fire-and-forget).
Never let audit failure block the response.

```typescript
// Example — creating a trip
const trip = await prisma.trip.create({ data: { ... } });

setImmediate(() => {
  publishAudit({
    actor_id:    requestingUser.id,
    action:      'create',
    resource:    'Trip',
    resource_id: trip.id,
  });
});
```

### Audit events to publish — minimum set

| User action | `action` | `resource` |
|---|---|---|
| Platform/org admin creates a route | `create` | `Route` |
| Platform/org admin updates a route | `update` | `Route` |
| Platform/org admin creates a bus | `create` | `Bus` |
| Platform/org admin creates a trip | `create` | `Trip` |
| Platform/org admin cancels a trip | `cancel` | `Trip` |
| Passenger books a ticket | `create` | `Ticket` |
| Staff validates/scans a ticket | `update` | `Ticket` |
| Staff cancels a ticket | `cancel` | `Ticket` |
| Admin issues a refund | `refund` | `Ticket` |

For **update** events, include a `delta` object showing before/after values for
every field that changed:

```typescript
publishAudit({
  actor_id:    requestingUser.id,
  action:      'update',
  resource:    'Trip',
  resource_id: tripId,
  delta: {
    departure_time: { from: existing.departure_time, to: updated.departure_time },
    status:         { from: existing.status,         to: updated.status },
  },
});
```

---

## What NOT to do

- Do not verify JWTs — the api-gw does this; trust `X-User-*` headers
- Do not connect to `db:5432` at runtime — always use `pgbouncer:6432`
- Do not put `url` in the `datasource` block in `schema.prisma`
- Do not add `prisma` to `devDependencies`
- Do not run `prisma db push` — use `migrate dev` locally, `migrate deploy` in CI
- Do not run `prisma migrate dev` in CI
- Do not publish to the `users`, `payment`, `billing`, or `notifications` exchanges as a producer — only publish to `trips` and the shared `notifications`/`logs` exchanges
- Do not write tests yet — tests will be added in a follow-up session
- Do not add `url` to pgbouncer connection string manually — it is built from env parts in `config/index.ts`
- Do not hardcode container IPs — always use container names on `katisha-net`
- Do not expose a public port in `docker-compose.yml`

---

## Implementation order

1. Read all skill files listed at the top of this spec
2. `package.json` — dependencies, scripts
3. `tsconfig.json`, `tsconfig.eslint.json`, `eslint.config.mjs`
4. `src/config/env.ts` + `src/config/index.ts`
5. `src/utils/AppError.ts`, `src/utils/ability.ts` (copy from user-service)
6. `src/models/index.ts` — Prisma client with PrismaPg adapter
7. `prisma/schema.prisma` + `prisma.config.ts`
8. Run `npx prisma migrate dev --name init`
9. `src/loaders/redis.ts`
10. `src/loaders/rabbitmq.ts` — with `trips` exchange + consumer queues + reconnect logic
11. `src/subscribers/users.subscriber.ts` — stub (ack messages, log, no-op for now)
12. `src/subscribers/payment.subscriber.ts` — stub
13. `src/utils/publishers.ts` — `publishAudit`, `publishSms`, `publishMail`, `publishPush`, `publishTripEvent`
14. `src/middleware/authenticate.ts`, `src/middleware/authorize.ts`, `src/middleware/errorHandler.ts`, `src/middleware/validate.ts`
15. `src/api/health.routes.ts` — `GET /health → 200 { status: 'ok' }`
16. `src/loaders/express.ts` + `src/loaders/prisma.ts`
17. `src/index.ts`
18. `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`
19. `.github/workflows/ci-cd.yml`
20. `../db/init/08-trip-service.sql`
21. Add `katisha_trips` to `../pgbouncer/config/pgbouncer.ini`
22. Add trip-svc routes to `../config-repo/api-gw/routes.yaml`
23. `docs/openapi.yaml` — skeleton only
24. `npx tsc --noEmit` + `npx eslint src/` — zero errors before first commit
