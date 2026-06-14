/**
 * Idempotent, NON-destructive demo-trip seeder for the flagship operator
 * (Volcano Express). Safe to run against any environment — it never wipes.
 *
 * For each active platform route it ensures a repeat-daily trip_series for the
 * next 7 days, materializes the instances (idempotent via the (series_id,
 * departure_at) unique), then assigns buses round-robin to the instances and
 * wires each bus to the routes it serves (the bus⇄route suggestion m2m).
 *
 * Trips use the current shape: series-backed, bus assigned, driver left null
 * (assigned per-trip in ops — and the remote has no driver staff yet).
 *
 * Run: `npx tsx scripts/seed-demo-trips.ts`
 */
import 'dotenv/config';
import { prisma } from '../src/models/index.js';
import { materializeSeries } from '../src/services/scheduling.js';
import { ORG } from '../src/data/network.js';

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2, no DST
const dayStr = (offsetDays: number): string =>
  new Date(Date.now() + KIGALI_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function seedDemoTrips(): Promise<void> {
  const routes = await prisma.route.findMany({ where: { org_id: null, is_active: true }, orderBy: { name: 'asc' } });
  const buses = await prisma.bus.findMany({ where: { org_id: ORG.id }, orderBy: { plate: 'asc' } });
  if (routes.length === 0 || buses.length === 0) {
    throw new Error(`Need routes and buses first (routes=${routes.length}, buses=${buses.length}). Run bootstrap.`);
  }

  const startsOn = new Date(dayStr(0)); // today (Kigali)
  const endsOn = new Date(dayStr(6));   // +6 days → a 7-day window inclusive
  const until = new Date(Date.now() + 8 * 86_400_000); // materialize the whole week now

  // 1. Ensure a repeat-daily series per route + materialize the week.
  let created = 0;
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    let series = await prisma.tripSeries.findFirst({ where: { org_id: ORG.id, route_id: route.id } });
    if (!series) {
      series = await prisma.tripSeries.create({
        data: {
          org_id: ORG.id,
          route_id: route.id,
          bus_id: null,
          driver_id: null,
          departure_time: '06:00',
          frequency_minutes: 240,            // 06:00 → 22:00 every 4h (5 departures/day)
          repeat_daily: true,
          starts_on: startsOn,
          ends_on: endsOn,
          total_seats: 30,                   // placeholder; per-trip bus capacity applied below
          is_express: i % 4 === 0,
          status: 'active',
        },
      });
    }
    created += await materializeSeries(series, until);
  }

  // 2. Assign buses round-robin to instances that have none, sizing seats to the bus.
  const unassigned = await prisma.trip.findMany({
    where: { org_id: ORG.id, bus_id: null, status: 'scheduled' },
    orderBy: { departure_at: 'asc' },
  });
  let busIdx = 0;
  for (const t of unassigned) {
    const bus = buses[busIdx++ % buses.length];
    const booked = t.total_seats - t.available_seats; // preserve any bookings
    await prisma.trip.update({
      where: { id: t.id },
      data: { bus_id: bus.id, total_seats: bus.total_seats, available_seats: Math.max(0, bus.total_seats - booked) },
    });
  }

  // 3. Wire each route to a suggested bus (bus⇄route m2m) — idempotent connect.
  for (let i = 0; i < routes.length; i++) {
    const bus = buses[i % buses.length];
    await prisma.bus.update({ where: { id: bus.id }, data: { routes: { connect: { id: routes[i].id } } } });
  }

  const total = await prisma.trip.count({ where: { org_id: ORG.id } });
  console.log(`✅ Demo trips: ${created} newly materialized, ${unassigned.length} buses assigned, ${total} total trips for ${routes.length} routes.`);
}

// Run standalone unless imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoTrips()
    .then(() => prisma.$disconnect())
    .catch((e) => { console.error(e); process.exit(1); });
}
