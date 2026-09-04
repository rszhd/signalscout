import { PgBoss } from "pg-boss";
import type { Logger } from "../logger.js";

/** The queue every deployment has, so "is the worker alive?" has an answer. */
export const heartbeatQueue = "heartbeat";

export type HeartbeatPayload = Record<string, never>;

export interface WorkerHandle {
  boss: PgBoss;
  stop: () => Promise<void>;
}

export interface StartWorkerOptions {
  databaseUrl: string;
  logger: Logger;
}

/**
 * Boot pg-boss and register the queues this deployment serves.
 *
 * The same function is called by the worker container and, when
 * WORKER_IN_PROCESS is true, by the API process. There is no second code path.
 * US-007 adds the scheduled jobs; this only proves the queue works end to end.
 */
export async function startWorker({
  databaseUrl,
  logger,
}: StartWorkerOptions): Promise<WorkerHandle> {
  const boss = new PgBoss({ connectionString: databaseUrl });

  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));

  await boss.start();
  await boss.createQueue(heartbeatQueue);
  await boss.work<HeartbeatPayload>(heartbeatQueue, async (jobs) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id }, "heartbeat");
    }
  });

  logger.info({ queues: [heartbeatQueue] }, "worker ready");

  return {
    boss,
    stop: async () => {
      await boss.stop({ graceful: true });
    },
  };
}
