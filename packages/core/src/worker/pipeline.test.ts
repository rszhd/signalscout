import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { classifyQueue, filterQueue, notifyQueue, pollQueue } from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import type { PipelineSteps } from "./steps.js";
import { fakeRegistry, fastRetries, insertMonitor, silentLogger, until } from "./testing.js";

function start(database: TestDatabase, steps: Partial<PipelineSteps>, logger = silentLogger) {
  return startWorker({
    databaseUrl: database.url,
    logger,
    registry: fakeRegistry(),
    credentialsFor: () => ({ token: "test-token" }),
    steps,
    retry: fastRetries,
    scheduleTicks: false,
  });
}

/**
 * The four steps are four queues because they fail differently and cost
 * differently. This is the case that says so: the classify step fails once,
 * and the poll that paid for the posts must not run a second time.
 */
describe("a retry of one step", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  const ran = { poll: 0, filter: 0, classify: 0, notify: 0 };

  beforeAll(async () => {
    database = await createTestDatabase("worker_retry_isolation");
    worker = await start(database, {
      poll: async ({ monitorId }, { boss }) => {
        ran.poll += 1;
        await boss.send(filterQueue, { monitorId, postIds: ["post-1"] });
      },
      filter: async ({ monitorId, postIds }, { boss }) => {
        ran.filter += 1;
        await boss.send(classifyQueue, { monitorId, postIds });
      },
      classify: async ({ monitorId }, { boss }) => {
        ran.classify += 1;
        // The model provider is down for the first attempt only.
        if (ran.classify === 1) throw new Error("the model provider is down");
        await boss.send(notifyQueue, { monitorId, matchIds: ["match-1"] });
      },
      notify: async () => {
        ran.notify += 1;
      },
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("does not re-run the step before it", async () => {
    const monitorId = await insertMonitor(database);

    await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });

    await until("the pipeline to reach the notify step", () => (ran.notify > 0 ? true : undefined));

    expect(ran.classify).toBe(2);
    // The two that ran before it ran once each. A retry that re-fetched would
    // pay a second time for posts already stored.
    expect(ran.poll).toBe(1);
    expect(ran.filter).toBe(1);
  }, 30_000);
});

/**
 * The poll queue carries a queue policy the other three do not, and a policy
 * decides which states a job may occupy. A policy that leaves no room for the
 * `retry` state would drop every retried poll, silently, and only on the queue
 * that costs money to re-run.
 */
describe("a poll that fails once", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  let attempts = 0;
  let finished = false;

  beforeAll(async () => {
    database = await createTestDatabase("worker_poll_retry");
    worker = await start(database, {
      poll: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Bright Data returned 502");
        finished = true;
      },
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("retries under the poll queue's own policy", async () => {
    const monitorId = await insertMonitor(database);

    await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });

    await until("the retried poll to succeed", () => (finished ? true : undefined));

    expect(attempts).toBe(2);
  }, 30_000);
});

describe("every job", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  const lines: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    database = await createTestDatabase("worker_logging");

    const logger = createLogger({
      level: "info",
      name: "test",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    });

    // Every step succeeds and chains nothing, so each queue is driven on its
    // own and one queue's line cannot stand in for another's.
    const noop = async () => {};

    worker = await start(
      database,
      { poll: noop, filter: noop, classify: noop, notify: noop },
      logger,
    );
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("logs its monitor id, its duration and its outcome, on all four queues", async () => {
    const monitorId = await insertMonitor(database);

    await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });
    await worker.boss.send(filterQueue, { monitorId, postIds: [] });
    await worker.boss.send(classifyQueue, { monitorId, postIds: [] });
    await worker.boss.send(notifyQueue, { monitorId, matchIds: [] });

    // Four queues, four call sites of the wrapper. A rule is only as tested as
    // its least-tested caller, so each one is asked for its own line.
    for (const queue of [pollQueue, filterQueue, classifyQueue, notifyQueue]) {
      const line = await until(`the ${queue} job to log`, () =>
        lines.find((entry) => entry.queue === queue && entry.msg === "job finished"),
      );

      expect(line.monitorId).toBe(monitorId);
      expect(line.outcome).toBe("ok");
      expect(typeof line.durationMs).toBe("number");
      expect(line.jobId).toBeTypeOf("string");
    }
  }, 30_000);
});

describe("a job that throws", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  const lines: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    database = await createTestDatabase("worker_logging_failure");

    const logger = createLogger({
      level: "info",
      name: "test",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    });

    worker = await start(
      database,
      {
        classify: async () => {
          throw new Error("the model provider is down");
        },
      },
      logger,
    );
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("logs the failure as an outcome, and the error with it", async () => {
    // The recording half of the wrapper is the half nothing drives by
    // accident: a job that only ever succeeds never reaches the catch.
    const monitorId = await insertMonitor(database);

    await worker.boss.send(classifyQueue, { monitorId, postIds: [] });

    const line = await until("the failure to be logged", () =>
      lines.find((entry) => entry.queue === classifyQueue && entry.msg === "job failed"),
    );

    expect(line.monitorId).toBe(monitorId);
    expect(line.outcome).toBe("failed");
    expect(typeof line.durationMs).toBe("number");
    expect(JSON.stringify(line.err)).toContain("the model provider is down");
  }, 30_000);
});

describe("a shutdown signal", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;
  let started = false;
  let finished = false;

  beforeAll(async () => {
    database = await createTestDatabase("worker_shutdown");
    worker = await start(database, {
      notify: async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        finished = true;
      },
    });
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
  });

  it("lets a running job finish before the process exits", async () => {
    const monitorId = await insertMonitor(database);

    await worker.boss.send(notifyQueue, { monitorId, matchIds: [] });

    // Wait for the job to be running, not for a number of milliseconds. Asking
    // for a graceful stop before anything is running proves nothing.
    await until("the job to start", () => (started ? true : undefined));
    expect(finished).toBe(false);

    await worker.stop();

    // stop() resolved, and the job that was running had finished by then.
    expect(finished).toBe(true);
  }, 30_000);
});
