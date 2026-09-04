import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { heartbeatQueue, startWorker, type WorkerHandle } from "./runtime.js";

/**
 * pg-boss claiming a job is one of the two things docs/testing.md names as
 * unfaked. So this runs against real Postgres and sends a real job.
 */
describe("startWorker", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;

  beforeAll(async () => {
    database = await createTestDatabase("worker");
    worker = await startWorker({
      databaseUrl: database.url,
      logger: createLogger({ level: "silent", name: "test" }),
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  it("creates the heartbeat queue and picks up a job sent to it", async () => {
    const jobId = await worker.boss.send(heartbeatQueue, {});

    expect(jobId).toBeTypeOf("string");

    const completed = await waitForJobToLeaveTheQueue(worker, jobId as string);

    expect(completed).toBe(true);
  }, 30_000);
});

/**
 * Wait on the job's own state, not on a number of milliseconds. A wait in
 * milliseconds is a race; this is an ordering.
 */
async function waitForJobToLeaveTheQueue(worker: WorkerHandle, jobId: string): Promise<boolean> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const job = await worker.boss.getJobById(heartbeatQueue, jobId);

    if (job?.state === "completed") return true;
    if (job?.state === "failed") throw new Error(`heartbeat job failed: ${job.output}`);

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
