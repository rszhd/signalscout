/**
 * An instance's own price reaches what a poll records. US-389.
 *
 * `prices.test.ts` in the engine proves the connector reports the paid price.
 * This proves the poll bills with it: the `api_usage` row the budget guard
 * sums and the `poll_runs` row a person reads both carry the price paid, not
 * the provider's list price.
 */
import {
  createSourceRegistry,
  createSourceRuntime,
  fakeSourceDefinition,
  withInstancePrices,
} from "@signalscout/engine";
import { unreachableFetch } from "@signalscout/engine/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, pollRuns } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createCollectStep } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import type { StepContext } from "./steps.js";
import { insertMonitor, silentLogger } from "./testing.js";

const credentials: CredentialLookup = () => ({ token: "test-token" });

/** The list price of one unit, and what this instance pays for it. */
const listPrice = 8_118;
const paidPrice = 3_315;

function pricedRegistry() {
  const fake = fakeSourceDefinition({
    id: "reddit",
    displayName: "Reddit",
    providerId: "brightdata",
    providerName: "Bright Data",
    posts: [],
    unitsPerCall: 3,
    pricePerUnitMicros: listPrice,
  });
  const listed = { ...fake, provider: { ...fake.provider, unitPriceMicros: listPrice } };

  return createSourceRegistry({
    definitions: withInstancePrices([listed], { brightdata: paidPrice }),
    runtime: createSourceRuntime({ logger: silentLogger, fetch: unreachableFetch }),
  });
}

describe("a poll on a priced connector", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_instance_prices");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  it("records three units at the price paid, where the list price would be 24,354", async () => {
    const monitorId = await insertMonitor(database);
    const boss = { send: vi.fn(async () => "job-1") };

    await createCollectStep({ registry: pricedRegistry(), credentialsFor: credentials })(
      { monitorId },
      { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger },
    );

    const [usage] = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));
    const [run] = await db.select().from(pollRuns).where(eq(pollRuns.monitorId, monitorId));

    expect(usage?.units).toBe(3);
    expect(usage?.estimatedCostMicros).toBe(3 * paidPrice);
    expect(run?.estimatedCostMicros).toBe(3 * paidPrice);
  });
});
