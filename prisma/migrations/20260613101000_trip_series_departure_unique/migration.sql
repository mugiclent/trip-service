-- Idempotent (re)materialization: one trip per series per departure. Standalone
-- trips (series_id NULL) are unaffected — Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX "trips_series_id_departure_at_key" ON "trips"("series_id", "departure_at");
