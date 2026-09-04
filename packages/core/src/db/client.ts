import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Open a connection pool and the Drizzle handle over it.
 *
 * The caller owns the pool and must `close()` it. Nothing here opens a
 * connection on import, so a test file can hold several databases at once.
 */
export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
