/**
 * The search queries a monitor runs, written by the model from the four
 * answers.
 *
 * PLAN.md's reason for this is usability: nobody should have to become a
 * Boolean-search expert. US-010's reason is money, and it is the stronger one.
 * A loose query pulls posts the filter then discards, and on X every one of
 * those posts was paid for before our code saw the text. Query quality is
 * where a user's bill is decided, which is why the queries are shown and
 * editable rather than hidden.
 *
 * Two rules in the schema below are that cost lever, not tidiness:
 *
 * 1. **A query is plain words.** Bright Data's keyword discovery matches the
 *    string it is given. A query carrying `AND`, a quote or `subreddit:` is
 *    searched literally, finds nothing, and looks exactly like a quiet week.
 * 2. **Queries must differ.** Three rewordings of one phrase collect the same
 *    posts three times, and each collection is billed.
 *
 * What this file cannot promise: that a proposed subreddit exists. The model
 * writes names from memory, and a name that is wrong collects nothing. The
 * form shows every proposal and lets a person delete one, which is the only
 * check we have until a poll runs.
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { describeSignals } from "../monitors/signals.js";
import type { PlatformDescriptor, PlatformSearchStyle } from "../sources/types.js";
import { generateStructured, type ModelCall } from "./call.js";
import type { AiConfig, AiProvider } from "./config.js";
import type { MonitorProfile } from "./prompt.js";
import { createModel } from "./provider.js";

/**
 * How many queries a plan holds.
 *
 * Three is the floor because one query is a keyword alert, which is the
 * product PLAN.md says we are not building. Eight is the ceiling because every
 * query is a separate collection on every poll, so the ceiling is a bill as
 * much as it is a limit.
 */
export const minimumQueries = 3;
export const maximumQueries = 8;

/** Reddit allows one subreddit per collection input, so this is a bill too. */
export const maximumSubreddits = 8;

/** A single word is not a query; it is a category, and it collects the internet. */
const minimumQueryWords = 2;
const longestQuery = 80;

/**
 * The ceiling for a platform that declares none.
 *
 * Eight was the only rule until US-027, and it was written for Reddit without
 * anybody saying so. It stays as the default because a longer phrase is safe
 * where posts are long, and a platform where it is not says so itself.
 */
const defaultMaxQueryWords = 8;

function wordsIn(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/**
 * Syntax the search does not understand.
 *
 * Upper-case `AND`, `OR` and `NOT` only: "how to test signup and checkout" is
 * a sentence a person would type, and refusing it would refuse half the good
 * queries. The field operators are refused whatever their case, because
 * `subreddit:saas` is never a phrase somebody writes by accident.
 */
const booleanSyntax = /\b(?:AND|OR|NOT)\b|[()"|*~]|(?:^|\s)[-+]\S|\b[a-z_]+:\S/;

/**
 * One query, as the schema will accept it.
 *
 * Exported because a person edits these before the monitor starts, and an
 * edited query costs exactly what a generated one costs. A rule the model must
 * obey and a person may bypass is not a rule; it is a suggestion with a test.
 */
export const searchQuerySchema = z
  .string()
  .trim()
  .max(longestQuery)
  .refine((value) => wordsIn(value) >= minimumQueryWords, {
    message: "a query is at least two words; one word collects the whole site",
  })
  .refine((value) => !booleanSyntax.test(value), {
    message:
      "a query is plain words: no AND, OR, NOT, quotes, brackets or field operators. " +
      "The search matches the string literally, so this one would find nothing.",
  });

/**
 * The same rule, plus the ceiling the platform sets.
 *
 * A query is written for somewhere. US-006 measured what happens when it is
 * not: `end to end tests keep breaking` returned unrelated posts on X
 * unquoted and nothing at all quoted, while two words returned twenty posts
 * that were all on topic. So the length rule belongs to the platform, and a
 * person editing a query is held to the same one as the model — a rule the
 * model must obey and a person may bypass is a suggestion with a test.
 */
export function searchQuerySchemaFor(style: PlatformSearchStyle | undefined) {
  const ceiling = style?.maxQueryWords ?? defaultMaxQueryWords;

  return searchQuerySchema.refine((value) => wordsIn(value) <= ceiling, {
    message:
      `a query here is at most ${ceiling} words: a longer phrase has to appear ` +
      "inside a post to match one, and on a short platform it never does",
  });
}

/**
 * A subreddit name, however the model wrote it.
 *
 * The connector builds `https://www.reddit.com/r/<name>/`, so it needs the
 * bare name. A model asked for bare names still writes `r/SaaS` some of the
 * time, and rejecting a whole plan over a prefix would cost a user a second
 * model call to be told the same three names again.
 */
export const subredditSchema = z
  .string()
  .trim()
  .transform((value) =>
    value
      .replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com/i, "")
      .replace(/^\/?r\//i, "")
      .replace(/\/+$/, ""),
  )
  .pipe(
    z
      .string()
      .regex(
        /^[A-Za-z0-9_]{3,21}$/,
        "a subreddit name is 3 to 21 letters, digits or underscores, with no r/ prefix",
      ),
  );

function allDifferent(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

/** One platform's list, held to that platform's own rule. */
export function queryListSchemaFor(platform: PlatformDescriptor) {
  return z
    .array(searchQuerySchemaFor(platform.search))
    .min(minimumQueries)
    .max(maximumQueries)
    .refine(allDifferent, { message: "each query must be a different way in, not a rewording" })
    .describe(`Search phrases a person with this problem would type on ${platform.displayName}`);
}

/**
 * The plan the model returns: one list per platform the monitor watches, and
 * the subreddits.
 *
 * The schema is built for the platforms asked about rather than fixed, so a
 * monitor watching one platform is not asked to invent queries for another and
 * is not billed for writing them. Adding a platform adds a key here and
 * nothing else.
 *
 * `subreddits` is not keyed, because it is not a query: it is Reddit's own
 * channel list, and a platform with no channel idea has nothing to put there.
 */
export function queryPlanSchemaFor(platforms: readonly PlatformDescriptor[]) {
  return z.object({
    queries: z.object(
      Object.fromEntries(platforms.map((platform) => [platform.id, queryListSchemaFor(platform)])),
    ),
    subreddits: z
      .array(subredditSchema)
      .max(maximumSubreddits)
      .refine(allDifferent, { message: "each subreddit must be named once" })
      .describe("Subreddits where the ideal customer already posts. Bare names."),
  });
}

/**
 * A plan, once the platform keys are no longer known statically.
 *
 * `queries` is keyed by platform id. A caller reads its own platform's list
 * and never the whole map, which is what stops one platform's phrasing
 * reaching another's search.
 */
export interface QueryPlan {
  readonly queries: Readonly<Record<string, readonly string[]>>;
  readonly subreddits: readonly string[];
}

/**
 * The instructions, which do not change between monitors, so a provider can
 * cache this half. The monitor's own answers are the user prompt.
 */
export function buildQuerySystemPrompt(platforms: readonly PlatformDescriptor[]): string {
  return [
    "You write the search phrases that find public posts from people who have",
    "a problem. Somebody else's product solves that problem; you are not",
    "selling it and you never name it.",
    "",
    "HOW TO WRITE A QUERY",
    "Write what a person with the problem types. They do not know this product",
    "exists and they do not use its words. Prefer the words of the problem",
    "over the words of the category: 'tests break when the ui changes' finds",
    "people, 'test automation platform' finds vendors.",
    "",
    `Write ${minimumQueries} to ${maximumQueries} queries for each platform below.`,
    `Each one is at least ${minimumQueryWords} plain words. No quotes, no AND, no`,
    "OR, no minus signs, and no field operators such as subreddit: or site:.",
    "The search matches the string it is given, so syntax finds nothing at all.",
    "",
    "Each query is a different way in, not a rewording of the last one. Two",
    "queries that mean the same thing collect the same posts twice, and every",
    "post collected is paid for.",
    "",
    "WRITE FOR THE PLATFORM",
    "A query is written for one place. The same words do not work in two",
    "places, because a post is a different length in each. Write a separate",
    "list for every platform named here, and obey its own limit.",
    "",
    ...platforms.flatMap((platform) => describePlatform(platform)),
    "SUBREDDITS",
    "Name subreddits where the ideal customer already posts. Give the bare",
    `name, with no r/ and no URL, and name at most ${maximumSubreddits}.`,
    "Name only subreddits you are confident exist. An invented name collects",
    "nothing and hides that a real one is missing, so fewer is better than",
    "more. None is a valid answer.",
  ].join("\n");
}

/**
 * One platform's paragraph in the prompt.
 *
 * The limit is given with its reason. A model told only a number talks itself
 * out of it on the query it likes; a model told that a long phrase has to
 * appear inside a short post keeps the rule on every line.
 */
function describePlatform(platform: PlatformDescriptor): string[] {
  const ceiling = platform.search?.maxQueryWords ?? defaultMaxQueryWords;

  return [
    `${platform.displayName.toUpperCase()} (key "${platform.id}")`,
    `At most ${ceiling} words per query.`,
    ...(platform.search ? [platform.search.note] : []),
    "",
  ];
}

/** The monitor's own answers. The half that differs between monitors. */
export function buildQueryUserPrompt(monitor: MonitorProfile): string {
  return [
    "THE PRODUCT",
    monitor.product,
    "",
    "THE IDEAL CUSTOMER",
    monitor.idealCustomer,
    "",
    "THE PROBLEM IT SOLVES",
    monitor.problem,
    "",
    "SIGNALS THE USER ASKED FOR",
    describeSignals(monitor.signals),
    "Write queries that find posts of these kinds. None stated means write",
    "for every kind, not for none.",
  ].join("\n");
}

/**
 * Three outcomes, and only the first carries queries.
 *
 * The same split as the classifier's, for the same reason: `rejected` points a
 * person at the prompt or the model, and `failed` points them at the key, the
 * network or the provider. A form that says "try again" to both sends half its
 * users to look in the wrong place.
 */
export type QueryPlanOutcome =
  | { readonly status: "generated"; readonly plan: QueryPlan; readonly call: ModelCall }
  | { readonly status: "rejected"; readonly error: string; readonly call: ModelCall }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

export interface QueryGenerator {
  readonly provider: AiProvider;
  readonly model: string;
  /**
   * `platforms` is what the monitor watches. Asking about a platform a monitor
   * does not watch buys queries nobody runs, and asking about none is a plan
   * with nothing in it, so the caller passes exactly the ticked list.
   */
  generate(
    monitor: MonitorProfile,
    platforms: readonly PlatformDescriptor[],
  ): Promise<QueryPlanOutcome>;
}

export interface QueryGeneratorOptions {
  readonly config: AiConfig;
  /** Overrides the model the config names. A test passes a mock; nothing else does. */
  readonly model?: LanguageModel;
  readonly now?: () => number;
}

export function createQueryGenerator({
  config,
  model,
  now = Date.now,
}: QueryGeneratorOptions): QueryGenerator {
  const languageModel = model ?? createModel(config);

  return {
    provider: config.provider,
    model: config.model,

    async generate(
      monitor: MonitorProfile,
      platforms: readonly PlatformDescriptor[],
    ): Promise<QueryPlanOutcome> {
      const result = await generateStructured({
        model: languageModel,
        config,
        schema: queryPlanSchemaFor(platforms),
        schemaName: "monitor_queries",
        schemaDescription: "The search phrases and subreddits this monitor will use",
        system: buildQuerySystemPrompt(platforms),
        prompt: buildQueryUserPrompt(monitor),
        now,
      });

      if (result.status !== "ok") return result;

      return { status: "generated", plan: result.object as QueryPlan, call: result.call };
    },
  };
}
