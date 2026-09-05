/**
 * How the API asks the worker to do something.
 *
 * There is exactly one thing it asks for: US-014's cost test, which a person
 * starts by pressing a button and the worker carries out over the next couple
 * of minutes. Everything else in the pipeline begins on the scheduler's own
 * tick, and nothing else here should grow into a general job client — a route
 * that could enqueue anything is a route that can start work no screen is
 * watching.
 *
 * Two ways to get one, because the deployment has two shapes. With
 * `WORKER_IN_PROCESS` the API already holds a `pg-boss`, and using it costs
 * nothing. With a separate worker container the API opens its own connection,
 * and creates the queue first: a `send` to a queue that does not exist yet is
 * refused, and at boot the two processes race.
 */
import { PgBoss } from "pg-boss";
import { deadLetterQueue, estimateQueue, queueDefinitions } from "./queues.js";

export interface JobSender {
  /** Returns null when a test for this run is already queued. */
  readonly sendEstimate: (estimateId: string) => Promise<string | null>;
  readonly stop: () => Promise<void>;
}

/** Use the worker's own queue, when the worker is in this process. */
export function jobSenderFor(boss: PgBoss): JobSender {
  return {
    sendEstimate: (estimateId) =>
      boss.send(estimateQueue, { estimateId }, { singletonKey: estimateId }),
    // Not ours to stop. The worker that owns it stops it.
    stop: async () => {},
  };
}

/** Open a connection of our own, for an API that has no worker beside it. */
export async function startJobSender(databaseUrl: string): Promise<JobSender> {
  const boss = new PgBoss({ connectionString: databaseUrl });

  await boss.start();

  // The same definitions the worker creates, from the same list. `pg-boss`
  // keeps whichever settings the first creator wrote, so a second copy here
  // would decide the queue's retry policy on whichever process booted first.
  // The dead letter queue comes first: a queue cannot name one that is
  // missing.
  for (const { name, ...options } of queueDefinitions()) {
    if (name === deadLetterQueue || name === estimateQueue) {
      await boss.createQueue(name, options);
    }
  }

  return {
    ...jobSenderFor(boss),
    stop: () => boss.stop({ graceful: true }),
  };
}
