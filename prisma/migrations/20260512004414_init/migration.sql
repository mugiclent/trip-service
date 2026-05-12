-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('company', 'cooperative', 'coop_member');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "StaffUserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "TripSeriesStatus" AS ENUM ('active', 'paused', 'cancelled');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('scheduled', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('initiated', 'payment_pending', 'confirmed', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'wallet', 'mtn', 'airtel');

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "org_type" "OrgType" NOT NULL,
    "logo_path" TEXT,
    "story" TEXT,
    "tin" VARCHAR(9) NOT NULL,
    "status" "OrgStatus" NOT NULL,
    "cancellation_allowed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255) NOT NULL,
    "avatar_path" TEXT,
    "org_id" TEXT,
    "roles" TEXT[],
    "status" "StaffUserStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "city" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "origin_stop_id" TEXT NOT NULL,
    "destination_stop_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" TEXT NOT NULL,
    "boarding_stop_id" TEXT NOT NULL,
    "alighting_stop_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RWF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "plate" VARCHAR(20) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_series" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "bus_id" TEXT,
    "driver_id" TEXT,
    "departure_time" VARCHAR(5) NOT NULL,
    "frequency_minutes" INTEGER,
    "repeat_daily" BOOLEAN NOT NULL DEFAULT false,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "total_seats" INTEGER NOT NULL,
    "is_express" BOOLEAN NOT NULL DEFAULT false,
    "status" "TripSeriesStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "bus_id" TEXT,
    "driver_id" TEXT,
    "series_id" TEXT,
    "departure_at" TIMESTAMP(3) NOT NULL,
    "arrival_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "total_seats" INTEGER NOT NULL,
    "available_seats" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'scheduled',
    "cancellation_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_express" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "user_id" TEXT,
    "passenger_name" VARCHAR(255) NOT NULL,
    "passenger_phone" VARCHAR(20),
    "boarding_stop_id" TEXT NOT NULL,
    "alighting_stop_id" TEXT NOT NULL,
    "seats_count" INTEGER NOT NULL DEFAULT 1,
    "ticket_price" INTEGER NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_ref" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'initiated',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organisations_tin_key" ON "organisations"("tin");

-- CreateIndex
CREATE INDEX "staff_users_org_id_idx" ON "staff_users"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_slug_key" ON "routes"("slug");

-- CreateIndex
CREATE INDEX "routes_org_id_idx" ON "routes"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_stop_id_key" ON "route_stops"("route_id", "stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_order_key" ON "route_stops"("route_id", "order");

-- CreateIndex
CREATE INDEX "prices_boarding_stop_id_alighting_stop_id_idx" ON "prices"("boarding_stop_id", "alighting_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "prices_boarding_stop_id_alighting_stop_id_key" ON "prices"("boarding_stop_id", "alighting_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "buses_plate_key" ON "buses"("plate");

-- CreateIndex
CREATE INDEX "buses_org_id_idx" ON "buses"("org_id");

-- CreateIndex
CREATE INDEX "trip_series_org_id_idx" ON "trip_series"("org_id");

-- CreateIndex
CREATE INDEX "trips_departure_at_status_idx" ON "trips"("departure_at", "status");

-- CreateIndex
CREATE INDEX "trips_route_id_departure_at_idx" ON "trips"("route_id", "departure_at");

-- CreateIndex
CREATE INDEX "trips_org_id_status_idx" ON "trips"("org_id", "status");

-- CreateIndex
CREATE INDEX "trips_series_id_idx" ON "trips"("series_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_payment_ref_key" ON "tickets"("payment_ref");

-- CreateIndex
CREATE INDEX "tickets_trip_id_status_idx" ON "tickets"("trip_id", "status");

-- CreateIndex
CREATE INDEX "tickets_user_id_idx" ON "tickets"("user_id");

-- CreateIndex
CREATE INDEX "tickets_payment_ref_idx" ON "tickets"("payment_ref");

-- CreateIndex
CREATE INDEX "tickets_org_id_status_idx" ON "tickets"("org_id", "status");

-- CreateIndex
CREATE INDEX "tickets_status_expires_at_idx" ON "tickets"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_origin_stop_id_fkey" FOREIGN KEY ("origin_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_destination_stop_id_fkey" FOREIGN KEY ("destination_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_boarding_stop_id_fkey" FOREIGN KEY ("boarding_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_alighting_stop_id_fkey" FOREIGN KEY ("alighting_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_boarding_stop_id_fkey" FOREIGN KEY ("boarding_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_alighting_stop_id_fkey" FOREIGN KEY ("alighting_stop_id") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
