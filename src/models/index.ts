import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';

const adapter = new PrismaPg({ connectionString: config.db.url });
export const prisma = new PrismaClient({ adapter });

export type {
  Organisation,
  StaffUser,
  Stop,
  Route,
  RouteStop,
  Price,
  Bus,
  TripSeries,
  Trip,
  Ticket,
} from '@prisma/client';
export { Prisma } from '@prisma/client';
