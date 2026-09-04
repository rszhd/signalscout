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
  boolean,
  check,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      "monitors_poll_interval_floor",
      sql.raw(`poll_interval_seconds >= ${minimumPollIntervalSeconds}`),
    ),
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
