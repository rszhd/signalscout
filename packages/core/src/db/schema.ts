/**
 * Drizzle schema.
 *
 * Correctness-critical. Three of the surfaces in docs/testing.md are database
 * constraints declared here, not code: the post deduplication that stops the
 * same X read being billed twice, the score and intent-type checks that stop
 * an invalid classification being stored as a verdict, and the verification
 * columns the deletion job writes. `schema.test.ts` holds the assertions, and
 * they were written first.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** The sources PLAN.md builds first. A third one is a migration, not a guess. */
export const sources = ["reddit", "x"] as const;
export type Source = (typeof sources)[number];

/** The signals a user ticks in the monitor form. PLAN.md, *Monitor creation*. */
export const signals = [
  "recommendation_request",
  "alternative_search",
  "competitor_complaint",
  "problem",
  "comparison",
  "purchase",
  "hiring",
] as const;
export type Signal = (typeof signals)[number];

/** The intent types the classifier may return. PLAN.md, *Intent classification*. */
export const intentTypes = [
  "none",
  "problem",
  "recommendation_request",
  "alternative_search",
  "competitor_complaint",
  "comparison",
  "purchase",
  "hiring",
] as const;
export type IntentType = (typeof intentTypes)[number];

/** The two buttons on a match. PLAN.md, *Feedback loop*. */
export const verdicts = ["good", "not_relevant"] as const;
export type Verdict = (typeof verdicts)[number];

/**
 * Every embedded post is one row of `embeddingDimensions` numbers. The number
 * matches OpenAI's `text-embedding-3-small`, the cheapest default, and it is
 * fixed rather than free because pgvector cannot index a dimensionless column.
 * A user who switches embedding provider re-embeds anyway, so changing this is
 * a migration plus a backfill either way. US-008 owns the index.
 */
export const embeddingDimensions = 1536;

/**
 * How long a new monitor waits between polls.
 *
 * Poll frequency is a cost dial, not a performance dial. Bright Data's free
 * allowance is 5,000 records a month, and one poll can collect fifty, so a
 * default of every fifteen minutes spends the allowance before anyone reads a
 * match. One hour is the conservative start. US-013's cap is the real guard;
 * this only decides how fast an unguarded monitor gets there.
 */
export const defaultPollIntervalSeconds = 3600;

/**
 * The shortest interval a monitor may be set to.
 *
 * There is no product reason to poll a social network more than once a minute,
 * and on a metered source a typo of `1` instead of `100` is an invoice. The
 * floor is a constraint rather than form validation because the worker reads
 * this column directly.
 */
export const minimumPollIntervalSeconds = 60;

/**
 * The lowest lead score that becomes a match, for a monitor that has not said
 * otherwise.
 *
 * Deliberately permissive. docs/testing.md, *A measured constant needs a
 * committed instrument*: a threshold set too high discards good leads before
 * anyone sees them, and a silent false negative is worse than a noisy inbox
 * because nobody can tell it happened. The instrument that produced this
 * number is `ai/fixtures/capture.mjs`, which scores PLAN.md's four worked
 * examples and prints the totals; re-run it before moving this.
 */
export const defaultMinimumScore = 30;

/** How a call to the model ended. `ai/call.ts` owns the three outcomes. */
export const modelCallOutcomes = ["scored", "rejected", "failed"] as const;
export type ModelCallOutcome = (typeof modelCallOutcomes)[number];

/**
 * What a call to the model was for.
 *
 * US-010 gave the product a second kind of call. Without this column the two
 * are indistinguishable on a bill page, and "what was my key spent on" is a
 * question a bring-your-own-keys product has to be able to answer. It also
 * keeps the classifier's own failure count honest: that count is "how many
 * times did this model refuse this post", and it must never include a call
 * about no post at all.
 */
export const modelCallPurposes = ["classification", "query_generation"] as const;
export type ModelCallPurpose = (typeof modelCallPurposes)[number];

/** SQL fragment for a score column that must read 0 to 100. */
function scoreRange(column: string) {
  return sql.raw(`${column} BETWEEN 0 AND 100`);
}

/** SQL fragment for a text column restricted to a fixed list. */
function oneOf(column: string, values: readonly string[]) {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/**
 * A monitor holds the user's four answers exactly as they typed them, and the
 * generated queries beside them. They are separate columns on purpose: a query
 * is regenerated when the prompt improves, and nobody retypes an answer.
 */
export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Better Auth owns the user table and creates it in US-017, so this carries
     * no foreign key yet. Text, because Better Auth ids are text.
     */
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** The four answers. PLAN.md, *Monitor creation*. */
    product: text("product").notNull(),
    idealCustomer: text("ideal_customer").notNull(),
    problem: text("problem").notNull(),
    signals: text("signals").array().notNull().default(sql`'{}'`),
    /** Generated, not typed. Shown to the user and editable. US-010. */
    generatedQueries: jsonb("generated_queries").notNull().default(sql`'[]'::jsonb`),
    generatedSubreddits: text("generated_subreddits").array().notNull().default(sql`'{}'`),
    /**
     * The connectors this monitor polls. Empty means the monitor is configured
     * but polls nothing, which is what a half-finished monitor should do.
     *
     * There is no check constraint listing the ids, because the registry already
     * refuses to boot on a source it does not have, and `posts.source` refuses to
     * store one the schema cannot hold. Two guards at boot beat one at 02:00.
     * US-010's form writes this column.
     */
    sources: text("sources").array().$type<Source[]>().notNull().default(sql`'{}'`),
    /**
     * The lowest lead score this monitor turns into a match.
     *
     * Per monitor because the right threshold is a judgement about one
     * product's market, not a constant: a monitor over a busy general
     * subreddit needs a higher bar than one over a niche the founder reads
     * anyway. The classifier compares against this column and never against
     * the default.
     */
    minScore: integer("min_score").notNull().default(defaultMinimumScore),
    /** Per monitor, never a constant: US-007's whole point about the cost dial. */
    pollIntervalSeconds: integer("poll_interval_seconds")
      .notNull()
      .default(defaultPollIntervalSeconds),
    /**
     * When the last poll *started*, not when it finished. The scheduler adds the
     * interval to this to decide what is due, so measuring from the start keeps
     * a slow poll from stretching the interval it was given.
     */
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /**
     * When somebody paused this monitor. Null means it is running.
     *
     * A timestamp and not a boolean, because "paused 3 days ago" is what a
     * person needs to read on the monitor list, and a boolean cannot say it.
     *
     * Pausing writes this column and nothing else. Every post, match, verdict
     * and model call the monitor already has is untouched, so resuming picks
     * up a monitor with its history rather than a new one with the same name.
     * The scheduler is the only reader: `findDueMonitors` skips a paused row,
     * so nothing is collected and nothing is billed while it is set. US-010.
     */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      "monitors_poll_interval_floor",
      sql.raw(`poll_interval_seconds >= ${minimumPollIntervalSeconds}`),
    ),
    check("monitors_min_score_range", scoreRange("min_score")),
  ],
);

/**
 * A candidate post, stored once however many monitors match it.
 *
 * `UNIQUE (source, external_id)` is the last defence when the cursor logic
 * fails. An X read costs $0.005, so a re-read window is a charge on the user's
 * card and not a duplicate row problem.
 *
 * Only an excerpt is kept, never a full permanent copy. Reddit's terms require
 * that content the author removed stops being shown, and the least we hold,
 * the less there is to remove. STACK.md, *Honor deletions*.
 */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<Source>().notNull(),
    /** The id the source gave it, such as a Reddit `t3_` fullname. */
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    /** The subreddit on Reddit. Null on X, where the author is the context. */
    channel: text("channel"),
    title: text("title"),
    excerpt: text("excerpt").notNull(),
    /** When the author posted it, not when we read it. */
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null until the keyword stage keeps the post. An embedding call costs money. */
    embedding: vector("embedding", { dimensions: embeddingDimensions }),
  },
  (table) => [
    unique("posts_source_external_id_unique").on(table.source, table.externalId),
    check("posts_source_known", oneOf("source", sources)),
  ],
);

/**
 * How many resumes in a row may bring nothing back before the continuation is
 * abandoned.
 *
 * A collection that never finishes would otherwise be resumed every thirty
 * seconds for the life of the monitor. At the provider's own retry hint that
 * cap is about an hour, which outlasts every collection the capture run saw
 * and still stops. Abandoning is logged and deletes the row, so the next
 * scheduled poll starts the query again rather than the monitor going quiet.
 */
export const maxResumeAttempts = 120;

/**
 * A collection that was started at a source and has not been read yet.
 *
 * Correctness-critical: cursor and deduplication. Bright Data bills at
 * collection time, so a trigger whose cursor is lost is money spent on records
 * nobody reads, and the next poll pays again for the same query. BUG-001 is
 * that failure, seen live.
 *
 * The row is the durable fact and the queued job is only the alarm clock. That
 * order matters: if the queue refuses the job, or the process dies before it is
 * sent, the next poll still finds this row and reads the snapshot instead of
 * triggering a second collection for it.
 *
 * `UNIQUE (monitor_id, source)` is what "one collection in flight per monitor
 * per source" means. It is a constraint rather than a rule in the collector
 * because two workers polling at once is a state this product expects.
 *
 * `since` is carried here and not read from `monitors.last_polled_at`. The poll
 * mark moves when the collection is triggered, so a resume that read the column
 * would ask for posts newer than the trigger and drop everything it had just
 * paid to collect.
 */
export const sourceContinuations = pgTable(
  "source_continuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /** Opaque to everything outside the connector that issued it. */
    cursor: text("cursor").notNull(),
    /** The `since` of the poll that started this collection. Null means all time. */
    since: timestamp("since", { withTimezone: true }),
    /** The source's own answer to "come back at". Nothing reads the snapshot before it. */
    resumeAfter: timestamp("resume_after", { withTimezone: true }).notNull(),
    /**
     * Resumes in a row that brought nothing back. A resume that returned posts
     * sets it to zero, so the cap below stops a stuck collection and never a
     * long one that is being read a page at a time.
     */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("source_continuations_monitor_source_unique").on(table.monitorId, table.source),
    check("source_continuations_source_known", oneOf("source", sources)),
    check("source_continuations_attempts_bounded", sql.raw(`attempts >= 0`)),
  ],
);

/**
 * One classified post against one monitor.
 *
 * A row exists only for a post the model scored. A refusal, a timeout or an
 * out-of-range score leaves the post unclassified and writes nothing (US-009),
 * so every score column is `NOT NULL` and range-checked.
 *
 * `last_verified_at` is `NOT NULL` and defaults to now, so it never holds a
 * null nobody can interpret. A match is verified the moment it is created,
 * because the post was fetched to make it.
 */
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    /** The lead score the inbox sorts and filters on. */
    score: integer("score").notNull(),
    relevance: integer("relevance").notNull(),
    problemFit: integer("problem_fit").notNull(),
    icpFit: integer("icp_fit").notNull(),
    intent: integer("intent").notNull(),
    urgency: integer("urgency").notNull(),
    intentType: text("intent_type").$type<IntentType>().notNull(),
    /** Specific claims about this post, not a restatement of the scores. US-011. */
    reasons: text("reasons").array().notNull(),
    /** Set by the reconciliation job when the post is gone. The row stays. US-015. */
    hidden: boolean("hidden").notNull().default(false),
    /** Null until the user opens it. Drives the unread filter and the re-check rate. */
    readAt: timestamp("read_at", { withTimezone: true }),
    saved: boolean("saved").notNull().default(false),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("matches_monitor_post_unique").on(table.monitorId, table.postId),
    // The inbox reads this table one page at a time, filtered by monitor and
    // by score, and never shows a hidden row. Partial, because the hidden rows
    // are the ones nothing may read: keeping them out of the index keeps them
    // out of the plan as well as out of the result. US-011.
    index("matches_inbox_idx").on(table.monitorId, table.score).where(sql`hidden = false`),
    check("matches_score_range", scoreRange("score")),
    check("matches_relevance_range", scoreRange("relevance")),
    check("matches_problem_fit_range", scoreRange("problem_fit")),
    check("matches_icp_fit_range", scoreRange("icp_fit")),
    check("matches_intent_range", scoreRange("intent")),
    check("matches_urgency_range", scoreRange("urgency")),
    check("matches_intent_type_known", oneOf("intent_type", intentTypes)),
  ],
);

/**
 * One call to a model, whatever it returned.
 *
 * Every call is recorded, not only the ones that produced a match. Three
 * things need that. A self-hoster asks what their key was spent on, and a
 * refusal is billed like an answer. US-013's budget guard needs spend it can
 * add up without asking the provider. And the classifier drops a post that has
 * failed a bounded number of times, which is a count of the rows here, so the
 * limit survives a restart instead of living in one job's memory.
 *
 * Both foreign keys are nullable and set null rather than cascade. A deleted
 * post must not erase what reading it cost: the bill outlives the row.
 *
 * `estimated_cost_micros` is null when the model's price is not configured.
 * Null means "we cannot say", and zero means "this was free". A guessed price
 * would be indistinguishable from a real one on a bill page.
 */
export const modelCalls = pgTable(
  "model_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    /** Named, not chosen by the user: one provider per source, one per model. */
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    outcome: text("outcome").$type<ModelCallOutcome>().notNull(),
    /**
     * Defaulted, because every row that existed before this column was a
     * classification. New callers set it: a default is for the rows nobody can
     * ask any more, not for the ones being written now.
     */
    purpose: text("purpose").$type<ModelCallPurpose>().notNull().default("classification"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms").notNull(),
    /** Micro-dollars. Null when the price is unknown. */
    estimatedCostMicros: integer("estimated_cost_micros"),
    /** The provider's message, for a call that did not produce a match. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The classifier counts a post's failures on this pair before every call.
    index("model_calls_monitor_post_idx").on(table.monitorId, table.postId),
    check("model_calls_outcome_known", oneOf("outcome", modelCallOutcomes)),
    check("model_calls_purpose_known", oneOf("purpose", modelCallPurposes)),
  ],
);

/**
 * One verdict per match per user, kept as history.
 *
 * The rows are append-only. Changing a verdict supersedes the old row and
 * inserts a new one, so the record shows what the user thought and when
 * (US-012). The partial unique index is what makes "one verdict" true: only
 * the rows still in force are counted.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** No foreign key until Better Auth owns the user table. US-017. */
    userId: text("user_id").notNull(),
    verdict: text("verdict").$type<Verdict>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while this is the user's current verdict on the match. */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("feedback_current_verdict_unique")
      .on(table.matchId, table.userId)
      .where(sql`superseded_at IS NULL`),
    check("feedback_verdict_known", oneOf("verdict", verdicts)),
  ],
);

/** What a monitor does when its cap is reached. STACK.md, *Budgets belong in the data model*. */
export const exhaustedBehaviours = ["pause", "notify"] as const;
export type ExhaustedBehaviour = (typeof exhaustedBehaviours)[number];

/**
 * What one monitor spent at one source on one day.
 *
 * Correctness-critical: budget guard. This table is the guard's only evidence,
 * so a call that is billed and not written here is money the cap cannot see.
 * `worker/collect.ts` writes a row after every page rather than once per poll,
 * because a poll that throws on its third page was billed for the first two.
 *
 * The unit is the source's own — Reddit bills a record, X bills a post read —
 * so `units` is comparable only within a source. `source_descriptor.billableUnit`
 * is the word for it, and the cost column is what makes two sources add up.
 *
 * STACK.md sketches this column as `estimated_cost_cents`. It is micro-dollars
 * here, for the reason `model_calls` already uses them: one classification
 * costs about $0.001, which is a tenth of a cent, and a cents column would
 * record the classifier's whole month as zero. Micros, and an integer, so no
 * total is a rounding artefact.
 *
 * `bigint` and not `integer`, because an `integer` of micros stops at $2,147.
 * A monthly cap above that is a reasonable thing for somebody to type, and the
 * running total has to be able to hold what a runaway actually spent.
 */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /** The UTC day. A provider's billing day may differ; this is one more reason the figure is an estimate. */
    day: date("day").notNull(),
    /** Billable units the source reported. Never a post count: `SearchResult.unitsConsumed`. */
    units: bigint("units", { mode: "number" }).notNull().default(0),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per monitor per source per day, so a poll adds to a row rather
    // than inserting one. The guard sums this table on every poll, and a row
    // per page would make that sum grow without limit inside one month.
    unique("api_usage_monitor_source_day_unique").on(table.monitorId, table.source, table.day),
    index("api_usage_monitor_day_idx").on(table.monitorId, table.day),
    check("api_usage_source_known", oneOf("source", sources)),
    check("api_usage_units_non_negative", sql.raw(`units >= 0`)),
    check("api_usage_cost_non_negative", sql.raw(`estimated_cost_micros >= 0`)),
  ],
);

/**
 * One monitor's monthly cap, and what to do when it is reached.
 *
 * The row is optional and its absence means "no cap". That is deliberate: a
 * monitor with no budget row still records every unit it spends, so a person
 * who never set a cap can still be told what the month cost. A default cap
 * would be this software deciding how much of somebody else's key it may use.
 *
 * `monitor_id` is the primary key. One monitor has one budget, and a second
 * row would be two caps that disagree.
 */
export const budgets = pgTable(
  "budgets",
  {
    monitorId: uuid("monitor_id")
      .primaryKey()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** Micro-dollars, for the reason `api_usage` gives. */
    monthlyCapMicros: bigint("monthly_cap_micros", { mode: "number" }).notNull(),
    onExhausted: text("on_exhausted").$type<ExhaustedBehaviour>().notNull().default("pause"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check("budgets_on_exhausted_known", oneOf("on_exhausted", exhaustedBehaviours)),
    // A cap of zero is a monitor that may spend nothing, which is a legal
    // thing to ask for. A negative cap is not.
    check("budgets_cap_non_negative", sql.raw(`monthly_cap_micros >= 0`)),
  ],
);
