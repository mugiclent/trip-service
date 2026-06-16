-- CreateIndex
CREATE INDEX "tickets_org_id_status_confirmed_at_idx" ON "tickets"("org_id", "status", "confirmed_at");

-- CreateIndex
CREATE INDEX "tickets_org_id_status_created_at_idx" ON "tickets"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "trips_org_id_departure_at_idx" ON "trips"("org_id", "departure_at");
