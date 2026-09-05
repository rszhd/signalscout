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
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * The platforms PLAN.md builds first. A third one is a migration, not a guess.
 *
 * This is the platform axis: what a person ticks, what `posts.source` stores,
 * and what deduplication is keyed by. The same Reddit post fetched through two
 * providers is one post and one row here. US-024 separated the axes;
 * `sources/types.ts` says why.
 */
export const sources = ["reddit", "x"] as const;
export type Source = (typeof sources)[number];

/**
 * The providers a key can belong to. A third one is a migration, not a guess.
 *
 * This is the other axis: who fetched, whose key it is, and what it bills. It
 * is on `api_usage` and `source_continuations` because both describe work one
 * provider did, on `posts` for attribution only, and it is what
 * `source_credentials` is keyed by, because a key belongs to the account and
 * not to the network.
 *
 * US-024 added `scrapecreators` before it had a connector, so the re-key could
 * run first and a ScrapeCreators key would have somewhere to live. US-025 then
 * wrote the connector, and both values are now reachable: one Reddit poll has
 * been billed to each provider.
 */
export const providers = ["brightdata", "scrapecreators"] as const;
export type Provider = (typeof providers)[number];

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
 * a migration plus a backfill either way.
 *
 * There is no index on the column, and US-008 decided not to add one. The
 * pre-filter compares the handful of post ids one poll returned against one
 * monitor vector, which reads those rows and never searches the table. An
 * index belongs to the first feature that asks "which posts are like this
 * one", and nothing asks that yet.
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

/**
 * The similarity a post needs, by default, to survive the embedding stage.
 *
 * Permissive on purpose, and for the reason US-008 gives: a threshold set too
 * high drops a good lead before anybody sees it, and nobody can tell that
 * happened. A noisy inbox is visible; a silent false negative is not.
 *
 * **One run has measured it, over five posts.** On 2026-09-05
 * `ai/fixtures/capture-embeddings.ts` embedded PLAN.md's example monitor and
 * the five fake posts with OpenAI's `text-embedding-3-small`. The four posts
 * about the monitor's subject scored 0.26 to 0.57, and the post about
 * sourdough scored 0.09, so this number sits inside a gap of 0.18 with room on
 * both sides. `ai/similarity.test.ts` replays those numbers and turns red if
 * the threshold leaves the gap.
 *
 * That is one monitor and five posts, not a distribution. Every drop is
 * written to `filter_drops` with the similarity that caused it, so real weeks
 * of real posts are the instrument that moves it next.
 */
export const defaultSimilarityThreshold = 0.15;

/** The two stages of the pre-filter, in the order they run. US-008. */
export const filterStages = ["keyword", "embedding"] as const;
export type FilterStage = (typeof filterStages)[number];

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
 *
 * US-008 added the third. An embedding is a different model, a different price
 * and a different order of magnitude — about one hundredth of a classification
 * — so a bill that could not tell them apart could not show that the
 * pre-filter pays for itself.
 */
export const modelCallPurposes = ["classification", "query_generation", "embedding"] as const;
export type ModelCallPurpose = (typeof modelCallPurposes)[number];

/** SQL fragment for a score column that must read 0 to 100. */
function scoreRange(column: string) {
  return sql.raw(`${column} BETWEEN 0 AND 100`);
}

/** SQL fragment for a text column restricted to a fixed list. */
function oneOf(column: string, values: readonly string[]) {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/** The same, for a nullable column, where null means "we cannot say". */
function optionallyOneOf(column: string, values: readonly string[]) {
  return sql.raw(
    `${column} IS NULL OR ${column} IN (${values.map((value) => `'${value}'`).join(", ")})`,
  );
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
    /**
     * Whether the pre-filter runs at all for this monitor. US-008.
     *
     * Off means every collected post reaches the model, which is the expensive
     * direction and the honest default for somebody who suspects the filter is
     * dropping good leads. A person who cannot turn a filter off cannot find
     * out what it was hiding.
     */
    preFilterEnabled: boolean("pre_filter_enabled").notNull().default(true),
    /**
     * The cosine similarity a post needs to reach the model, once it has
     * passed the keyword stage.
     *
     * Per monitor, like `min_score`, because the right bar is a judgement
     * about one product's market. Zero keeps everything the keyword stage
     * kept, which is how a person turns the second stage off without turning
     * the first one off.
     */
    similarityThreshold: real("similarity_threshold").notNull().default(defaultSimilarityThreshold),
    /**
     * The monitor's own description, embedded once, and the exact text that
     * produced it.
     *
     * Two columns rather than one, so "has this been edited?" is answered by
     * comparing the text we embedded against the text we would embed now. A
     * timestamp could not answer it, and a writer that remembered to clear the
     * vector on every edit would be a rule in one caller — which is the shape
     * docs/testing.md warns about. The pre-filter re-embeds when they differ,
     * and only then.
     */
    descriptionEmbedding: vector("description_embedding", { dimensions: embeddingDimensions }),
    descriptionEmbeddingSource: text("description_embedding_source"),
    /**
     * Which version of this monitor's definition is in force.
     *
     * A verdict in `feedback` records the version it was given against, and
     * that is the whole reason this column exists. US-012's Context: feedback
     * collected against one definition and later replayed against a different
     * one teaches the wrong lesson.
     *
     * It counts edits to the definition the classifier reads — the product,
     * the ideal customer, the problem and the signals, which are exactly the
     * fields `ai/prompt.ts` puts in the system prompt. A rename, a new poll
     * interval, an edited query or a moved threshold change what is collected
     * or how often, not what a good lead is, so they leave the version alone.
     * `updateMonitor` is the only writer.
     */
    version: integer("version").notNull().default(1),
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
    // Cosine similarity between two embeddings of real text is never above 1,
    // and a negative threshold would keep everything while reading as a
    // setting somebody had chosen.
    check("monitors_similarity_threshold_range", sql.raw("similarity_threshold BETWEEN 0 AND 1")),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Null until the keyword stage keeps the post. An embedding call costs money. */
    embedding: vector("embedding", { dimensions: embeddingDimensions }),
    /**
     * Which provider this copy came back from. Attribution, and nothing more.
     *
     * Deliberately outside `UNIQUE (source, external_id)`. The same Reddit
     * post collected through two providers is one post, and putting this
     * column in the key would make it two rows — the second of them a second
     * classification, a second embedding and a second charge for the same
     * conversation.
     *
     * Null for a row stored before US-024, and for a row whose first fetch we
     * no longer know. Null means "we cannot say", not "no provider".
     */
    provider: text("provider").$type<Provider>(),
  },
  (table) => [
    unique("posts_source_external_id_unique").on(table.source, table.externalId),
    check("posts_source_known", oneOf("source", sources)),
    check("posts_provider_known", optionallyOneOf("provider", providers)),
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
 * `UNIQUE (monitor_id, source, provider)` is what "one collection in flight
 * per monitor per connector" means. It is a constraint rather than a rule in
 * the collector because two workers polling at once is a state this product
 * expects. The provider is in the key because a snapshot id belongs to the
 * provider that issued it: two providers fetching one platform for one monitor
 * are two collections, and a key without the provider would let one of them
 * overwrite the other's cursor — money spent on records nobody reads.
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
    /** Who is collecting. The cursor below means nothing without it. */
    provider: text("provider").$type<Provider>().notNull(),
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
    unique("source_continuations_monitor_source_unique").on(
      table.monitorId,
      table.source,
      table.provider,
    ),
    check("source_continuations_source_known", oneOf("source", sources)),
    check("source_continuations_provider_known", oneOf("provider", providers)),
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
 * A post the pre-filter kept from the model, and what it was that stopped it.
 *
 * The whole point of the row is the number beside it. US-008's risk is a
 * threshold set too high: it discards good leads before anybody sees them, and
 * a silent false negative leaves no trace at all. So a drop is written down
 * with the similarity that caused it, and a person can ask what a different
 * threshold would have kept instead of guessing.
 *
 * Only drops are here. A post the filter kept keeps its embedding on the
 * `posts` row, so its similarity can be computed again; a dropped post is the
 * one whose evidence would otherwise be gone. `similarity` is null for a
 * keyword-stage drop, which is the honest answer: nothing was embedded, so
 * nothing was measured.
 *
 * `UNIQUE (monitor_id, post_id)` because a poll returns posts it has returned
 * before. The row is updated rather than added to, so the count of drops is a
 * count of posts and not a count of polls.
 */
export const filterDrops = pgTable(
  "filter_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    stage: text("stage").$type<FilterStage>().notNull(),
    /** Cosine similarity, 0 to 1. Null at the keyword stage: nothing was measured. */
    similarity: real("similarity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("filter_drops_monitor_post_unique").on(table.monitorId, table.postId),
    // The counter on the monitor list groups by this pair.
    index("filter_drops_monitor_stage_idx").on(table.monitorId, table.stage),
    check("filter_drops_stage_known", oneOf("stage", filterStages)),
    check(
      "filter_drops_similarity_range",
      sql.raw("similarity IS NULL OR similarity BETWEEN -1 AND 1"),
    ),
  ],
);

/**
 * One verdict per match per user, kept as history.
 *
 * The rows are append-only. Changing a verdict supersedes the old row and
 * inserts a new one, so the record shows what the user thought and when
 * (US-012). The partial unique index is what makes "one verdict" true: only
 * the rows still in force are counted.
 *
 * `monitor_id` is written here as well as reachable through the match. Two
 * reasons, and neither is speed. The counts on the monitor list are a question
 * about a monitor, and a count that has to join through matches is a count
 * that goes wrong the first time a match is filtered. And US-012's Context
 * asks for the verdict to be stored with the monitor, not merely near it.
 *
 * `monitor_version` is the version the verdict was given against. It is what
 * stops a later ticket replaying "this is a good lead" against a monitor that
 * now describes a different product.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** `monitors.version` when the verdict was given. Never updated afterwards. */
    monitorVersion: integer("monitor_version").notNull(),
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
    // The monitor list counts the verdicts still in force, one group per
    // monitor. Partial for the same reason the index above is: the superseded
    // rows are history, and no count includes them.
    index("feedback_monitor_current_idx")
      .on(table.monitorId, table.verdict)
      .where(sql`superseded_at IS NULL`),
    check("feedback_verdict_known", oneOf("verdict", verdicts)),
    check("feedback_monitor_version_positive", sql.raw("monitor_version >= 1")),
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
 * The unit is the connector's own — Bright Data bills a Reddit record, X bills
 * a post read — so `units` is comparable only within one platform and provider
 * together. `ConnectorDescriptor.billableUnit` is the word for it, and the cost
 * column is what makes two connectors add up. That is why the provider is on
 * this row and in its key: two providers fetching one platform do not bill the
 * same unit at the same price, so a row that summed them would be adding
 * records to post reads.
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
    /**
     * Null for a call that was made before any monitor existed.
     *
     * US-014's cost test is that call: a person asks what a query would
     * collect, and the answer is bought from the source before they decide
     * whether to keep the monitor at all. `model_calls.monitor_id` is null for
     * the same reason and says the same thing — the call is on the bill and on
     * no monitor's cap.
     *
     * A null row is therefore money no cap can see. That is the honest reading
     * of it: a cap guards the worker, which spends at 02:00 with nobody
     * watching, and the cost test spends only when a person presses a button
     * and is shown the price. docs/costs.md says so to the user.
     */
    monitorId: uuid("monitor_id").references(() => monitors.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /** Whose bill this lands on, and whose price computed the cost beside it. */
    provider: text("provider").$type<Provider>().notNull(),
    /** The UTC day. A provider's billing day may differ; this is one more reason the figure is an estimate. */
    day: date("day").notNull(),
    /** Billable units the source reported. Never a post count: `SearchResult.unitsConsumed`. */
    units: bigint("units", { mode: "number" }).notNull().default(0),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per monitor per connector per day, so a poll adds to a row
    // rather than inserting one. The guard sums this table on every poll, and
    // a row per page would make that sum grow without limit inside one month.
    //
    // `nullsNotDistinct` is what keeps that true for the rows with no monitor.
    // Postgres treats two nulls as different by default, so the unattributed
    // cost tests of one day would insert a row each instead of adding to one,
    // and the table would grow with every press of a button.
    unique("api_usage_monitor_source_day_unique")
      .on(table.monitorId, table.source, table.provider, table.day)
      .nullsNotDistinct(),
    index("api_usage_monitor_day_idx").on(table.monitorId, table.day),
    check("api_usage_source_known", oneOf("source", sources)),
    check("api_usage_provider_known", oneOf("provider", providers)),
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

/** Where a cost test stands. The run and each of its probes use the same three words. */
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

/**
 * One credential, encrypted, for the day a key stops living in `.env`.
 *
 * US-004. Today every instance reads its keys from the environment, and an
 * environment variable needs no encryption: it is already outside the database
 * and outside git. This table is for the second instance, and for the hosted
 * version, where a key reaches a database somebody else takes backups of.
 *
 * The row is keyed by *provider*, not by platform. A key belongs to the
 * account it was issued for: one Bright Data key serves Reddit, X and
 * LinkedIn, and a table keyed by platform would hold three copies of it and
 * rotate three copies of it. US-024 re-keyed this table and moved the stored
 * Bright Data key from "reddit" to "brightdata" without anybody retyping it.
 *
 * Four things about the columns.
 *
 * `ciphertext` is the whole encrypted payload, `v1.<nonce>.<value>.<tag>`, as
 * `secrets/cipher.ts` writes it. The nonce is stored with the value because a
 * nonce is not a secret; reusing one is what breaks GCM, so each value carries
 * its own. The check constraint refuses anything that is not in that format,
 * which is what stops a plaintext key being pasted in by hand at 02:00 and
 * read back as though it had been encrypted.
 *
 * `hint` is the masked form — four trailing characters and nothing else — and
 * it exists so that showing a person which key is set never decrypts one. The
 * API reads this column and never `ciphertext`.
 *
 * `record` is the name the ciphertext was sealed with, and it is stored rather
 * than computed because computing it would have locked every existing key out.
 * The cipher authenticates the record name, so a row written as "reddit:apiKey"
 * cannot be opened as "brightdata:apiKey" — the re-key would have refused to
 * boot on the very instance that had a working key. A write always sets it to
 * the current name, so a row normalises itself the first time it is replaced or
 * rotated.
 *
 * There is no `updated_by` and no history. A credential is replaced, not
 * versioned: keeping the old ciphertext keeps the old key working after
 * somebody rotates away from it, which is the opposite of the point.
 */
export const sourceCredentials = pgTable(
  "source_credentials",
  {
    /** Whose account the key is on. Never the platform it is used to fetch. */
    provider: text("provider").$type<Provider>().notNull(),
    /** The provider's own field name: `apiKey`, `apiSecret`. */
    field: text("field").notNull(),
    ciphertext: text("ciphertext").notNull(),
    /** What the cipher authenticated. See the header: it is stored, not derived. */
    record: text("record").notNull(),
    /** `••••1234`. What a person is shown, stored so nothing has to decrypt to show it. */
    hint: text("hint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.field] }),
    check("source_credentials_provider_known", oneOf("provider", providers)),
    // A value that is not in the cipher's format was never encrypted by us.
    // The database refuses it rather than handing it to a connector as a key.
    check("source_credentials_ciphertext_format", sql.raw(`ciphertext LIKE 'v1.%.%.%'`)),
    // A hint that is longer than the mask is a hint that is leaking.
    check("source_credentials_hint_masked", sql.raw(`hint LIKE '••••%' AND length(hint) <= 8`)),
  ],
);

/**
 * Which provider fetches a platform, when more than one can.
 *
 * One row per platform, and a platform with nothing recorded has no row. That
 * is the common deployment: it holds one provider's key, so there is one
 * connector that can run and no question to ask. US-026 built this table for
 * the deployment that holds both, where answering from registration order
 * would spend money at a provider nobody picked.
 *
 * The choice is global, not per monitor. A person who wants Reddit through
 * Bright Data wants it for every monitor. A per-monitor override is one column
 * on `monitors` the day somebody asks for it.
 *
 * Nothing in flight reads this. A collection belongs to the provider that
 * started it, and `source_continuations` carries that provider, so changing a
 * row here takes effect on the next collection and never on the one already
 * running.
 */
export const sourceProviders = pgTable(
  "source_providers",
  {
    /** The platform. One row per platform, so this is the whole key. */
    source: text("source").$type<Source>().primaryKey(),
    /** Who fetches it. */
    provider: text("provider").$type<Provider>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check("source_providers_source_known", oneOf("source", sources)),
    check("source_providers_provider_known", oneOf("provider", providers)),
  ],
);

/** US-016. Settings begin with new matches; edits cancel pending deliveries. */
export const notificationSettings = pgTable(
  "notification_settings",
  {
    monitorId: uuid("monitor_id")
      .primaryKey()
      .references(() => monitors.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    emailTo: text("email_to").notNull().default(""),
    digestHours: integer("digest_hours").notNull().default(24),
    minScore: integer("min_score").notNull().default(50),
    immediateScore: integer("immediate_score"),
    webhookEnabled: boolean("webhook_enabled").notNull().default(false),
    webhookUrl: text("webhook_url").notNull().default(""),
    webhookMode: text("webhook_mode").$type<"match" | "digest">().notNull().default("digest"),
    webhookFailures: integer("webhook_failures").notNull().default(0),
    webhookError: text("webhook_error"),
    emailError: text("email_error"),
    enabledSince: timestamp("enabled_since", { withTimezone: true }).notNull().defaultNow(),
    nextDigestAt: timestamp("next_digest_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("notification_digest_hours_range", sql`${table.digestHours} BETWEEN 1 AND 168`),
    check("notification_min_score_range", sql`${table.minScore} BETWEEN 0 AND 100`),
    check("notification_immediate_score_range", sql`${table.immediateScore} BETWEEN 0 AND 100`),
    check("notification_webhook_mode_known", sql`${table.webhookMode} IN ('match', 'digest')`),
  ],
);

/** A durable outbox. Content is read at delivery time, never copied here. */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    channel: text("channel").$type<"email" | "webhook">().notNull(),
    kind: text("kind").$type<"match" | "digest">().notNull(),
    status: text("status")
      .$type<"pending" | "sent" | "failed" | "skipped">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    index("notification_deliveries_due_idx")
      .on(table.monitorId, table.nextAttemptAt)
      .where(sql`status = 'pending'`),
  ],
);

export const notificationItems = pgTable(
  "notification_items",
  {
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    channel: text("channel").$type<"email" | "webhook">().notNull(),
    kind: text("kind").$type<"match" | "digest">().notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.channel, table.kind] })],
);

/** Correctness-critical: a paid deletion check must resume at its original provider.
 * One row per post prevents repeated checks across monitors. No content is copied.
 */
export const postVerifications = pgTable(
  "post_verifications",
  {
    postId: uuid("post_id")
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    monitorId: uuid("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
    provider: text("provider").$type<Provider>().notNull(),
    cursor: text("cursor"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  },
  () => [check("post_verifications_provider_known", oneOf("provider", providers))],
);
