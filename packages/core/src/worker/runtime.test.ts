import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db/client.js";
import { sourceCredentials } from "../db/schema.js";
import type { Logger } from "../logger.js";
import { type EncryptionKey, generateEncryptionKey, readEncryptionKey } from "../secrets/cipher.js";
import { putSourceCredential } from "../secrets/store.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  classifyQueue,
  deadLetterQueue,
  estimateQueue,
  filterQueue,
  heartbeatQueue,
  notifyQueue,
  pollQueue,
  pollQueuePolicy,
  queueDefinitions,
  retryPolicy,
  scheduleTickQueue,
} from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import type { PipelineSteps } from "./steps.js";
import { fakeRegistry, fastRetries, insertMonitor, silentLogger, until } from "./testing.js";

/**
 * pg-boss claiming a job is one of the two things docs/testing.md names as
 * unfaked, so everything here runs against real Postgres and sends real jobs.
 */
interface WorkerOptions {
  steps?: Partial<PipelineSteps>;
  logger?: Logger;
}

async function startTestWorker(
  database: TestDatabase,
  { steps, logger = silentLogger }: WorkerOptions = {},
): Promise<WorkerHandle> {
  return startWorker({
    databaseUrl: database.url,
    logger,
    registry: fakeRegistry(),
    credentialsFor: () => ({ token: "test-token" }),
    steps,
    retry: fastRetries,
    // The cron clock stays off. Every test that needs a tick calls the
    // scheduler itself, so nothing here waits on a minute boundary.
    scheduleTicks: false,
  });
}

describe("the worker's queues", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;

  beforeAll(async () => {
    database = await createTestDatabase("worker_queues");
    worker = await startTestWorker(database);
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("lets pg-boss install its own schema in the same database", async () => {
    const { pool, close } = createDatabase(database.url);

    try {
      const result = await pool.query<{ count: string }>(
        "select count(*)::text as count from information_schema.tables where table_schema = 'pgboss'",
      );

      // The exact table list is pg-boss's business. That it built them here,
      // rather than needing a second service, is ours.
      expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
      expect(await worker.boss.isInstalled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("creates the four pipeline queues, the cost test, the heartbeat and the dead letter queue", async () => {
    const created = (await worker.boss.getQueues())
      .map((queue) => queue.name)
      // pg-boss keeps queues of its own. They are its business, not ours.
      .filter((name) => !name.startsWith("__pgboss__"))
      .sort();

    expect(created).toEqual(
      [
        classifyQueue,
        deadLetterQueue,
        // US-014's cost test. Not a pipeline step: it runs when a person
        // presses a button, and it holds a run rather than a monitor.
        estimateQueue,
        filterQueue,
        heartbeatQueue,
        notifyQueue,
        pollQueue,
        scheduleTickQueue,
      ].sort(),
    );
  });

  it("gives every pipeline queue the dead letter queue and a bounded retry limit", async () => {
    for (const name of [pollQueue, filterQueue, classifyQueue, notifyQueue]) {
      const queue = await worker.boss.getQueue(name);

      expect(queue?.deadLetter).toBe(deadLetterQueue);
      expect(queue?.retryLimit).toBe(fastRetries.retryLimit);
    }
  });

  it("keys the poll queue by monitor, so one monitor cannot be polled twice at once", async () => {
    const queue = await worker.boss.getQueue(pollQueue);

    expect(queue?.policy).toBe(pollQueuePolicy);
  });
});

/**
 * The production retry policy, asserted as a value.
 *
 * The behaviour tests below run with `fastRetries`, because production's
 * backoff spans about an hour. Without this case a deployment could ship
 * `retryLimit: 0` and every behaviour test would still pass.
 */
describe("the production retry policy", () => {
  it("bounds attempts, backs off, and sends every pipeline queue to the dead letter queue", () => {
    expect(retryPolicy.retryLimit).toBeGreaterThan(0);
    expect(retryPolicy.retryLimit).toBeLessThanOrEqual(10);
    expect(retryPolicy.retryBackoff).toBe(true);
    expect(retryPolicy.retryDelay).toBeGreaterThan(0);
    expect(retryPolicy.retryDelayMax ?? 0).toBeGreaterThanOrEqual(retryPolicy.retryDelay);

    const definitions = queueDefinitions();

    for (const name of [pollQueue, filterQueue, classifyQueue, notifyQueue]) {
      const queue = definitions.find((definition) => definition.name === name);

      expect(queue?.deadLetter).toBe(deadLetterQueue);
      expect(queue?.retryLimit).toBe(retryPolicy.retryLimit);
    }

    // Nothing works the dead letter queue, so a job that reaches it must not
    // be given retries of its own.
    expect(definitions.find((definition) => definition.name === deadLetterQueue)?.retryLimit).toBe(
      0,
    );
  });
});

describe("a job that always fails", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  const attempts = vi.fn();

  beforeAll(async () => {
    database = await createTestDatabase("worker_dead_letter");
    worker = await startTestWorker(database, {
      steps: {
        classify: async () => {
          attempts();
          throw new Error("the model provider is down");
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("retries a bounded number of times and then stops in the dead letter queue", async () => {
    const monitorId = await insertMonitor(database);

    await worker.boss.send(classifyQueue, { monitorId, postIds: [] });

    const deadLettered = await until("the job to reach the dead letter queue", async () => {
      const jobs = await worker.boss.findJobs(deadLetterQueue, { queued: true });
      return jobs.length > 0 ? jobs : undefined;
    });

    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0]?.sourceName).toBe(classifyQueue);

    // One first attempt plus `retryLimit` retries. The number is the point:
    // a job that throws for ever must stop, not drain the account.
    expect(attempts).toHaveBeenCalledTimes(fastRetries.retryLimit + 1);

    // And it stopped. Nothing works the dead letter queue, so the count does
    // not move once the job is there.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(attempts).toHaveBeenCalledTimes(fastRetries.retryLimit + 1);
  }, 30_000);
});

/**
 * The second caller of US-004's boot check. `apps/api/src/credentials.test.ts`
 * covers the first.
 *
 * docs/testing.md: a rule is only as tested as its least-tested caller, and
 * two calls written apart are two features. Deleting the call from either site
 * has to turn something red.
 */
describe("a stored credential the worker cannot read", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase("worker_credential_boot");
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
  });

  afterEach(async () => {
    const { db, close } = createDatabase(database.url);
    await db.delete(sourceCredentials);
    await close();
  });

  async function store(value: string, key: EncryptionKey): Promise<void> {
    const { db, close } = createDatabase(database.url);
    await putSourceCredential(db, key, { source: "reddit", field: "apiKey", value });
    await close();
  }

  it("refuses to start rather than polling with a key it cannot decrypt", async () => {
    const key = readEncryptionKey(generateEncryptionKey());
    await store("brd_stored_value", key);

    await expect(
      startWorker({
        databaseUrl: database.url,
        logger: silentLogger,
        registry: fakeRegistry(),
        credentialsFor: () => ({ token: "test-token" }),
        retry: fastRetries,
        scheduleTicks: false,
        // A different key from the one the row was written with.
        // `requireEncryptionKey` reads process.env, which the suite leaves
        // without one, so this is the missing-key half of the same check.
      }),
    ).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("starts when nothing is stored, which is every deployment today", async () => {
    // The pass and the fail of the check must differ, or it guards nothing.
    const worker = await startTestWorker(database);
    await worker.stop();
  });
});
