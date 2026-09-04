import type { Env, Logger, WorkerHandle } from "@intentwatch/core";
import { createLogger, loadEnv } from "@intentwatch/core";
import { describe, expect, it, vi } from "vitest";
import type { ApiServer } from "./server.js";
import { startApi } from "./start.js";

/**
 * WORKER_IN_PROCESS decides whether one process or two run the queue. Both
 * settings are wired here, because a setting nothing asserts is a setting that
 * quietly stops working.
 */
const logger = createLogger({ level: "silent", name: "test" });

function envWith(workerInProcess: boolean): Env {
  return loadEnv({
    DATABASE_URL: "postgres://user:pw@localhost:5432/unused",
    WORKER_IN_PROCESS: String(workerInProcess),
  });
}

function fakeServer() {
  const app = {
    listen: vi.fn(async () => "http://127.0.0.1:0"),
    close: vi.fn(async () => undefined),
  } as unknown as ApiServer;

  return {
    app,
    buildServer: vi.fn(async (_options: { env: Env; logger: Logger }): Promise<ApiServer> => app),
  };
}

function fakeWorker() {
  const stop = vi.fn(async () => undefined);
  const handle = { boss: {}, stop } as unknown as WorkerHandle;

  return { handle, stop, startWorker: vi.fn(async () => handle) };
}

describe("startApi", () => {
  it("starts the worker inside the API process when WORKER_IN_PROCESS is true", async () => {
    const server = fakeServer();
    const worker = fakeWorker();

    const handle = await startApi({
      env: envWith(true),
      logger,
      buildServer: server.buildServer,
      startWorker: worker.startWorker,
    });

    expect(worker.startWorker).toHaveBeenCalledTimes(1);
    expect(handle.worker).not.toBeNull();

    await handle.stop();
    expect(worker.stop).toHaveBeenCalledTimes(1);
  });

  it("leaves the worker to a second container when WORKER_IN_PROCESS is false", async () => {
    const server = fakeServer();
    const worker = fakeWorker();

    const handle = await startApi({
      env: envWith(false),
      logger,
      buildServer: server.buildServer,
      startWorker: worker.startWorker,
    });

    expect(worker.startWorker).not.toHaveBeenCalled();
    expect(handle.worker).toBeNull();

    await handle.stop();
    expect(server.app.close).toHaveBeenCalledTimes(1);
  });
});
