import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

/**
 * The directory holding the generated SQL migrations. Resolved from this
 * module so it is the same folder whether the caller runs `src` through tsx
 * or `dist` inside the image.
 */
export const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

/** Apply every pending migration, then close the connection. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDatabase(databaseUrl);

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
