/**
 * What the worker is doing for a monitor right now. US-265.
 *
 * The pipeline is five queues — poll, filter, replies, classify, notify — and
 * a job in one of them is a stage of the work. The poll is the short half. The
 * minutes that follow it are the pre-filter, the triage, the threads and the
 * classifier, and those are the minutes a person is waiting for the inbox to
 * fill. Until this, the screens could describe them only as "Next poll in 6
 * hours".
 *
 * Nothing new is written for this. `pg-boss` already stores the row, the state
 * and the payload, and every pipeline payload names its monitor.
 *
 * **The table is not ours.** `pgboss.job` belongs to the queue library and is
 * created by the worker, not by a migration, so an API that boots first talks
 * to a database without it. Every failure here answers "no stage": this is a
 * sentence on a screen, and a monitor list that returns 500 because a queue
 * table is missing would be a worse screen than one that says less.
 *
 * **The scope is the ids.** This takes monitor ids and asks nothing about who
 * owns them, so a caller hands it ids that came out of a scoped select —
 * `listMonitors` or `ownedMonitor` — and never one typed into an address.
 */
import { type Database, pipelineQueues } from "@signalscout/pipeline";
import { sql } from "drizzle-orm";

/** A stage a person is waiting on, as the API sends it. */
export interface MonitorStage {
  /** The queue, named by the package. The screen turns it into a sentence. */
  readonly queue: string;
  /** `active` is a worker holding it; `queued` is one about to. */
  readonly state: "active" | "queued";
  /** When it started, or when it was queued. */
  readonly since: string;
  /**
   * How many posts or matches the job holds, or null.
   *
   * The poll carries no list — it is about to ask a provider what exists — so
   * null here is "this stage has no count", not "no items".
   */
  readonly items: number | null;
  /** The collection this job belongs to, or null. */
  readonly walkId: string | null;
}

/**
 * Which `pg-boss` states are work a person is waiting on.
 *
 * `completed`, `failed` and `cancelled` are history, and history on this bar
 * would be a stage that never ends: a completed row lives for days.
 */
const pendingStates = ["created", "retry", "active"];

interface StageRow {
  readonly monitor_id: string | null;
  readonly name: string | null;
  readonly state: string | null;
  readonly since: Date | string | null;
  readonly items: number | string | null;
  readonly walk_id: string | null;
}

function toStage(row: StageRow): MonitorStage | null {
  if (!row.name || !row.since) return null;

  const items = row.items === null ? null : Number(row.items);

  return {
    queue: row.name,
    state: row.state === "active" ? "active" : "queued",
    since: new Date(row.since).toISOString(),
    items: items === null || Number.isNaN(items) ? null : items,
    walkId: row.walk_id,
  };
}

/**
 * The stage each of these monitors is in, for the whole list in one statement.
 *
 * One query and not one per monitor, for the reason the spend and the poll
 * runs beside it are one: a query per row is the shape that reads fine with
 * three monitors and stops the page with thirty.
 *
 * `distinct on` keeps one row per monitor, and the order says which: a running
 * stage before a queued one, then the newest. A monitor can hold both — the
 * classifier working while the next poll waits — and the one to show is the
 * one doing something.
 */
export async function monitorStages(
  db: Database,
  monitorIds: readonly string[],
): Promise<Map<string, MonitorStage>> {
  const stages = new Map<string, MonitorStage>();

  if (monitorIds.length === 0) return stages;

  try {
    /**
     * `in ${array}` and not `= any(${array})`.
     *
     * Drizzle expands a JavaScript array in a raw statement into a parameter
     * tuple — `($1, $2, $3)` — which is what `in` takes and which `any` cannot
     * read: `any(($1, $2, $3))` is a syntax error, and the catch below would
     * turn it into "nothing is running" on every screen, for ever. The test
     * file drives this through the real library so that cannot pass quietly.
     */
    const result = await db.execute(sql`
      select distinct on (job.data->>'monitorId')
        job.data->>'monitorId' as monitor_id,
        job.name as name,
        job.state::text as state,
        coalesce(job.started_on, job.created_on) as since,
        case
          when jsonb_typeof(job.data->'postIds') = 'array'
            then jsonb_array_length(job.data->'postIds')
          when jsonb_typeof(job.data->'matchIds') = 'array'
            then jsonb_array_length(job.data->'matchIds')
        end as items,
        job.data->>'walkId' as walk_id
      from pgboss.job as job
      where job.name in ${[...pipelineQueues]}
        and job.state::text in ${pendingStates}
        and job.data->>'monitorId' in ${[...monitorIds]}
      order by
        job.data->>'monitorId',
        (job.state::text = 'active') desc,
        coalesce(job.started_on, job.created_on) desc
    `);

    for (const row of result.rows as unknown as StageRow[]) {
      const stage = toStage(row);
      if (row.monitor_id && stage) stages.set(row.monitor_id, stage);
    }
  } catch {
    // No `pgboss` schema yet, or a read that failed. Both mean the same thing
    // to the screen: nothing is known to be running. See the header.
    return new Map();
  }

  return stages;
}
