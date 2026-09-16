import { applyMigrations, type MigrationStream, runMigrations } from "@signalscout/pipeline";

/**
 * This application's migration stream: the account tables in `schema.ts`,
 * under a migrations table of their own. US-153.
 *
 * The pipeline's stream runs first, always. A fresh database gets every
 * table from it, the account tables included, because they were the
 * pipeline's until the split and history is not rewritten; this stream's
 * first migration then finds them present and creates nothing. On a
 * database older than the split the same two steps do the same thing.
 */
export const appMigrations: MigrationStream = {
  folder: new URL("../../drizzle", import.meta.url).pathname,
  table: "__app_migrations",
};

/** Apply both streams, pipeline first. What `pnpm db:migrate` and the image's migrate step run. */
export async function runAppMigrations(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl);
  await applyMigrations(databaseUrl, appMigrations);
}
