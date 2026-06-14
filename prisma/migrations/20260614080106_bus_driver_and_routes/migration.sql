-- DropForeignKey
ALTER TABLE "routes" DROP CONSTRAINT "routes_org_id_fkey";

-- AlterTable
ALTER TABLE "buses" ADD COLUMN     "driver_id" TEXT;

-- CreateTable
CREATE TABLE "_BusRoutes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BusRoutes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BusRoutes_B_index" ON "_BusRoutes"("B");

-- CreateIndex
CREATE INDEX "buses_driver_id_idx" ON "buses"("driver_id");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BusRoutes" ADD CONSTRAINT "_BusRoutes_A_fkey" FOREIGN KEY ("A") REFERENCES "buses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BusRoutes" ADD CONSTRAINT "_BusRoutes_B_fkey" FOREIGN KEY ("B") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
