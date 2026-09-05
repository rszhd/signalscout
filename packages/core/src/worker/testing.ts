/**
 * Helpers the worker's test files share.
 *
 * The registry here is the fake connector under the pair "reddit" and
 * "brightdata". The fake because no test reaches Reddit; under that pair
 * because the schema only accepts a platform and a provider it knows, on
 * `posts.source`, `api_usage.provider` and `source_continuations.provider`
 * alike. A registry holding "fake via fake-provider" is one no deployment can
 * have, and a test that stored its rows would prove nothing about the poll a
 * deployment actually runs.
 */
import { createDatabase } from "../db/client.js";
import { monitors } from "../db/schema.js";
import { createLogger, type Logger } from "../logger.js";
import { type FakeSourceOptions, fakeSourceDefinition } from "../sources/fake/index.js";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import type { TestDatabase } from "../testing/database.js";
import { unreachableFetch } from "../testing/network.js";

export const silentLogger: Logger = createLogger({ level: "silent", name: "test" });

/** Retries a test can wait out. Production's backoff spans about an hour. */
export const fastRetries = { retryLimit: 2, retryDelay: 0, retryBackoff: false } as const;

export function fakeRegistry(
  options: FakeSourceOptions = {},
  logger: Logger = silentLogger,
): SourceRegistry {
  return createSourceRegistry({
    definitions: [
      fakeSourceDefinition({
        id: "reddit",
        displayName: "Reddit",
        providerId: "brightdata",
        providerName: "Bright Data",
        ...options,
      }),
    ],
    // The real network is unreachable, not merely unused.
    runtime: createSourceRuntime({ fetch: unreachableFetch, logger }),
  });
}

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

/**
 * Wait on something that has definitely happened, never on a number of
 * milliseconds. docs/testing.md: a wait in milliseconds is a race, and
 * widening the timeout hides a real defect inside the number a busy machine
 * produces.
 */
export async function until<T>(
  description: string,
  check: () => Promise<T | undefined> | (T | undefined),
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}.`);
}
