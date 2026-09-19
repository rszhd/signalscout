/** A business and its monitors: `projects`, `reply_prompts`, `monitors`. */
import {
  defaultMinimumScore,
  defaultSimilarityThreshold,
  embeddingDimensions,
  type Source,
} from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import {
  defaultPollIntervalSeconds,
  minimumPollIntervalSeconds,
  scoreRange,
} from "./vocabulary.js";

/**
 * A business, so its answers are typed once rather than once per monitor.
 *
 * US-045. The product, the ideal customer, the problem and the signals
 * describe a *business*; the queries, platforms, schedule and budget describe
 * a *search*. A person with three monitors was typing the first four three
 * times, and typing them slightly differently each time — which
 * `monitors.version` faithfully recorded as an edit, leaving two monitors
 * judged against two descriptions of the same business.
 *
 * **A monitor takes a copy of these, and is not bound to them.** That was
 * decided rather than discovered, and the reason is `monitors.version`: US-012
 * records every verdict against the version that earned it, so a project the
 * monitors *followed* would re-version all of them on one edit and discard the
 * comparability of every verdict already given. Editing a project changes what
 * the next monitor starts from and nothing that already exists. The screen has
 * to say so.
 *
 * It is a name and four answers. Not a workspace, not members, not stages —
 * PLAN.md's NOT list has *CRM platform* on it and this is how that starts.
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Text and no foreign key, for the reason `monitors.user_id` gives. */
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  /** The same four the classifier reads. `ai/prompt.ts` owns the list. */
  product: text("product").notNull(),
  idealCustomer: text("ideal_customer").notNull(),
  problem: text("problem").notNull(),
  signals: text("signals").array().notNull().default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The reply instructions a person has saved. US-040.
 *
 * **Owned by the account, not by a project.** The owner asked for it that way
 * and the reason is reuse: a voice is how *this person* writes, so the same
 * instruction serves every project they run. A copy per project would be the
 * same words typed twice and drifting apart from the moment one is edited.
 *
 * Several rather than one, because a person replies differently in different
 * rooms — short and technical under a subreddit question, longer under a
 * LinkedIn post — and the choice belongs at the moment of drafting rather than
 * in a setting somewhere.
 *
 * Nothing here outranks `ai/reply.ts`'s rules. An instruction is appended as
 * the person's preference, and the prompt says which of its rules a preference
 * may not override — "always open by naming our product" is the thing that
 * prompt exists to prevent.
 */
export const replyPrompts = pgTable(
  "reply_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Text and no foreign key, for the reason `monitors.user_id` gives. */
    userId: text("user_id").notNull(),
    /** What the person calls it, so a list of several is choosable. */
    name: text("name").notNull(),
    instruction: text("instruction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A blank name is unchoosable and a blank instruction is not an
    // instruction. Both are refused in the database rather than only in a
    // route, because a route is one of the ways a row arrives.
    check("reply_prompts_name_not_blank", sql`length(btrim(${table.name})) > 0`),
    check("reply_prompts_instruction_not_blank", sql`length(btrim(${table.instruction})) > 0`),
    // Two prompts called the same thing are a person choosing blind. Compared
    // case-insensitively, because "Short" and "short" read as one name.
    uniqueIndex("reply_prompts_user_name_unique").on(table.userId, sql`lower(${table.name})`),
  ],
);

export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Better Auth owns the user table and creates it in US-017, so this carries
     * no foreign key yet. Text, because Better Auth ids are text.
     */
    userId: text("user_id").notNull(),
    /**
     * The project this monitor was created from, for grouping. US-045.
     *
     * Null is the normal state: every monitor that existed before projects has
     * none, and a monitor may be made without one. It records where the four
     * answers below came from — they are a copy, so this is provenance and
     * grouping rather than a link the monitor reads at poll time.
     *
     * `set null` on delete: removing a project must not remove the monitors
     * that came out of it, and their answers are their own.
     */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
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
     * Whether this monitor reads the replies underneath the posts it finds.
     *
     * Off by default, and off for every monitor that existed before US-020,
     * because it is the expensive direction. The fetch is small — one credit
     * buys a page of about 25 Reddit comments — but the model calls are not: a
     * subreddit poll of 23 posts holds about 280 replies, so turning this on
     * multiplies the classifier's work by roughly twelve.
     *
     * It is one switch across every platform rather than one per platform. A
     * person's question is "do I want the conversation as well as the posts",
     * and it does not change per network. Which of their platforms can answer
     * is a fact about the connectors, and the form reads that from
     * `canFetchReplies` rather than asking again here.
     */
    includeReplies: boolean("include_replies").notNull().default(false),
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
    /**
     * Which days of the week this monitor may poll on. US-041.
     *
     * Postgres numbering, so 0 is Sunday and 6 is Saturday, because the check
     * is `extract(dow ...)` and a second numbering would be a translation
     * somebody eventually gets wrong by one.
     *
     * Every day by default, which is what every monitor did before this column
     * existed. It is a filter on the interval rather than a replacement for it:
     * a monitor polls every `poll_interval_seconds`, but only on these days.
     * That covers hourly, daily, weekly, weekdays and weekends without a cron
     * parser, and a cron parser is a support burden somebody gets wrong
     * silently and expensively.
     *
     * **Why days at all, when an interval is simpler.** A B2B monitor polled on
     * Saturday buys the weekend at full price and finds the weekend's
     * conversation, which is mostly not work. Five days of seven is about 71%
     * of the spend for close to all of the value, and nothing in this product
     * could express that.
     */
    pollDays: smallint("poll_days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'`),
    /**
     * The timezone the days above are counted in. US-041.
     *
     * A person choosing "weekdays" means their weekdays. The database stores
     * UTC, so without this the choice is wrong for most of the world — a
     * monitor in Kuala Lumpur would start its Monday at 8am on Sunday.
     *
     * An IANA name, validated where it is written rather than here: Postgres
     * throws on an unknown zone, and `now() AT TIME ZONE` is inside the
     * scheduler's one query, so a bad row would stop every monitor rather than
     * one. The API refuses a name `Intl` does not know.
     */
    pollTimezone: text("poll_timezone").notNull().default("UTC"),
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
    /**
     * A day is 0 to 6, and there is at least one.
     *
     * The floor matters more than the range. An empty array is a monitor that
     * can never poll, which reads as "broken" and not as "off" — a person who
     * wants that presses pause, and pause says so on the screen.
     */
    check(
      "monitors_poll_days_valid",
      sql.raw("cardinality(poll_days) > 0 AND poll_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]"),
    ),
    // Cosine similarity between two embeddings of real text is never above 1,
    // and a negative threshold would keep everything while reading as a
    // setting somebody had chosen.
    check("monitors_similarity_threshold_range", sql.raw("similarity_threshold BETWEEN 0 AND 1")),
  ],
);
