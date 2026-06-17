-- AlterTable
ALTER TABLE "buses" ADD COLUMN     "device_id" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "buses_device_id_key" ON "buses"("device_id");
