-- Rolling materialization: the scheduler tracks how far ahead each series has been
-- generated, so it only ever creates the next (materialized_until, horizon] window.
ALTER TABLE "trip_series" ADD COLUMN "materialized_until" TIMESTAMP(3);
