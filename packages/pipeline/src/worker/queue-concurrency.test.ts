/**
 * Running a few jobs of one queue at once, never two of one monitor. US-439.
 *
 * The worker takes one job at a time in each queue by default, for every
 * monitor together, so a fifth visitor's scan waits for four others. An
 * application may let each queue run a few jobs at once. Two jobs of the same
 * monitor still never overlap: the spend meter and the copy rule read one
 * monitor's batch as a whole.
 */
import { createLogger } from "@signalscout/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { classifyQueue, forMonitor } from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fastRetries, until } from "./testing.js";

interface Span {
  monitorId: string;
  start: number;
  end: number;
}

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase("worker_queue_concurrency");
}, 60_000);

afterAll(async () => {
  await database?.drop();
});

async function runJobs(
  queueConcurrency: number | undefined,
  monitorIds: string[],
): Promise<Span[]> {
  const spans: Span[] = [];
  let worker: WorkerHandle | undefined;
  try {
    worker = await startWorker({
      databaseUrl: database.url,
      logger: createLogger({ level: "silent", name: "test" }),
      retry: fastRetries,
      scheduleTicks: false,
      ...(queueConcurrency === undefined ? {} : { queueConcurrency }),
      steps: {
        classify: async ({ monitorId }) => {
          const start = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 400));
          spans.push({ monitorId, start, end: Date.now() });
        },
      },
    });
    for (const monitorId of monitorIds) {
      await worker.boss.send(classifyQueue, { monitorId, postIds: [] }, forMonitor(monitorId));
    }
    await until(
      "every job to finish",
      () => (spans.length === monitorIds.length ? true : undefined),
      30_000,
    );
    return spans;
  } finally {
    await worker?.stop();
  }
}

function mostAtOnce(spans: readonly Span[]): number {
  return Math.max(
    ...spans.map((a) => spans.filter((b) => b.start < a.end && a.start < b.end).length),
  );
}

describe("jobs of one queue at once (US-439)", () => {
  it("runs one job at a time by default", async () => {
    const spans = await runJobs(undefined, ["a1", "b1", "c1"]);
    expect(mostAtOnce(spans)).toBe(1);
  }, 60_000);

  it("runs up to the asked number, and never two of one monitor together", async () => {
    const spans = await runJobs(3, ["same", "same", "b2", "c2"]);
    expect(mostAtOnce(spans)).toBeGreaterThan(1);
    expect(mostAtOnce(spans)).toBeLessThanOrEqual(3);
    const [first, second] = spans.filter((span) => span.monitorId === "same");
    expect(first && second && (first.end <= second.start || second.end <= first.start)).toBe(true);
  }, 60_000);

  it("refuses a count below 1", async () => {
    await expect(
      startWorker({
        databaseUrl: database.url,
        logger: createLogger({ level: "silent", name: "test" }),
        scheduleTicks: false,
        queueConcurrency: 0,
      }),
    ).rejects.toThrow(RangeError);
  });
});
