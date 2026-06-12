/**
 * DEV-ONLY reset + demo data for trip-service.
 *
 * Wipes operational tables (tickets, trips), re-runs the canonical reference
 * bootstrap (operator, stops, buses, routes, fares — the same code that runs on
 * every startup), then layers a week of random scheduled future trips on top so
 * the local network has something to book.
 *
 * The reference network itself lives in src/data/network.ts and is seeded by
 * src/loaders/bootstrap.ts in every environment — DO NOT duplicate it here.
 *
 * Run: `npx tsx scripts/seed-network.ts`
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/models/index.js';
import { bootstrap } from '../src/loaders/bootstrap.js';
import { ORG, BUSES } from '../src/data/network.js';

async function main(): Promise<void> {
  console.log('Wiping operational tables (tickets, trips)…');
  await prisma.ticket.deleteMany({});
  await prisma.trip.deleteMany({});

  console.log('Syncing reference network via bootstrap…');
  const { routes, buses } = await bootstrap();

  console.log('Seeding future trips…');
  const busList = BUSES.map((b) => buses[b.plate]); // preserves seat sizing order
  const hours = [6, 9, 13, 17];
  let tripCount = 0;
  let busIdx = 0;
  for (const r of routes) {
    for (let day = 1; day <= 7; day++) {
      for (const h of hours) {
        const dep = new Date();
        dep.setDate(dep.getDate() + day);
        dep.setHours(h, 0, 0, 0);
        const bus = busList[busIdx++ % busList.length];
        const arr = new Date(dep.getTime() + r.durationMin * 60_000);
        await prisma.trip.create({
          data: {
            id: randomUUID(), org_id: ORG.id, route_id: r.id, bus_id: bus.id,
            departure_at: dep, arrival_at: arr, duration_minutes: r.durationMin,
            total_seats: bus.total_seats, available_seats: bus.total_seats, status: 'scheduled',
            cancellation_allowed: true, is_express: Math.random() < 0.25,
          },
        });
        tripCount++;
      }
    }
  }

  console.log(`✅ Done: ${routes.length} routes, ${tripCount} trips.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
