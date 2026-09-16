import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

/**
 * Real Postgres, from the first test file. `createTestDatabase` applies every
 * migration, so reaching `beforeAll` at all proves the migration runner works.
 */
describe("migrations", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase("migrate");
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
  });

  it("makes the pgvector extension available", async () => {
    const { pool, close } = createDatabase(database.url);

    try {
      const result = await pool.query<{ extversion: string }>(
        "select extversion from pg_extension where extname = 'vector'",
      );

      expect(result.rows).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("is safe to run twice", async () => {
    await expect(runMigrations(database.url)).resolves.toBeUndefined();
  });
});
