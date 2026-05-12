import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedUser } from '../utils/ability.js';

const maskPhone = (phone: string | null): string | null => {
  if (!phone) return null;
  return phone.replace(/(\+250\d{3})\d{3}(\d{3})/, '$1***$2');
};

export const getTripManifest = async (tripId: string, user: AuthenticatedUser) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      route: true,
      bus: true,
      driver: true,
      tickets: {
        where: { status: 'confirmed' },
        include: { boarding_stop: true, alighting_stop: true },
      },
    },
  });
  if (!trip) throw new AppError('TRIP_NOT_FOUND', 404);

  if (user.org_id && trip.org_id !== user.org_id) {
    throw new AppError('FORBIDDEN', 403);
  }

  if (user.role_slugs.includes('driver') && trip.driver_id !== user.id) {
    throw new AppError('FORBIDDEN', 403);
  }

  const isPlatformAdmin = user.role_slugs.includes('platform_admin') || !user.org_id;
  const bookedSeats = trip.tickets.reduce((sum, t) => sum + t.seats_count, 0);

  return {
    trip: {
      id: trip.id,
      departure_at: trip.departure_at,
      route: { name: trip.route.name },
      bus: trip.bus ? { plate: trip.bus.plate, type: trip.bus.type } : null,
      driver: trip.driver ? { first_name: trip.driver.first_name, last_name: trip.driver.last_name } : null,
      total_seats: trip.total_seats,
      booked_seats: bookedSeats,
      available_seats: trip.available_seats,
    },
    passengers: trip.tickets.map((t) => ({
      ticket_id: t.id,
      passenger_name: t.passenger_name,
      phone: isPlatformAdmin ? t.passenger_phone : maskPhone(t.passenger_phone),
      boarding_stop: { id: t.boarding_stop.id, name: t.boarding_stop.name },
      alighting_stop: { id: t.alighting_stop.id, name: t.alighting_stop.name },
      seats_count: t.seats_count,
      payment_method: t.payment_method,
      status: t.status,
    })),
  };
};
