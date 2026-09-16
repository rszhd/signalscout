/**
 * A monitor row to hang a test on, and retries a test can wait out.
 *
 * Public through `@signalscout/pipeline/testing` since US-157: a consumer's
 * tests start at real Postgres like ours do, and the first consumer copied
 * this function because it could not import it. A copied test helper is the
 * one duplication nothing catches — a monitor inserted with yesterday's
 * columns still inserts — so the definition lives here, once.
 */
import { createDatabase } from "../db/client.js";
import { monitors } from "../db/schema.js";
import type { TestDatabase } from "./database.js";

/** Retries a test can wait out. Production's backoff spans about an hour. */
export const fastRetries = { retryLimit: 2, retryDelay: 0, retryBackoff: false } as const;

export async function insertMonitor(
  database: TestDatabase,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { db, close } = createDatabase(database.url);

  try {
    const [row] = await db
      .insert(monitors)
      .values({
        userId: "user-1",
        name: "Test monitor",
        product: "A test runner",
        idealCustomer: "Small SaaS teams",
        problem: "Flaky end-to-end tests",
        sources: ["reddit"],
        generatedQueries: ["flaky tests"],
        ...overrides,
      })
      .returning({ id: monitors.id });

    if (!row) throw new Error("The monitor was not inserted.");

    return row.id;
  } finally {
    await close();
  }
}
