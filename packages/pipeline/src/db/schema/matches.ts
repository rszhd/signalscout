/** What the classifier kept, and what a person said about it: `matches`, `feedback`. */
import { type IntentType, intentTypes } from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors.js";
import { posts } from "./posts.js";
import { oneOf, scoreRange, type Verdict, verdicts } from "./vocabulary.js";

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
    /**
     * When somebody kept this match, or null. US-043.
     *
     * A timestamp rather than the boolean this replaced, and the reason is the
     * ordering. A saved list is worked through rather than read, so it is
     * ordered by when things were put on it — the inbox's rank subtracts twelve
     * points a day, and something kept on purpose does not get less kept
     * overnight. A boolean cannot say when.
     *
     * The boolean it replaced was added for a screen nobody built and was false
     * on every row in every database, so nothing was lost in the migration.
     *
     * **This is not a verdict.** `feedback` holds a judgement about the model,
     * against the monitor version that earned it. This holds an intention, and
     * it survives a re-classification untouched, because the person's intention
     * is theirs.
     */
    savedAt: timestamp("saved_at", { withTimezone: true }),
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
