import type {
  createDatabase,
  Database,
  Env,
  JobSender,
  Logger,
  StartWorkerOptions,
  WorkerHandle,
} from "@signalscout/pipeline";
import { admitEveryone, createLogger, loadEnv } from "@signalscout/pipeline";
import { describe, expect, it, vi } from "vitest";
import type { ApiServer } from "./server.js";
import { startApi } from "./start.js";

/**
 * WORKER_IN_PROCESS decides whether one process or two run the queue. Both
 * settings are wired here, because a setting nothing asserts is a setting that
 * quietly stops working.
 */
const logger = createLogger({ level: "silent", name: "test" });

function envWith(workerInProcess: boolean, extra: Record<string, string> = {}): Env {
  return loadEnv({
    DATABASE_URL: "postgres://user:pw@localhost:5432/unused",
    // US-017 refuses to boot without one, before anything here runs.
    AUTH_SECRET: "a-test-secret-that-is-long-enough-to-pass",
    WORKER_IN_PROCESS: String(workerInProcess),
    ...extra,
  });
}

function fakeServer() {
  const app = {
    listen: vi.fn(async () => "http://127.0.0.1:0"),
    close: vi.fn(async () => undefined),
  } as unknown as ApiServer;

  return {
    app,
    buildServer: vi.fn(
      async (_options: { env: Env; logger: Logger; db: Database }): Promise<ApiServer> => app,
    ),
  };
}

/**
 * A pool that is never opened.
 *
 * Injected so these tests touch no database, and so `stop` closing the pool is
 * an assertion rather than a hope. A pool left open holds the event loop and
 * the process never exits, which a test that only checks the server closed
 * would never see.
 */
function fakeDatabase() {
  const close = vi.fn(async () => undefined);

  /**
   * Enough of Drizzle for the two reads `startApi` makes before it listens:
   * the credential count, and the hints behind it. Both answer "nothing
   * stored", which is every deployment today. That US-004's boot check must
   * pass here at all is the point — a check nothing reaches guards nothing.
   */
  const db = {
    select: () => ({ from: async () => [{ rows: 0 }] }),
  };

  const handle = { db, pool: {}, close } as unknown as ReturnType<typeof createDatabase>;

  return { close, createDatabase: vi.fn(() => handle) };
}

/**
 * The queue the cost test is sent to.
 *
 * Injected so these tests open no connection, and so "the API borrows the
 * worker's queue when there is one" is an assertion rather than a comment.
 */
function fakeJobSender() {
  const stop = vi.fn(async () => undefined);
  const sender = { sendEstimate: vi.fn(async () => "job-1"), stop } as unknown as JobSender;

  return { sender, stop, startJobSender: vi.fn(async () => sender) };
}

function fakeWorker() {
  const stop = vi.fn(async () => undefined);
  const handle = { boss: {}, stop } as unknown as WorkerHandle;
  const startWorker = vi.fn(async (_options: StartWorkerOptions) => handle);

  return { handle, stop, startWorker, entitledWith: () => startWorker.mock.calls[0]?.[0].entitled };
}

describe("startApi", () => {
  it("starts the worker inside the API process when WORKER_IN_PROCESS is true", async () => {
    const server = fakeServer();
    const worker = fakeWorker();

    const database = fakeDatabase();
    const jobs = fakeJobSender();

    const handle = await startApi({
      env: envWith(true),
      logger,
      buildServer: server.buildServer,
      startWorker: worker.startWorker,
      startJobSender: jobs.startJobSender,
      createDatabase: database.createDatabase,
    });

    expect(worker.startWorker).toHaveBeenCalledTimes(1);
    expect(handle.worker).not.toBeNull();
    // Off is the default, and off is the gate that reads nothing.
    expect(worker.entitledWith()).toBe(admitEveryone);

    // The worker is here, so the cost test uses its queue. A second `pg-boss`
    // would be a second maintenance loop against the same database.
    expect(jobs.startJobSender).not.toHaveBeenCalled();

    await handle.stop();
    expect(worker.stop).toHaveBeenCalledTimes(1);
  });

  it("hands the worker a gate that reads subscriptions when this deployment charges", async () => {
    const worker = fakeWorker();
    const database = fakeDatabase();

    const handle = await startApi({
      env: envWith(true, {
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_PRICE_ID: "price_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        APP_URL: "https://app.example.test",
      }),
      logger,
      buildServer: fakeServer().buildServer,
      startWorker: worker.startWorker,
      startJobSender: fakeJobSender().startJobSender,
      createDatabase: database.createDatabase,
    });

    /**
     * The half of billing that costs money. A route that refuses to write is
     * what a person sees; this is what stops an account that stopped paying
     * from polling on our bill, and it must be wired here, not only exist.
     */
    const entitled = worker.entitledWith();
    expect(typeof entitled).toBe("function");
    expect(entitled).not.toBe(admitEveryone);

    await handle.stop();
  });

  it("leaves the worker to a second container when WORKER_IN_PROCESS is false", async () => {
    const server = fakeServer();
    const worker = fakeWorker();

    const database = fakeDatabase();
    const jobs = fakeJobSender();

    const handle = await startApi({
      env: envWith(false),
      logger,
      buildServer: server.buildServer,
      startWorker: worker.startWorker,
      startJobSender: jobs.startJobSender,
      createDatabase: database.createDatabase,
    });

    expect(worker.startWorker).not.toHaveBeenCalled();
    expect(handle.worker).toBeNull();

    // No worker in this process, so the API opens a queue connection of its
    // own — otherwise the cost test would have nowhere to go.
    expect(jobs.startJobSender).toHaveBeenCalledTimes(1);

    await handle.stop();
    expect(server.app.close).toHaveBeenCalledTimes(1);
    // A connection the shutdown forgets keeps the process alive too.
    expect(jobs.stop).toHaveBeenCalledTimes(1);
    // A pool the shutdown forgets keeps the process alive after it is asked
    // to exit.
    expect(database.close).toHaveBeenCalledTimes(1);
  });
});

/**
 * A deployment that verifies addresses and cannot send. US-092.
 *
 * `verification.test.ts` proves the rule; this proves `startApi` reaches it,
 * which is the part a unit test on a pure function cannot say. The assertion
 * that nothing started is half the case: a process that refuses *after* the
 * worker is up leaves a queue polling a database with no API in front of it.
 */
describe("an instance that asks for a verified address", () => {
  it("refuses to start when it could never send the link", async () => {
    const server = fakeServer();
    const worker = fakeWorker();
    const database = fakeDatabase();
    const jobs = fakeJobSender();

    await expect(
      startApi({
        env: envWith(true, { AUTH_EMAIL_VERIFICATION: "required" }),
        logger,
        buildServer: server.buildServer,
        startWorker: worker.startWorker,
        startJobSender: jobs.startJobSender,
        createDatabase: database.createDatabase,
      }),
    ).rejects.toThrow(/SMTP_HOST, SMTP_FROM/);

    expect(worker.startWorker).not.toHaveBeenCalled();
    expect(database.createDatabase).not.toHaveBeenCalled();
    expect(server.buildServer).not.toHaveBeenCalled();
  });

  it("starts when the mail server that carries the link is configured", async () => {
    const server = fakeServer();
    const worker = fakeWorker();
    const database = fakeDatabase();
    const jobs = fakeJobSender();

    const handle = await startApi({
      env: envWith(true, {
        AUTH_EMAIL_VERIFICATION: "required",
        SMTP_HOST: "smtp.example.test",
        SMTP_FROM: "signalscout@example.test",
      }),
      logger,
      buildServer: server.buildServer,
      startWorker: worker.startWorker,
      startJobSender: jobs.startJobSender,
      createDatabase: database.createDatabase,
    });

    expect(server.buildServer).toHaveBeenCalledTimes(1);
    await handle.stop();
  });
});
