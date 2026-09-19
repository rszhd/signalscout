/** The cost test: `query_estimates` and the probes behind one. */
import { type Provider, providers, type Source, sources } from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors.js";
import { minimumPollIntervalSeconds, oneOf, optionallyOneOf } from "./vocabulary.js";

export const estimateStatuses = ["collecting", "ready", "failed"] as const;

export type EstimateStatus = (typeof estimateStatuses)[number];

/**
 * What one probe asked the source for.
 *
 * A query and a channel are two discovery modes and they cost differently: a
 * keyword collects what it finds, a subreddit collects a listing. A person
 * reading the result has to be able to tell which line is which.
 */
export const estimateProbeKinds = ["query", "channel"] as const;

export type EstimateProbeKind = (typeof estimateProbeKinds)[number];

/**
 * One cost test: what a search plan would collect, and what it would cost.
 *
 * US-014. On a metered source the money is spent at fetch time, so no filter
 * and no model can save a user from a broad query. Only a narrower query can,
 * and nobody can narrow a query they have never seen run.
 *
 * The row exists before the answer does, and it is the reason this is a table
 * rather than one long HTTP request. A Reddit sample is collected by the
 * provider over about two minutes, and it is billed when it is triggered — so
 * a person who closes the tab has already paid. The row keeps what that money
 * bought.
 *
 * `monitor_id` is null for a test run from the creation form, where the
 * monitor does not exist yet. That is the common case: the whole point is to
 * decide before committing.
 */
export const queryEstimates = pgTable(
  "query_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Whose key pays for this test. US-067.
     *
     * Its own column rather than a read through `monitor_id`, because that one
     * is null for the common case: the cost test runs on a plan, before a
     * monitor exists. A sample is real money spent at a real provider, so the
     * row has to say whose account it was spent on.
     */
    userId: text("user_id").notNull(),
    /** Null while the plan is still a plan. Set when an existing monitor is retested. */
    monitorId: uuid("monitor_id").references(() => monitors.id, { onDelete: "cascade" }),
    status: text("status").$type<EstimateStatus>().notNull().default("collecting"),
    /**
     * The interval the projection assumes.
     *
     * Stored, not read from the monitor, because the answer means nothing
     * without it: the same plan costs twenty-four times as much at the
     * one-hour interval as at the one-day one. A figure whose assumption is
     * not written down is a figure nobody can check later.
     */
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    /**
     * The days the monitor would poll on. US-041, stored here by BUG-005.
     *
     * Kept beside the interval rather than read from the monitor, for the same
     * reason the interval is: an estimate is made before a monitor exists, and
     * a projection is a record of what was quoted rather than a live query. A
     * person who changes their schedule afterwards gets a stale estimate, not a
     * silently re-priced one.
     */
    pollDays: smallint("poll_days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'`),
    /** The cap this run was measured against, in micro-dollars. Null when there is none. */
    monthlyCapMicros: bigint("monthly_cap_micros", { mode: "number" }),
    /** What the test itself consumed and cost. The sum of its probes. */
    units: bigint("units", { mode: "number" }).notNull().default(0),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    /** Why the run failed as a whole. A probe that failed alone carries its own. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  () => [
    check("query_estimates_status_known", oneOf("status", estimateStatuses)),
    check(
      "query_estimates_poll_interval_floor",
      sql.raw(`poll_interval_seconds >= ${minimumPollIntervalSeconds}`),
    ),
    check("query_estimates_units_non_negative", sql.raw(`units >= 0`)),
    check("query_estimates_cost_non_negative", sql.raw(`estimated_cost_micros >= 0`)),
  ],
);

/**
 * One query, run once against one source.
 *
 * A probe per query, rather than one collection carrying all of them, because
 * "which query is the expensive one" is the question this feature exists to
 * answer. A plan tested as a whole tells a person their plan is too broad and
 * nothing about which line to delete.
 *
 * The cursor columns are the same three the poll step uses, and for the same
 * reason: a source that answers "come back in thirty seconds" has usually
 * started work that was billed already, and a dropped cursor pays for it
 * twice. See `worker/continuations.ts` and BUG-001.
 *
 * `samples` holds a few posts so a person can judge whether the volume is
 * worth having. They are short and few on purpose. Reddit's terms require that
 * content the author removed stops being shown, and nothing re-checks a
 * sample, so the least we hold the better. The excerpt is a fifth of what
 * `posts` keeps.
 */
export const queryEstimateProbes = pgTable(
  "query_estimate_probes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id")
      .notNull()
      .references(() => queryEstimates.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /**
     * Who took this sample. Null until the first call decides.
     *
     * A probe holds a cursor, so it has the same rule a continuation has: the
     * sample belongs to the provider that started it, and a changed choice
     * must not resume it through the other one. It is also what the report
     * prices from — two providers charge different amounts for the same
     * Reddit page, so a projection computed from the platform alone would be
     * one provider's arithmetic on the other's bill.
     */
    provider: text("provider").$type<Provider>(),
    kind: text("kind").$type<EstimateProbeKind>().notNull(),
    /** The search phrase, or the channel name. What the person typed or kept. */
    term: text("term").notNull(),
    /**
     * Where this line sits in the plan.
     *
     * The plan has an order — the person read it and edited it in that order —
     * and a screen that reordered it between two reads would read as a
     * different plan. Insertion order is not an order: every row of one insert
     * carries the same `created_at`.
     */
    position: integer("position").notNull(),
    status: text("status").$type<EstimateStatus>().notNull().default("collecting"),
    /** Opaque, from the connector that issued it. Null before the first call. */
    cursor: text("cursor"),
    /** The source's own "come back at". Nothing reads the sample before it. */
    resumeAfter: timestamp("resume_after", { withTimezone: true }),
    /** Resumes that brought nothing back. Bounded, so a stuck sample stops. */
    attempts: integer("attempts").notNull().default(0),
    units: bigint("units", { mode: "number" }).notNull().default(0),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    /** Posts the sample returned. Never the units: Reddit bills a record, not a post. */
    postsFound: integer("posts_found").notNull().default(0),
    /**
     * True when the sample stopped at the size it asked for.
     *
     * It is the difference between "this query finds four posts a week" and
     * "this query found the ten we paid for and had more". The first is a
     * measurement; the second is a floor, and the projection has to say which
     * one it is working from.
     */
    capped: boolean("capped").notNull().default(false),
    oldestPostAt: timestamp("oldest_post_at", { withTimezone: true }),
    newestPostAt: timestamp("newest_post_at", { withTimezone: true }),
    /** A few posts, for judging quality rather than volume. Short excerpts only. */
    samples: jsonb("samples").notNull().default(sql`'[]'::jsonb`),
    /** The connector's own sentence, when this probe failed and the others did not. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One probe per term per source in a run. A plan that named the same query
    // twice would otherwise be billed twice to tell a person the same number.
    unique("query_estimate_probes_term_unique").on(
      table.estimateId,
      table.source,
      table.kind,
      table.term,
    ),
    index("query_estimate_probes_estimate_idx").on(table.estimateId),
    check("query_estimate_probes_source_known", oneOf("source", sources)),
    check("query_estimate_probes_provider_known", optionallyOneOf("provider", providers)),
    check("query_estimate_probes_kind_known", oneOf("kind", estimateProbeKinds)),
    check("query_estimate_probes_status_known", oneOf("status", estimateStatuses)),
    check("query_estimate_probes_units_non_negative", sql.raw(`units >= 0`)),
    check("query_estimate_probes_cost_non_negative", sql.raw(`estimated_cost_micros >= 0`)),
    check("query_estimate_probes_posts_non_negative", sql.raw(`posts_found >= 0`)),
    check("query_estimate_probes_attempts_bounded", sql.raw(`attempts >= 0`)),
  ],
);
