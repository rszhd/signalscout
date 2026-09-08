import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createDatabase } from "./client.js";

/**
 * Correctness-critical: a connection Postgres closes while nothing is using it
 * must not end the process.
 *
 * `pg` emits that failure on the pool rather than on a query, so with no
 * listener attached Node treats it as an unhandled error and the API or the
 * worker exits — after serving every request correctly, and with a stack trace
 * that names a parser inside a driver rather than anything in this repository.
 * The cause is ordinary: a database restart, a failover, an administrator
 * ending a session, a pooler timing an idle one out.
 *
 * It is asserted with a real termination rather than a synthetic emit, because
 * the thing being proved is which object `pg` reports it on.
 */
describe("the database pool", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase("db_client");
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
  });

  it("survives an idle connection being terminated, and says so", async () => {
    const failures: Error[] = [];
    const { pool, close } = createDatabase(database.url, {
      onError: (error) => failures.push(error),
    });

    try {
      // Opens a connection and hands it back to the pool, so the next
      // statement kills one that is idle rather than one in use.
      await pool.query("select 1");

      const executioner = createDatabase(database.url);

      try {
        await executioner.pool.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
          [database.name],
        );
      } finally {
        await executioner.close();
      }

      await until(() => failures.length > 0);

      expect(failures).toHaveLength(1);
      expect(failures[0]?.message).toContain("terminating connection");

      // The pool opens a replacement on its own. Nothing here repairs it.
      const result = await pool.query<{ answer: number }>("select 1 as answer");
      expect(result.rows[0]?.answer).toBe(1);
    } finally {
      await close();
    }
  });
});

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("the pool never reported the terminated connection");
}
