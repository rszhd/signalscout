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
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { type BillingMode, entitledCondition } from "../billing/index.js";
import type { Database } from "../db/client.js";
import { monitors, subscriptions } from "../db/schema.js";
import type { Logger } from "../logger.js";
import { pollQueue } from "./queues.js";

export interface DueMonitor {
  readonly id: string;
  readonly pollIntervalSeconds: number;
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
export async function findDueMonitors(
  db: Database,
  /**
   * Whether this deployment charges. US-072.
   *
   * `off` is the default and it is the whole self-hosted behaviour: the join
   * below is still made and the condition is still true for every row, so the
   * query a self-hoster runs returns exactly what it returned before billing
   * existed.
   *
   * This is the half of the gate that matters. A route that refuses to write is
   * what a person sees; this is what stops our hosting, our database and our
   * compute being spent on an account that stopped paying — and an account
   * still polling after it cancelled is invisible from every screen.
   */
  billing: BillingMode = "off",
): Promise<DueMonitor[]> {
  return (
    db
      .select({ id: monitors.id, pollIntervalSeconds: monitors.pollIntervalSeconds })
      .from(monitors)
      /**
       * The owner's subscription, or no row.
       *
       * A left join and not an inner one, because no row is the normal state:
       * self-hosted nothing ever writes here, and a hosted instance has accounts
       * older than the table. `entitledCondition` reads both as entitled.
       */
      .leftJoin(subscriptions, eq(subscriptions.userId, monitors.userId))
      .where(
        and(
          billing === "off"
            ? sql`true`
            : entitledCondition(sql`${subscriptions.status}`, sql`${subscriptions.trialEndsAt}`),
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
      )
  );
}

export interface TickResult {
  readonly due: number;
  /** Sends that the queue policy turned away because a poll was already in flight. */
  readonly alreadyQueued: number;
}

/** Send a poll job for every due monitor. One tick of the scheduler. */
export async function enqueueDuePolls(
  db: Database,
  boss: PgBoss,
  logger: Logger,
  billing: BillingMode = "off",
): Promise<TickResult> {
  const due = await findDueMonitors(db, billing);
  let alreadyQueued = 0;

  for (const monitor of due) {
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

  const result = { due: due.length, alreadyQueued };

  if (due.length > 0) logger.info(result, "scheduler tick");

  return result;
}
