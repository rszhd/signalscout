/**
 * The product's vocabulary: the values a platform, a provider, a signal and an
 * intent may take, and the two defaults the classifier and the pre-filter
 * apply when a monitor has not said otherwise.
 *
 * These lived in `db/schema.ts`, where each array is also a check constraint.
 * US-152 moved them here because the engine needs them and must not import
 * the schema; the schema imports them back and builds its constraints from
 * them, so the direction is pipeline → engine and the constraint still follows
 * the array. AGENTS.md's rule holds one step further out: a value added to an
 * array here is not a value the database accepts until the migration in
 * `packages/pipeline` says so.
 */

/**
 * The platforms PLAN.md builds first. A third one is a migration, not a guess.
 *
 * This is the platform axis: what a person ticks, what `posts.source` stores,
 * and what deduplication is keyed by. The same Reddit post fetched through two
 * providers is one post and one row here. US-024 separated the axes;
 * `sources/types.ts` says why.
 */
export const sources = ["reddit", "x", "linkedin", "youtube", "tiktok", "instagram"] as const;
export type Source = (typeof sources)[number];

/**
 * The providers a key can belong to. A fourth one is a migration, not a guess.
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
 *
 * US-006 added `socialcrawl` with its connector, for X. It is the first
 * provider here that fetches a platform the others cannot: Bright Data
 * discovers X posts only by profile, and ScrapeCreators has no X search at
 * all, so neither can find a stranger describing a problem.
 *
 * US-061 added `socialdata`, the second provider that can search X — and the
 * first competition the platform has had since US-006, which found that two of
 * the three providers asked could not search it at all.
 *
 * US-057 added `apify`, and it is the first that is a marketplace rather than
 * a data API: what we call is an actor somebody else publishes, so the thing
 * that can change under us is not the provider's API but the actor's output.
 * The connector shipped before this value existed, which is a mistake worth
 * naming — `assertSourcesCanBeStored` checks platforms and nothing checks
 * providers, so a connector can be registered, tested and unable to store a
 * single row. The live poll is what found it.
 */
export const providers = [
  "brightdata",
  "scrapecreators",
  "socialcrawl",
  "apify",
  "socialdata",
] as const;
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
 * The lowest lead score that becomes a match, for a monitor that has not said
 * otherwise.
 *
 * Deliberately permissive. docs/testing.md, *A measured constant needs a
 * committed instrument*: a threshold set too high discards good leads before
 * anyone sees them, and a silent false negative is worse than a noisy inbox
 * because nobody can tell it happened. The instrument that produced this
 * number is `ai/fixtures/capture.ts`, which scores PLAN.md's four worked
 * examples and prints the totals; re-run it before moving this.
 *
 * **50 was tried and put back, US-223.** The hosted instance had 26 of 40
 * monitors set to 50 by hand, which is a default most people overrode, and the
 * measurements on 2026-09-18 supported the higher bar. It was reverted anyway:
 * moving it alters the column default, so every consumer takes a migration for
 * a number each monitor can already set for itself. The real gap is that no
 * screen shows a monitor its own threshold, and a default is the wrong place
 * to fix a missing control.
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

/**
 * The three jobs this product asks a model to do, as a person picks them.
 *
 * The same three the environment already names — `AI_*`, `AI_TRIAGE_*` and
 * `AI_EMBEDDING_*` — because the whole design of US-068 is that a stored row
 * is an *override of the environment*, layered over it and then read by the
 * same three functions in `ai/config.ts`. Those functions carry rules that took
 * measurements to get right (triage falls back to the classifier's settings but
 * not to its price; a key is reused only within one provider), and none of them
 * is rewritten here.
 *
 * `draft` is the fourth and US-070 added it. Scoring wants a model that reads
 * carefully and answers in numbers; drafting wants one that writes like a
 * person, and on some providers those are different models. It is also the only
 * model output that carries somebody's name into another person's conversation,
 * which is why it is the one of the API's three calls worth choosing.
 *
 * `plan` is the fifth and US-269 added it. Writing a monitor's search plan
 * happens once when the monitor is made and again when somebody regenerates
 * it, and what it produces decides every post the monitor will ever collect.
 * A weak plan is a month of polling for the wrong conversations, and the
 * call is rare enough that a model twenty times the classifier's price costs
 * cents. Unset, it is the classifier's, so no instance changes on the upgrade.
 *
 * Project describing stays on the classifier's settings: it produces four
 * answers for a person to edit before anything is spent on them.
 */
export const aiTasks = ["classify", "triage", "embed", "draft", "plan"] as const;
export type AiTask = (typeof aiTasks)[number];
