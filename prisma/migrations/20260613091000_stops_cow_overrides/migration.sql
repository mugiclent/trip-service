-- Copy-on-write overrides for stops. A fork keeps the default's id as the canonical
-- reference target (routes/prices/tickets never re-point); only name/coords overlay.
-- See src/utils/overrides.ts and src/services/stops.service.ts.

ALTER TABLE "stops" ADD COLUMN "org_id" TEXT;
ALTER TABLE "stops" ADD COLUMN "override_of" TEXT;
ALTER TABLE "stops" ADD COLUMN "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- Replace the global name unique with a per-org-scoped one.
DROP INDEX "stops_name_key";
CREATE UNIQUE INDEX "stops_name_org_id_key" ON "stops"("name", "org_id");

-- Postgres treats NULLs as distinct, so enforce one default per name explicitly.
CREATE UNIQUE INDEX "stops_default_name_key" ON "stops"("name") WHERE "org_id" IS NULL;

CREATE INDEX "stops_org_id_idx" ON "stops"("org_id");

ALTER TABLE "stops" ADD CONSTRAINT "stops_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stops" ADD CONSTRAINT "stops_override_of_fkey"
  FOREIGN KEY ("override_of") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
