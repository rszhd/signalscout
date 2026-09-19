/** What was spent and what was dropped: `model_calls`, `filter_drops`, `api_usage`, `source_coverage`, `budgets`. */
import { type Provider, providers, type Source, sources } from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors.js";
import { posts } from "./posts.js";
import {
  type FilterStage,
  filterStages,
  type ModelCallOutcome,
  type ModelCallPurpose,
  modelCallOutcomes,
  modelCallPurposes,
  oneOf,
} from "./vocabulary.js";

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
 * BUG-003 added a fourth: this table is the record of what has been scored. A
 * poll hands the classifier every post it saw, so the step needs to know which
 * of them it has already paid for, and a post scored below the threshold
 * leaves no other trace.
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
    /**
     * Whose bill this call lands on. US-162.
     *
     * Not derived from the monitor: a draft, a query generation and a key
     * test are written with no monitor, and those are exactly the calls a
     * plan counts per account. Nullable only for the rows written before the
     * column existed and having no monitor to be backfilled from; every
     * insert since carries it, and `accountSpend` counts nothing it cannot
     * attribute.
     */
    userId: text("user_id"),
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
    /**
     * `monitors.version` when the call was made. Never updated afterwards.
     *
     * The classifier skips a post it has already scored, and BUG-003 is what
     * happens when that skip reads the wrong table: a post scored below the
     * threshold writes no match, so a skip keyed on `matches` bought the same
     * answer again on every poll. The skip reads this column instead.
     *
     * It has to be the version and not only the pair. The version counts edits
     * to the four fields the system prompt is built from, so a post scored
     * under version 1 has not been asked version 2's question. A skip that
     * ignored the version would freeze a monitor's old answers in place after
     * its owner rewrote what it looks for.
     *
     * Null for a call that no version describes: query generation runs before
     * the monitor exists. A classification always has one, and the check makes
     * a writer that forgets it fail loudly rather than pay twice in silence.
     */
    monitorVersion: integer("monitor_version"),
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
    /** `accountSpend` reads a month of one account. US-162. */
    index("model_calls_user_created_idx").on(table.userId, table.createdAt),
    check("model_calls_outcome_known", oneOf("outcome", modelCallOutcomes)),
    check("model_calls_purpose_known", oneOf("purpose", modelCallPurposes)),
    check(
      "model_calls_classification_versioned",
      sql.raw("purpose <> 'classification' OR monitor_version IS NOT NULL"),
    ),
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
 * The unit is the connector's own — Bright Data bills a Reddit record, and
 * ScrapeCreators and SocialCrawl each bill the request — so `units` is
 * comparable only within one platform and provider together. `ConnectorDescriptor.billableUnit` is the word for it, and the cost
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
    /**
     * Which account on this instance the money is spent by. BUG-009.
     *
     * Its own column rather than a read through `monitor_id`, for the reason
     * the comment above gives: that one is null for a cost test, which is real
     * money bought before a monitor exists. Without this, a cost test's spend
     * belongs to nobody and appears on everybody's page.
     *
     * It is functionally determined by `monitor_id` when there is one, so
     * adding it to the unique key below changes no grouping.
     */
    userId: text("user_id").notNull(),
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
    // The owner is in the key, and BUG-009 put it there. `nullsNotDistinct`
    // above makes the rows with no monitor — the cost tests — dedupe on the
    // rest of the key, so without the owner two accounts testing the same pair
    // on the same day would add their money into one row.
    unique("api_usage_monitor_source_day_unique")
      .on(table.userId, table.monitorId, table.source, table.provider, table.day)
      .nullsNotDistinct(),
    index("api_usage_monitor_day_idx").on(table.monitorId, table.day),
    check("api_usage_source_known", oneOf("source", sources)),
    check("api_usage_provider_known", oneOf("provider", providers)),
    check("api_usage_units_non_negative", sql.raw(`units >= 0`)),
    check("api_usage_cost_non_negative", sql.raw(`estimated_cost_micros >= 0`)),
  ],
);

/**
 * How far forward this monitor's collection reaches, per platform. BUG-017.
 *
 * `monitors.last_polled_at` used to answer this as well as "when did a job
 * last run", and the two are not the same question. That mark moves at the
 * start of every poll, including the resumes of a walk that is still paging —
 * so when one walk ended and the next began, the new one was handed a window
 * as narrow as the gap between two polls, and then paid for forty searches
 * that returned nothing.
 *
 * A row is written when a **walk** finishes, and it holds the moment that walk
 * *started* rather than the moment it ended. A walk collects everything from
 * its own window up to its start; posts written while it was paging may or may
 * not have been caught, and the earlier mark is the one that cannot lose them.
 * Being too wide costs money and loses nothing, because `posts` deduplicates.
 * Being too narrow loses posts silently, which is the failure this replaces.
 *
 * Per platform, because platforms finish at different times: an X search is
 * one page and a Reddit walk is forty inputs over eight polls.
 */
export const sourceCoverage = pgTable(
  "source_coverage",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    source: text("source").$type<Source>().notNull(),
    /** The start of the last walk that finished. Never the end of one. */
    coveredThrough: timestamp("covered_through", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.source] }),
    check("source_coverage_source_known", oneOf("source", sources)),
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
