-- Copy-on-write overrides for prices: platform defaults (org_id NULL) that an org
-- can fork (override_of -> default) or tombstone (is_hidden) without mutating the
-- shared row. See src/utils/overrides.ts and src/services/prices.service.ts.

ALTER TABLE "prices" ADD COLUMN "org_id" TEXT;
ALTER TABLE "prices" ADD COLUMN "override_of" TEXT;
ALTER TABLE "prices" ADD COLUMN "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- Replace the global stop-pair unique with a per-org-scoped one.
DROP INDEX "prices_boarding_stop_id_alighting_stop_id_key";
CREATE UNIQUE INDEX "prices_boarding_stop_id_alighting_stop_id_org_id_key"
  ON "prices"("boarding_stop_id", "alighting_stop_id", "org_id");

-- Postgres treats NULLs as distinct, so the scoped index above does NOT stop two
-- defaults for the same pair. This partial index enforces exactly one default.
CREATE UNIQUE INDEX "prices_default_pair_key"
  ON "prices"("boarding_stop_id", "alighting_stop_id") WHERE "org_id" IS NULL;

CREATE INDEX "prices_org_id_idx" ON "prices"("org_id");

ALTER TABLE "prices" ADD CONSTRAINT "prices_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prices" ADD CONSTRAINT "prices_override_of_fkey"
  FOREIGN KEY ("override_of") REFERENCES "prices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
