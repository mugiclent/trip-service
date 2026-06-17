import type { Channel, ConsumeMessage } from 'amqplib';
import { prisma, Prisma } from '../models/index.js';

const INFRA_RETRY_BASE_MS = 5_000;
const INFRA_RETRY_MAX_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// 5s → 10s → 20s → 40s → 60s (cap)
const infraRetryDelay = (attempt: number): number =>
  Math.min(INFRA_RETRY_BASE_MS * 2 ** (attempt - 1), INFRA_RETRY_MAX_MS);

// This is a DB-write subscriber: an unreachable DB must hold the message unacked
// (prefetch=1 blocks further delivery) until the DB recovers, never drop it to a DLX.
// Bad-data errors (constraint/validation) can never succeed and go to the DLX.
function isInfrastructureError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code.startsWith('P1')) return true;
  const msg = err instanceof Error ? err.message : '';
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE/i.test(msg);
}

interface OrgActivatedEvent {
  type: 'org.activated';
  id: string;
  name: string;
  slug: string;
  org_type: 'company' | 'cooperative' | 'coop_member';
  tin: string;
  logo_path: string | null;
  story: string | null;
  cancellations_allowed?: boolean;
}

interface OrgUpdatedEvent {
  type: 'org.updated';
  id: string;
  name: string;
  logo_path: string | null;
  story: string | null;
}

interface OrgSuspendedEvent {
  type: 'org.suspended';
  id: string;
}

interface StaffCreatedEvent {
  type: 'staff.created';
  id: string;
  first_name: string;
  last_name: string;
  org_id: string | null;
  roles: string[];
  avatar_path: string | null;
  status: string;
}

interface StaffUpdatedEvent {
  type: 'staff.updated';
  id: string;
  first_name: string;
  last_name: string;
  avatar_path: string | null;
  org_id: string | null;
  roles: string[];
  status: string;
}

interface StaffSuspendedEvent {
  type: 'staff.suspended';
  id: string;
}

interface StaffDeletedEvent {
  type: 'staff.deleted';
  id: string;
}

type UsersEvent =
  | OrgActivatedEvent
  | OrgUpdatedEvent
  | OrgSuspendedEvent
  | StaffCreatedEvent
  | StaffUpdatedEvent
  | StaffSuspendedEvent
  | StaffDeletedEvent;

const handleOrgActivated = async (event: OrgActivatedEvent): Promise<void> => {
  await prisma.organisation.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      org_type: event.org_type,
      tin: event.tin,
      logo_path: event.logo_path,
      story: event.story,
      status: 'active',
      cancellation_allowed: event.cancellations_allowed ?? false,
    },
    update: {
      name: event.name,
      slug: event.slug,
      org_type: event.org_type,
      tin: event.tin,
      logo_path: event.logo_path,
      story: event.story,
      status: 'active',
    },
  });
};

const handleOrgUpdated = async (event: OrgUpdatedEvent): Promise<void> => {
  await prisma.organisation.updateMany({
    where: { id: event.id },
    data: {
      name: event.name,
      logo_path: event.logo_path,
      story: event.story,
    },
  });
};

const handleOrgSuspended = async (event: OrgSuspendedEvent): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.organisation.updateMany({
      where: { id: event.id },
      data: { status: 'suspended' },
    });

    await tx.trip.updateMany({
      where: {
        org_id: event.id,
        status: 'scheduled',
        departure_at: { gt: new Date() },
      },
      data: { status: 'cancelled' },
    });
  });
};

const handleStaffCreated = async (event: StaffCreatedEvent): Promise<void> => {
  const status = event.status === 'active' ? 'active' : event.status === 'suspended' ? 'suspended' : 'deleted';
  await prisma.staffUser.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      first_name: event.first_name,
      last_name: event.last_name,
      org_id: event.org_id,
      roles: event.roles,
      avatar_path: event.avatar_path,
      status,
    },
    update: {
      first_name: event.first_name,
      last_name: event.last_name,
      org_id: event.org_id,
      roles: event.roles,
      avatar_path: event.avatar_path,
      status,
    },
  });
};

const handleStaffUpdated = async (event: StaffUpdatedEvent): Promise<void> => {
  // Upsert, not updateMany: topic exchanges don't retain, so if the staff.created
  // that should have seeded this row was published before our queue existed, it's
  // gone. Seeding here lets the mirror self-heal on the next update instead of
  // staying permanently empty. See [[staff-sync]].
  const status = event.status === 'active' ? 'active' : event.status === 'suspended' ? 'suspended' : 'deleted';
  await prisma.staffUser.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      first_name: event.first_name,
      last_name: event.last_name,
      org_id: event.org_id,
      roles: event.roles,
      avatar_path: event.avatar_path,
      status,
    },
    update: {
      first_name: event.first_name,
      last_name: event.last_name,
      avatar_path: event.avatar_path,
      org_id: event.org_id,
      roles: event.roles,
      status,
    },
  });
};

const handleStaffSuspended = async (event: StaffSuspendedEvent): Promise<void> => {
  await prisma.staffUser.updateMany({
    where: { id: event.id },
    data: { status: 'suspended' },
  });
};

const handleStaffDeleted = async (event: StaffDeletedEvent): Promise<void> => {
  await prisma.$transaction([
    prisma.staffUser.updateMany({
      where: { id: event.id },
      data: { status: 'deleted' },
    }),
    prisma.trip.updateMany({
      where: {
        driver_id: event.id,
        status: 'scheduled',
        departure_at: { gt: new Date() },
      },
      data: { driver_id: null },
    }),
  ]);
};

const dispatch = async (event: UsersEvent): Promise<void> => {
  switch (event.type) {
    case 'org.activated':   await handleOrgActivated(event); break;
    case 'org.updated':     await handleOrgUpdated(event); break;
    case 'org.suspended':   await handleOrgSuspended(event); break;
    case 'staff.created':   await handleStaffCreated(event); break;
    case 'staff.updated':   await handleStaffUpdated(event); break;
    case 'staff.suspended': await handleStaffSuspended(event); break;
    case 'staff.deleted':   await handleStaffDeleted(event); break;
    default: break;
  }
};

export const initUsersSubscriber = async (ch: Channel): Promise<void> => {
  await ch.consume('users-trip-svc', async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    let event: UsersEvent;
    try {
      event = JSON.parse(msg.content.toString()) as UsersEvent;
    } catch (err) {
      // Unparseable payload will never succeed — straight to DLX.
      console.error('[users.subscriber] Malformed message — sending to DLX', err);
      try { ch.nack(msg, false, false); } catch { /* channel closed — broker requeues */ }
      return;
    }

    // DB-write retry loop: hold the message while infrastructure is down, DLX only bad data.
    for (let attempt = 1; ; attempt++) {
      try {
        await dispatch(event);
        try { ch.ack(msg); } catch { /* channel closed — broker requeues */ }
        return;
      } catch (err) {
        if (isInfrastructureError(err)) {
          const delay = infraRetryDelay(attempt);
          console.warn(
            `[users.subscriber] Infrastructure unavailable (attempt ${attempt}) — retrying in ${delay / 1_000}s`,
            { type: event.type, error: (err as Error).message },
          );
          await sleep(delay);
          continue;
        }
        console.error('[users.subscriber] Processing failed — sending to DLX', { type: event.type }, err);
        try { ch.nack(msg, false, false); } catch { /* channel closed — broker requeues */ }
        return;
      }
    }
  });

  console.warn('[users.subscriber] Listening on users-trip-svc');
};
