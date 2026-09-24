/** What a poll did, in order: `poll_runs` and `stage_runs`. */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors.js";
import {
  oneOf,
  optionallyOneOf,
  type PollOutcome,
  type PollRunSource,
  type PollStopReason,
  pollOutcomes,
  pollStopReasons,
} from "./vocabulary.js";

/**
 * What one poll did, so a person can read it without a database. US-104.
 *
 * On 2026-09-09 a monitor on the production instance polled fifteen times,
 * billed $0.666, stored no post, and the screen said `Running`. Every number
 * needed to explain that was already recorded — `api_usage` had the spend,
 * `posts` had what came back, `pgboss.job` had the timings — and none of them
 * says what a *poll* did. That cannot be reconstructed afterwards: a poll that
 * collected fifty posts another monitor already held and a poll that collected
 * nothing leave the same absence of rows.
 *
 * A row is written on every exit from the poll step, including the exits that
 * do nothing. A poll that records nothing when it does nothing is the fault
 * this table exists to remove, one layer down.
 */
export const pollRuns = pgTable(
  "poll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /**
     * The owner, copied rather than joined. BUG-009's lesson: scoping a route
     * means scoping every read in it, and a read that has to join to find out
     * whose row this is has one more place to forget.
     */
    userId: text("user_id").notNull(),
    /**
     * The collection this poll belongs to, which is not this job.
     *
     * Fifteen poll jobs ran for one collection in the production run, because
     * a paging walk resumes itself through the queue. Grouped by the job, one
     * collection reads as fifteen failures. A poll that finds no continuation
     * mints a new id; a poll that resumes one inherits the id of the monitor's
     * previous run.
     */
    walkId: uuid("walk_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** What the poll did, as one word a screen can group on. */
    outcome: text("outcome").$type<PollOutcome>().notNull(),
    /**
     * Posts the connectors handed back, after their own parsing and their own
     * `since` cut.
     *
     * Not the records the provider returned, which no connector reports — read
     * it beside `units`. Zero here with units above zero is the shape the
     * production run had, and it says the fault is in the query or the parser
     * rather than in the platform being quiet.
     */
    postsReturned: integer("posts_returned").notNull().default(0),
    /**
     * Of those, the ones this instance had never stored.
     *
     * Its own number because the difference is a diagnosis. Many returned and
     * none new is deduplication working and a monitor asking an old question;
     * none returned at all is something else entirely.
     */
    postsNew: integer("posts_new").notNull().default(0),
    /** Billable units, summed across every connector this poll asked. */
    units: bigint("units", { mode: "number" }).notNull().default(0),
    /** Estimated, in the sense docs/costs.md means. The connector's price times its units. */
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    /**
     * One entry per platform the poll considered, whether or not it collected.
     *
     * JSONB rather than a child table because it is written once, read whole,
     * and never queried across rows. Every entry carries its own reason, since
     * a poll may skip one platform and collect another — the reason is a
     * property of the source and not of the poll.
     */
    sources: jsonb("sources").$type<PollRunSource[]>().notNull().default([]),
    /**
     * Why the whole poll stopped, where something stopped it, from a closed
     * set.
     *
     * Closed rather than free text because this is the field a person reads
     * first, and a sentence written at the call site cannot be counted,
     * translated or asserted. Null is the ordinary answer: nothing stopped it.
     */
    stopReason: text("stop_reason").$type<PollStopReason>(),
  },
  (table) => [
    // The screen's own query: this monitor's polls, newest first.
    index("poll_runs_monitor_started_idx").on(table.monitorId, table.startedAt),
    index("poll_runs_walk_idx").on(table.walkId),
    check("poll_runs_outcome_known", oneOf("outcome", pollOutcomes)),
    check("poll_runs_stop_reason_known", optionallyOneOf("stop_reason", pollStopReasons)),
    check("poll_runs_counts_non_negative", sql.raw(`posts_returned >= 0 AND posts_new >= 0`)),
    // A poll cannot store more than it was handed.
    check("poll_runs_new_within_returned", sql.raw(`posts_new <= posts_returned`)),
    check("poll_runs_spend_non_negative", sql.raw(`units >= 0 AND estimated_cost_micros >= 0`)),
  ],
);

/**
 * The stages that write a row of their own. US-201.
 *
 * The poll is not one of them. It has `poll_runs`, which says more than this
 * table can — the walk it belongs to, the platform-by-platform breakdown — and
 * a second row saying the same thing would be two answers about one job.
 */
export const stageNames = ["filter", "replies", "classify", "notify"] as const;

export type StageName = (typeof stageNames)[number];

/**
 * What a stage did, in one word, read the way `pollOutcomes` is read.
 *
 * `done` is the only one that moved the work along. `empty` is the stage that
 * ran with nothing to do, which is an answer and not a failure — a filter
 * handed no posts is the normal end of a poll that found nothing. `refused` is
 * the stage that could not start: a cap, a missing model, a missing key.
 * `failed` is the throw, written before the job is retried, because the retry
 * cannot say what the attempt before it did.
 */
export const stageOutcomes = ["done", "empty", "refused", "failed"] as const;

export type StageOutcome = (typeof stageOutcomes)[number];

/**
 * Why a stage refused, from a closed set, for `pollStopReasons`' reasons: this
 * is the field a person reads first, and a sentence written at the call site
 * can be neither counted nor translated.
 */
export const stageStopReasons = [
  /** US-013's cap stopped it, part way or before it began. */
  "budget_exhausted",
  /** No model is configured for this owner, so nothing could be asked. */
  "no_model",
  /** No provider of this platform has a key. The replies stage buys pages. */
  "no_credentials",
  /** The step threw. The row is written before the throw reaches the queue. */
  "error",
] as const;

export type StageStopReason = (typeof stageStopReasons)[number];

/**
 * What one stage did, in its own numbers.
 *
 * A union rather than a wide row of nullable columns, and JSONB for
 * `poll_runs.sources`' reason: it is written once, read whole, and never
 * queried across rows. The two numbers every stage has — what went in and what
 * came out — are columns, because a screen orders and sums on those.
 */
export type StageRunDetail =
  | {
      readonly stage: "filter";
      /** Dropped by each stage of the pre-filter, in the order they run. */
      readonly keyword: number;
      readonly embedding: number;
      readonly triage: number;
    }
  | {
      readonly stage: "replies";
      readonly threadsOpened: number;
      readonly threadsSkipped: number;
      readonly pagesBought: number;
    }
  | {
      readonly stage: "classify";
      /**
       * Posts this run got an answer for from the model, whatever the score.
       *
       * Not what it was handed. US-206: a retry is given the same post ids and
       * skips the ones already scored, and counting those as scored made a
       * four-second retry claim a hundred and sixteen classifications.
       */
      readonly scored: number;
      /**
       * Posts it did not ask about, because this monitor's current version had
       * already paid to score them. BUG-003's skip, in the record of the work.
       */
      readonly skipped?: number;
      /**
       * Posts it did not ask about because each repeats one this monitor
       * already scored: the same author and words. US-400. Optional: older
       * rows have no number for it.
       */
      readonly copies?: number;
      /** Of those, the ones that cleared the monitor's threshold. */
      readonly matched: number;
      /** The model would not answer. They keep their place and are asked again. */
      readonly unclassified: number;
      /** Asked too many times and given up on. US-104's sibling failure. */
      readonly dropped: number;
      /** Posts the cap stopped this run from reaching. They keep their place. */
      readonly leftByCap: number;
    }
  | {
      readonly stage: "notify";
      /** Deliveries written to the outbox: one email, or one digest of many. */
      readonly deliveries: number;
    };

/**
 * One row per run of a stage after the poll. US-201.
 *
 * US-104 wrote `poll_runs` because a poll that collected nothing and a poll
 * that collected what we already had leave the same absence of rows. Every
 * stage after it has the same problem and two of them spend money: a filter
 * that dropped forty posts on triage, a classifier that stopped at the cap
 * with five posts unread, and a quiet inbox that is none of those look
 * identical from the tables.
 *
 * `filter_drops` is not this. It holds a drop and its similarity, for tuning a
 * threshold; it cannot say that a stage ran, or what it cost, or that nothing
 * was dropped at all.
 */
export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** The owner, copied rather than joined, for `poll_runs.user_id`'s reason. */
    userId: text("user_id").notNull(),
    stage: text("stage").$type<StageName>().notNull(),
    /**
     * The collection this stage was part of, or null. US-203.
     *
     * The same id `poll_runs.walk_id` carries, handed along in the job rather
     * than looked up: a stage knows its posts and a post carries no walk, so
     * reading "the monitor's newest poll" would file a classification under
     * whichever poll happened to be running when it finished. Null on a row
     * written before this existed, and on the notification sweep, which
     * belongs to no collection.
     */
    walkId: uuid("walk_id"),
    /**
     * The poll whose posts this stage processed, or null. US-211.
     *
     * The walk above says which collection; this says which poll inside it, so
     * a screen can put a filter under the poll that fed it rather than under a
     * walk holding three of them.
     *
     * `set null` and not `cascade`, because the two tables are trimmed at
     * different depths: `poll_runs` keeps 200 rows per monitor and this table
     * keeps 800, so a stage outliving its poll is routine. The row stays and
     * loses only the reference, which a screen reads as "this walk, poll
     * unknown" — the truth, and better than deleting the record of work that
     * happened.
     *
     * A reply's stages carry the poll that found the thread. The comments
     * themselves were collected by no poll, and that is the only useful answer.
     */
    pollRunId: uuid("poll_run_id").references(() => pollRuns.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<StageOutcome>().notNull(),
    /**
     * What the stage was handed: posts for the filter and the classifier,
     * threads for the replies stage, matches for the notifier.
     */
    itemsIn: integer("items_in").notNull().default(0),
    /**
     * What it passed on: posts that survived, replies stored, matches written,
     * deliveries queued. Not bounded by `items_in` — one thread returns many
     * replies — so nothing here asserts it is.
     */
    itemsOut: integer("items_out").notNull().default(0),
    /** Billable units, where the stage buys from a provider. The replies stage does. */
    units: bigint("units", { mode: "number" }).notNull().default(0),
    /** Estimated, in the sense docs/costs.md means: provider units and model calls. */
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    detail: jsonb("detail").$type<StageRunDetail>(),
    stopReason: text("stop_reason").$type<StageStopReason>(),
  },
  (table) => [
    // The screen's own query: this monitor's stages, newest first.
    index("stage_runs_monitor_started_idx").on(table.monitorId, table.startedAt),
    // The read that groups a collection with the stages it caused.
    index("stage_runs_walk_idx").on(table.walkId),
    // And the one that groups a single poll with them. US-211.
    index("stage_runs_poll_run_idx").on(table.pollRunId),
    check("stage_runs_stage_known", oneOf("stage", stageNames)),
    check("stage_runs_outcome_known", oneOf("outcome", stageOutcomes)),
    check("stage_runs_stop_reason_known", optionallyOneOf("stop_reason", stageStopReasons)),
    check("stage_runs_counts_non_negative", sql.raw(`items_in >= 0 AND items_out >= 0`)),
    check("stage_runs_spend_non_negative", sql.raw(`units >= 0 AND estimated_cost_micros >= 0`)),
  ],
);
