/** What a poll brought back: `posts`, the continuations a collection resumes from, where each post was discovered, and its deletion checks. */
import {
  embeddingDimensions,
  type Provider,
  providers,
  type Source,
  sources,
} from "@signalscout/engine";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors.js";
import {
  oneOf,
  optionallyOneOf,
  type PostKind,
  postKinds,
  repliesStoppedReasons,
} from "./vocabulary.js";

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
    /**
     * The words of the post, reduced to a fingerprint. US-400.
     *
     * Computed by Postgres, so no second implementation can disagree with it:
     * the title and the excerpt, lower case, with every run of whitespace
     * made one space. Two posts with the same author and the same fingerprint
     * are one post written twice — the same question put to two subreddits —
     * and the classify step scores only the first. An edited copy has another
     * fingerprint, on purpose: a false merge hides a lead, and a missed one
     * costs a card.
     */
    textFingerprint: text("text_fingerprint").generatedAlwaysAs(
      sql`md5(btrim(regexp_replace(lower(coalesce(title, '') || ' ' || excerpt), '[[:space:]]+', ' ', 'g')))`,
    ),
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
    /**
     * Whether this row is a post or a reply underneath one. US-020.
     *
     * A reply is stored here rather than in its own table because it is the
     * same thing to everything downstream: it is classified, matched,
     * de-duplicated, deleted and shown by the same code. Reddit's `t1_`
     * fullname and an X reply id key it exactly as a post id does, so
     * `UNIQUE (source, external_id)` needed no change at all.
     */
    kind: text("kind").$type<PostKind>().notNull().default("post"),
    /**
     * The post this reply hangs under. Null on a post.
     *
     * A reply is unreadable without it — "same here, what did you switch to?"
     * names no product and no problem — so the classifier is given the parent's
     * title and the inbox shows it above the reply. The cascade is deliberate:
     * deleting a post takes its replies, because a reply whose thread is gone
     * cannot be judged by anybody.
     */
    parentPostId: uuid("parent_post_id").references((): AnyPgColumn => posts.id, {
      onDelete: "cascade",
    }),
    /**
     * The reply directly above this one, by its platform id. Null at the top.
     *
     * Stored as the platform's own id rather than as a row reference, because
     * a page of replies arrives with parents that may not be stored yet and a
     * foreign key would make the insert order matter. It is context for the
     * prompt, not a join anything depends on.
     */
    parentReplyExternalId: text("parent_reply_external_id"),
    /**
     * How many replies the platform said this post had, when it was collected.
     *
     * This is the whole re-open rule. A thread is bought again only when this
     * number has grown, so a monitor polling hourly does not re-buy every
     * thread it has ever seen for the life of the monitor. Null means the
     * platform did not say, which is not zero.
     */
    replyCount: integer("reply_count"),
    /**
     * Whether the thread under this post is known to be incompletely read.
     *
     * Null on a post nobody asked for replies on. True is the normal state
     * after one page: both providers report a top-level "no more" while nested
     * subtrees still hold replies, so this is our own honesty and not theirs.
     * False may be written only from positive evidence that the thread ended.
     */
    repliesPartial: boolean("replies_partial"),
    /**
     * When this thread was last read, which is the window the next read uses.
     *
     * BUG-006. The window belonged to the monitor before this column existed,
     * and `monitors.last_polled_at` is set by the collect step of the same
     * poll — so the replies step that ran four minutes later asked every
     * provider for comments written after the poll had already started, and
     * every comment ever written was older than that. A live TikTok run bought
     * twenty-five threads and stored nothing.
     *
     * A thread is not a poll. It outlives the post above it and we may meet it
     * for the first time on any poll, so the mark that says how much of it we
     * have read has to sit on the post. Null means never read, and the default
     * window applies.
     */
    repliesReadAt: timestamp("replies_read_at", { withTimezone: true }),
    /**
     * Where the provider put this reply in its thread, counting from zero.
     *
     * US-048. Null on a post, and on a reply stored before this column
     * existed. The provider's own order, counting every item it returned
     * including the ones the connector dropped — so positions have gaps, and a
     * gap says something was refused there rather than that the numbering is
     * broken.
     *
     * It is kept to answer one question that cannot be asked afterwards
     * without buying a thread twice: **do this product's leads sit where the
     * platform ranks highest?** A platform ranks for engagement, and a person
     * asking a question collects no likes. If leads spread evenly, reading a
     * deep thread in batches can stop early on a poor batch. If they sit at
     * the bottom, stopping early throws away the best part.
     */
    threadPosition: integer("thread_position"),
    /**
     * Where to resume reading this thread, and what happened last time.
     *
     * US-048. A thread is read in batches of `replyBatchSize`, and the
     * decision to buy the next batch is made after the last one has been
     * classified — so the walk outlives a single job and its place has to be
     * written down.
     *
     * `repliesCursor` is the provider's own cursor, opaque and only meaningful
     * to the connector that issued it. `repliesBatchStart` is the position the
     * current batch began at, which is how the threshold knows which comments
     * to count. `repliesEmptyBatches` counts *consecutive* batches that
     * produced no match, and reading ends at two — one empty batch is a dead
     * patch, two is a dead thread. `repliesStopped` records why reading ended,
     * so a person asking "why did it stop" gets an answer rather than a guess.
     */
    repliesCursor: text("replies_cursor"),
    repliesBatchStart: integer("replies_batch_start"),
    repliesEmptyBatches: smallint("replies_empty_batches").notNull().default(0),
    repliesStopped: text("replies_stopped"),
    /**
     * The platform's comment count when reading stopped.
     *
     * What lets a closed thread open again. Without it `repliesStopped` is a
     * life sentence: a thread abandoned on two empty batches would never be
     * read again however many comments arrived afterwards, which is exactly
     * the case a monitor exists to catch.
     */
    repliesStoppedAtCount: integer("replies_stopped_at_count"),
    /**
     * The position up to which the threshold has already judged this thread.
     *
     * Reading and judging happen in different jobs, and this is the seam. A
     * batch is bought, and only after the classifier has finished can anyone
     * say whether it held a lead — so the judgement is made at the start of
     * the *next* job, over the range this mark and `repliesBatchStart` bound.
     *
     * Without it there is no way to name the batch being judged. The first
     * version of US-048 counted matches from `repliesBatchStart` after
     * reading, which is the batch that had just been bought and not yet
     * scored: it always counted zero, so every thread died after three batches
     * however good it was.
     */
    repliesJudgedTo: integer("replies_judged_to").notNull().default(0),
  },
  (table) => [
    unique("posts_source_external_id_unique").on(table.source, table.externalId),
    check("posts_source_known", oneOf("source", sources)),
    check("posts_provider_known", optionallyOneOf("provider", providers)),
    check("posts_kind_known", oneOf("kind", postKinds)),
    check("posts_replies_stopped_known", optionallyOneOf("replies_stopped", repliesStoppedReasons)),
    // A reply has a parent and a post does not. Without this the two columns
    // drift apart and a reply with no thread reaches the classifier as if it
    // were a post, which is the one thing US-020 exists to prevent.
    check(
      "posts_reply_has_parent",
      sql.raw(
        "(kind = 'post' AND parent_post_id IS NULL) OR (kind = 'reply' AND parent_post_id IS NOT NULL)",
      ),
    ),
    index("posts_parent_idx").on(table.parentPostId),
    // The question the classify step asks before it pays: has this author
    // posted these words already. US-400.
    index("posts_author_fingerprint_idx").on(table.source, table.author, table.textFingerprint),
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
    /** The search this walk belongs to, as `source_coverage.query`. US-289. */
    query: text("query").notNull().default(""),
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
      table.query,
    ),
    check("source_continuations_source_known", oneOf("source", sources)),
    check("source_continuations_provider_known", oneOf("provider", providers)),
    check("source_continuations_attempts_bounded", sql.raw(`attempts >= 0`)),
  ],
);

/**
 * How a post was found: a phrase the monitor searches, or a channel it
 * browses. US-212.
 */
export const discoveryKinds = ["query", "channel"] as const;

export type DiscoveryKind = (typeof discoveryKinds)[number];

/**
 * Which of a monitor's inputs found which post. US-212.
 *
 * A monitor searches several phrases across several channels and nothing could
 * say which of them earns anything. A phrase that has never produced a match
 * is searched on every poll, on every channel, for ever, and the only way to
 * find it was to delete one and watch what happened.
 *
 * **It cannot live on `posts`.** That table is keyed by `(source,
 * external_id)` with no monitor column, because one row serves every monitor
 * that found it — and a query belongs to one monitor. So this is the join the
 * post cannot hold.
 *
 * **It cannot be worked out afterwards.** A provider's search is not a
 * substring match, so checking whether a phrase's words appear in a post is a
 * guess. The connector knows at the moment the page comes back and nothing
 * else ever does.
 *
 * **One post can have several rows**, and that is the truth rather than a
 * shortcoming: a post returned by two phrases was earned by both, and a poll
 * that deduplicated it into one row still paid for both searches.
 */
export const postDiscoveries = pgTable(
  "post_discoveries",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    /** The platform it came from, so a read can group without joining `posts`. */
    source: text("source").$type<Source>().notNull(),
    kind: text("kind").$type<DiscoveryKind>().notNull(),
    /**
     * The phrase or the channel, as the monitor holds it.
     *
     * Not the string the connector sent: X adds `from:` and `since:` operators,
     * and a screen showing those back to a person who typed two words would be
     * showing them this connector's syntax.
     */
    value: text("value").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per monitor, post and input. A second poll finding the same post
    // through the same phrase writes nothing.
    primaryKey({ columns: [table.monitorId, table.postId, table.kind, table.value] }),
    // The screen's own query: this monitor's inputs, ranked by what they found.
    index("post_discoveries_monitor_value_idx").on(table.monitorId, table.kind, table.value),
    index("post_discoveries_post_idx").on(table.postId),
    check("post_discoveries_kind_known", oneOf("kind", discoveryKinds)),
  ],
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
