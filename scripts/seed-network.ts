/**
 * DEV-ONLY reset + demo data for trip-service.
 *
 * Wipes operational tables (tickets, trips, series) and the reference network,
 * re-runs the canonical reference bootstrap (operator, stops, buses, routes,
 * fares — the same code that runs on every startup), then seeds a week of
 * series-backed future trips via the shared, idempotent demo-trip seeder.
 *
 * The reference network itself lives in src/data/network.ts and is seeded by
 * src/loaders/bootstrap.ts in every environment — DO NOT duplicate it here.
 *
 * Run: `npx tsx scripts/seed-network.ts`
 */
import 'dotenv/config';
import { prisma } from '../src/models/index.js';
import { bootstrap } from '../src/loaders/bootstrap.js';
import { seedDemoTrips } from './seed-demo-trips.js';

async function main(): Promise<void> {
  console.log('Wiping operational tables (tickets, trips, series)…');
  await prisma.ticket.deleteMany({});
  await prisma.trip.deleteMany({});
  await prisma.tripSeries.deleteMany({});

  // Also wipe the reference network so removed/renamed seed entries don't linger
  // (bootstrap is upsert-only and never prunes). Children first to satisfy FKs.
  console.log('Wiping reference tables (prices, route_stops, routes, buses, stops)…');
  await prisma.price.deleteMany({});
  await prisma.routeStop.deleteMany({});
  await prisma.route.deleteMany({});
  await prisma.bus.deleteMany({});
  await prisma.stop.deleteMany({});

  console.log('Syncing reference network via bootstrap…');
  await bootstrap();

  console.log('Seeding a week of series-backed trips…');
  await seedDemoTrips();

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
