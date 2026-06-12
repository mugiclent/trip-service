-- Copy-on-write overrides for routes. Routes become platform defaults (org_id NULL)
-- that operators run trips on; an org can fork a route (deep copy of the route + its
-- route_stops, keeping its own id) and tombstone a default. Existing seeded routes
-- are claimed as defaults by bootstrap. See src/services/routes.service.ts.

ALTER TABLE "routes" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "routes" ADD COLUMN "override_of" TEXT;
ALTER TABLE "routes" ADD COLUMN "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- Replace the global slug unique with a per-org-scoped one + a single-default guard.
DROP INDEX "routes_slug_key";
CREATE UNIQUE INDEX "routes_slug_org_id_key" ON "routes"("slug", "org_id");
CREATE UNIQUE INDEX "routes_default_slug_key" ON "routes"("slug") WHERE "org_id" IS NULL;

ALTER TABLE "routes" ADD CONSTRAINT "routes_override_of_fkey"
  FOREIGN KEY ("override_of") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
