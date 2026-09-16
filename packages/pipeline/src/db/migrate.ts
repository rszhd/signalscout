import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

/**
 * One set of migrations, and the table that records which of them ran.
 *
 * Two streams share one database since US-153: the pipeline's, here, and the
 * application's, in `apps/api/drizzle`. Each keeps its own table, so neither
 * can mistake the other's files for its own or apply one twice. The pipeline
 * keeps Drizzle's default name, because that is the table every database
 * older than the split already has.
 */
export interface MigrationStream {
  /** The directory holding the generated SQL and `meta/_journal.json`. */
  readonly folder: string;
  /** Where applied migrations are recorded. Default: `drizzle.__drizzle_migrations`. */
  readonly table?: string;
}

/**
 * The pipeline's own stream. Resolved from this module so it is the same
 * folder whether the caller runs `src` through tsx or `dist` inside the image.
 */
export const pipelineMigrations: MigrationStream = {
  folder: new URL("../../drizzle", import.meta.url).pathname,
};

/** Apply every pending migration of one stream, then close the connection. */
export async function applyMigrations(databaseUrl: string, stream: MigrationStream): Promise<void> {
  const { db, close } = createDatabase(databaseUrl);

  try {
    await migrate(db, {
      migrationsFolder: stream.folder,
      ...(stream.table ? { migrationsTable: stream.table } : {}),
    });
  } finally {
    await close();
  }
}

/** Apply the pipeline's pending migrations, then close the connection. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  await applyMigrations(databaseUrl, pipelineMigrations);
}
