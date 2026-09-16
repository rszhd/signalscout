/**
 * Which monitors are due, and sending their poll jobs.
 *
 * Poll frequency is a cost dial, not a performance dial, so the interval is
 * per monitor and read from the row. Nothing here holds a default: a constant
 * in this file would be the same interval for every monitor, which is the
 * thing the column exists to avoid.
 *
 * Two workers tick at the same time on purpose. Both find the same due
 * monitors and both send, and the poll queue's `stately` policy keyed on the
 * monitor id turns the second send into `null`. That is the guarantee the
 * ticket asks for — a queue policy, not a lock this file writes.
 */

import type { Logger } from "@signalscout/engine";
import { and, isNull, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "../db/client.js";
import { monitors } from "../db/schema.js";
import { admitEveryone, type EntitlementGate } from "./entitlement.js";
import { pollQueue } from "./queues.js";

export interface DueMonitor {
  readonly id: string;
  readonly pollIntervalSeconds: number;
  /** Who the poll is for, so the gate can be asked. */
  readonly userId: string;
}

/**
 * Monitors whose last poll started at least their own interval ago, on a day
 * they poll, plus those that have never been polled, minus the paused ones.
 *
 * `now()` is Postgres's clock, not the worker's. Two workers on two machines
 * with two slightly wrong clocks would otherwise disagree about what is due,
 * and the disagreement would show up as a poll that runs early. US-041's day
 * check is in the same query for the same reason: a worker that decided the
 * day in TypeScript would decide it in its own timezone.
 *
 * **A missed window is not owed.** The question is "is now inside this
 * monitor's schedule", never "how many windows have passed", so a monitor whose
 * worker was down over a weekend polls once when it comes back rather than
 * three times to catch up. That falls out of asking about now rather than about
 * history, and it is the behaviour a person expects from a pause.
 *
 * Pausing is enforced here and nowhere else. A pause that only hid the monitor
 * in the UI would keep collecting and keep billing, which is the opposite of
 * what a person means when they press it. US-010.
 */
export async function findDueMonitors(db: Database): Promise<DueMonitor[]> {
  return db
    .select({
      id: monitors.id,
      pollIntervalSeconds: monitors.pollIntervalSeconds,
      userId: monitors.userId,
    })
    .from(monitors)
    .where(
      and(
        // A monitor that names no source has nothing to poll.
        sql`cardinality(${monitors.sources}) > 0`,
        // A paused monitor keeps its history and collects nothing.
        isNull(monitors.pausedAt),
        /**
         * Today, where the monitor lives. US-041.
         *
         * `AT TIME ZONE` reads the monitor's own zone, because a person who
         * chose weekdays meant their weekdays — in UTC a Monday in Kuala Lumpur
         * starts at 8am on Sunday.
         */
        sql`extract(dow from (now() AT TIME ZONE ${monitors.pollTimezone})) = ANY(${monitors.pollDays})`,
        or(
          isNull(monitors.lastPolledAt),
          sql`${monitors.lastPolledAt} + make_interval(secs => ${monitors.pollIntervalSeconds}) <= now()`,
        ),
      ),
    );
}

export interface TickResult {
  readonly due: number;
  /** Due monitors whose owner the gate did not admit. Never sent. */
  readonly refused: number;
  /** Sends that the queue policy turned away because a poll was already in flight. */
  readonly alreadyQueued: number;
}

/**
 * Send a poll job for every due monitor whose owner may poll. One tick of the
 * scheduler.
 *
 * The gate is asked once, with every due owner, before anything is sent. If
 * it throws, this throws, and nothing was sent: `entitlement.ts` says why
 * that is the right way round.
 */
export async function enqueueDuePolls(
  db: Database,
  boss: PgBoss,
  logger: Logger,
  entitled: EntitlementGate = admitEveryone,
): Promise<TickResult> {
  const due = await findDueMonitors(db);
  if (due.length === 0) return { due: 0, refused: 0, alreadyQueued: 0 };

  const admitted = await entitled(new Set(due.map((monitor) => monitor.userId)));
  const sendable = due.filter((monitor) => admitted.has(monitor.userId));
  const refused = due.length - sendable.length;
  let alreadyQueued = 0;

  for (const monitor of sendable) {
    // `send` answers null when the queue policy refuses the job. The monitor
    // id as the key is what makes "refuse" mean "this monitor is already
    // being polled".
    const jobId = await boss.send(
      pollQueue,
      { monitorId: monitor.id },
      { singletonKey: monitor.id },
    );

    if (jobId === null) {
      alreadyQueued += 1;
      logger.debug({ monitorId: monitor.id }, "poll not sent: one is already queued or active");
    }
  }

  const result = { due: due.length, refused, alreadyQueued };

  logger.info(result, "scheduler tick");

  return result;
}
