-- Stop names are reference geography and must be unique so the reference network
-- can be seeded idempotently (upsert on name). See src/loaders/bootstrap.ts.
CREATE UNIQUE INDEX "stops_name_key" ON "stops"("name");
