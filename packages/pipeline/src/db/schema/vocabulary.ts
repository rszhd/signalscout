/** The closed lists the pipeline's tables check against, and the SQL fragments that build those checks. A value added here is not a value the database accepts until the migration ships (AGENTS.md). */
import type { Provider, Source } from "@signalscout/engine";
import { sql } from "drizzle-orm";

/**
 * Why a thread stopped being read. US-048.
 *
 * Four answers and they lead to different actions. `threshold` means two
 * batches in a row held no lead, so this thread is probably not one to read —
 * a person who disagrees can say so. `ceiling` and `budget` mean money, not
 * judgement, and a thread stopped by either has more to read the moment there
 * is more to spend. `end` means the provider ran out of thread.
 */
export const repliesStoppedReasons = ["threshold", "ceiling", "budget", "end"] as const;

export type RepliesStoppedReason = (typeof repliesStoppedReasons)[number];

export const postKinds = ["post", "reply"] as const;

export type PostKind = (typeof postKinds)[number];

/** The two buttons on a match. PLAN.md, *Feedback loop*. */

export const verdicts = ["good", "not_relevant"] as const;

export type Verdict = (typeof verdicts)[number];

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
 * The stages of the pre-filter, in the order they run. US-008, then US-030.
 *
 * `triage` is a model call, unlike the two before it, and it is here rather
 * than in its own table for one reason: a drop is a drop. The monitor list
 * counts them, `filter_drops` already holds the post and the monitor, and a
 * second table would mean a second place to look before answering "what did
 * this monitor throw away". Its `similarity` is null, like the keyword
 * stage's, because nothing was measured — a model was asked.
 */
export const filterStages = ["keyword", "embedding", "triage"] as const;

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
 *
 * US-030 added the fourth. Triage is the same kind of call as a classification
 * and often the same model, so nothing but this column can tell them apart. A
 * bill that could not would report the cheap stage's calls as the expensive
 * stage's, and the one number this ticket exists to prove — what triage saved —
 * could not be read at all.
 */
export const modelCallPurposes = [
  "classification",
  "query_generation",
  "embedding",
  "triage",
  /**
   * Drafting a project's four answers from a document. US-050.
   *
   * Its own purpose because it is the first call with no monitor behind it:
   * `monitor_id` is null, no budget is keyed to it, and `docs/costs.md`'s
   * answer to "what did my key pay for" would be wrong without a name for it.
   */
  "project_analysis",
  /**
   * Drafting a reply to one match. US-040.
   *
   * Its own purpose because a person asking "what did my key pay for" must be
   * able to tell a draft from a classification: a draft is one call a person
   * chose to make, where a classification is one the poll made for them.
   */
  "draft_reply",
  /**
   * One call somebody made by pressing Test on the Models screen. US-080.
   *
   * Its own purpose for `draft_reply`'s reason and one more: a person reading
   * "what did my key pay for" must be able to tell a test they ran from work
   * the product did, and a budget page that counted tests as classifications
   * would report a monitor reading posts it never read.
   */
  "key_test",
] as const;

export type ModelCallPurpose = (typeof modelCallPurposes)[number];

/**
 * What a poll did, in one word. US-104.
 *
 * Read as a person reads it: `collected` is the only one that put something in
 * front of them. `empty` is the answer the production run needed and did not
 * have — the poll ran, it may have spent money, and it holds nothing. It is
 * separate from `refused`, where nothing was asked of any provider at all,
 * because the two send a person to different places: `empty` asks about the
 * queries, `refused` about a key, a cap or a choice.
 */
export const pollOutcomes = [
  /** At least one post came back. Whether any of it was new is `posts_new`. */
  "collected",
  /** Every source was asked and none returned a post. */
  "empty",
  /** Nothing was asked. A cap, a missing key or an unmade choice stopped it first. */
  "refused",
  /** A collection is still running at the provider. This poll is one step of a walk. */
  "waiting",
  /** The step threw. The job will be retried; this row is what the retry cannot say. */
  "failed",
] as const;

export type PollOutcome = (typeof pollOutcomes)[number];

/**
 * Why a poll, or one of its sources, stopped. A closed set on purpose.
 *
 * This is the field a person reads first when an inbox is empty, so it must be
 * countable, translatable and assertable. A sentence written at the call site
 * is none of those, and it is also where a provider's own error text — which
 * `logger.ts` redacts and a screen does not — would reach a page.
 */
export const pollStopReasons = [
  /** US-013's cap refused the poll before any provider was asked. */
  "budget_exhausted",
  /** No provider of this platform has a key on this account or in the environment. */
  "no_credentials",
  /** Two providers could run and no choice is recorded, or the choice cannot run. */
  "no_provider_choice",
  /** US-053: this build does not offer a connector for the platform any more. */
  "not_offered",
  /** A collection is in flight and the key that started it is gone. */
  "resume_key_missing",
  /** A collection was never ready to read, and `maxResumeAttempts` gave up on it. */
  "collection_abandoned",
  /** The provider asked us to come back later. Usually a rate limit. */
  "provider_wait",
  /** `maxPagesPerPoll` stopped a source that had another page ready now. */
  "page_cap",
  /** A collection at the provider is not ready, and it is not yet time to look. */
  "still_collecting",
  /** The step threw. */
  "error",
] as const;

export type PollStopReason = (typeof pollStopReasons)[number];

/**
 * What one platform did inside one poll.
 *
 * Its own reason, because a poll may skip Reddit for want of a key and collect
 * X in the same run. A poll-level reason alone would report the whole poll as
 * refused, which is the kind of half-truth this table exists to stop.
 */
export interface PollRunSource {
  readonly source: Source;
  /** Null where the poll never got as far as choosing one. */
  readonly provider: Provider | null;
  readonly pages: number;
  readonly postsReturned: number;
  readonly postsNew: number;
  readonly units: number;
  readonly estimatedCostMicros: number;
  readonly reason: PollStopReason | null;
}

/** SQL fragment for a score column that must read 0 to 100. */

export function scoreRange(column: string) {
  return sql.raw(`${column} BETWEEN 0 AND 100`);
}

/** SQL fragment for a text column restricted to a fixed list. */

export function oneOf(column: string, values: readonly string[]) {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/** The same, for a nullable column, where null means "we cannot say". */

export function optionallyOneOf(column: string, values: readonly string[]) {
  return sql.raw(
    `${column} IS NULL OR ${column} IN (${values.map((value) => `'${value}'`).join(", ")})`,
  );
}

/**
 * A monitor holds the user's four answers exactly as they typed them, and the
 * generated queries beside them. They are separate columns on purpose: a query
 * is regenerated when the prompt improves, and nobody retypes an answer.
 */
