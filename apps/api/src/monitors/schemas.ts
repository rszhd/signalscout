/**
 * The wire shapes of a monitor: what a body may carry and what a response
 * always does. US-265 split them out of the routes.
 *
 * Every rule these shapes check is a shape check. The rules themselves live
 * in `@signalscout/pipeline`, for the reason `monitors.ts` gives.
 */
import {
  exhaustedBehaviours,
  maximumQueries,
  maximumSubreddits,
  minimumPollIntervalSeconds,
  type PollRun,
  platforms,
  type StageRun,
  searchQuerySchemaFor,
  signals as signalIds,
  sources as storableSources,
  subredditSchema,
} from "@signalscout/pipeline";
import { z } from "zod";

export const shortestAnswer = 10;
export const longestAnswer = 2000;

export const answerText = z.string().trim().min(shortestAnswer).max(longestAnswer);

/**
 * The list fields, without their defaults.
 *
 * A create fills an absent list with an empty one. An edit must not: absent
 * has to mean "leave it alone", or a screen that changes one setting erases
 * the rest. `updateBody` re-declares these four for exactly that reason.
 */
export const signalsField = z.array(z.enum(signalIds)).max(signalIds.length);

/** The four answers PLAN.md's form asks for. */
export const answersBody = z.object({
  product: answerText,
  idealCustomer: answerText,
  problem: answerText,
  signals: signalsField.default([]),
});

/**
 * The queries after a person has edited them.
 *
 * `searchQuerySchema` is the model's rule, reused here on purpose: an edited
 * query costs exactly what a generated one costs, so it obeys the same rule.
 * The floor is different, though. The model must write at least three, because
 * a model that writes one has misunderstood the job. A person may delete all
 * of them and run the monitor on subreddits alone, which is a real way to use
 * it.
 */
/**
 * Queries, keyed by the platform each list is for.
 *
 * US-027. Every platform gets its own list and its own rule: the ceiling comes
 * from `PlatformDescriptor.search`, so an X query is held to four words here
 * exactly as it is in the prompt. A rule the model must obey and a person may
 * bypass is a suggestion with a test, and this form is where a person edits.
 *
 * The keys are the platforms this build has. A key it does not know is
 * dropped rather than stored, because `posts.source` could not hold posts
 * found by it and the poll would never read it.
 */
export const queriesField = z.object(
  Object.fromEntries(
    platforms.map((platform) => [
      platform.id,
      z.array(searchQuerySchemaFor(platform.search)).max(maximumQueries).default([]),
    ]),
  ),
);

/** The same shape on the way out, where the keys are whatever a row holds. */
export const queriesResponse = z.record(z.string(), z.array(z.string()));

export const subredditsField = z.array(subredditSchema).max(maximumSubreddits);

export const planBody = z.object({
  queries: queriesField.default({}),
  subreddits: subredditsField.default([]),
});

/**
 * A monthly cap, as the wire carries it. Micro-dollars, the unit the whole
 * product counts in; the screen turns what a person typed in dollars into it.
 */
export const budgetSchema = z.object({
  monthlyCapMicros: z.number().int().min(0),
  onExhausted: z.enum(exhaustedBehaviours),
});

/**
 * The pre-filter, as a person sets it.
 *
 * The threshold is a cosine similarity and not a percentage, because that is
 * what `filter_drops` records and what a person comparing the two would read.
 * Turning the filter off is here rather than implied by a threshold of zero:
 * zero still runs the keyword stage, and "off" has to mean off.
 */
export const preFilterSchema = z.object({
  enabled: z.boolean(),
  similarityThreshold: z.number().min(0).max(1),
});

/**
 * When a monitor runs. US-041.
 *
 * An interval plus the days it applies on, which expresses hourly, daily,
 * weekly, weekdays, weekends and any chosen set without a cron field. A cron
 * field would move the problem to a person who gets it wrong silently and
 * expensively, and poll frequency is this product's largest cost dial: the
 * same query costs $10.80 a month polled hourly and $648 polled every minute.
 */
export const pollDaysField = z
  .array(z.number().int().min(0).max(6))
  .min(1, "A monitor needs at least one day to poll on. To stop it, pause it.")
  .max(7)
  // Postgres numbering, 0 is Sunday. Sorted and de-duplicated so two people who
  // tick the same days store the same row.
  .transform((days) => [...new Set(days)].sort((left, right) => left - right));

/**
 * An IANA zone name, checked here because it cannot be checked in the database.
 *
 * `now() AT TIME ZONE` throws on a name Postgres does not know, and that call
 * is inside the scheduler's single query — so one bad row would stop every
 * monitor rather than its own. `Intl` holds the same list the database does.
 */
export const pollTimezoneField = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "That is not a timezone name. Use an IANA name such as Asia/Kuala_Lumpur." },
  );

export const sourcesField = z.array(z.enum(storableSources));

/**
 * The generate route's body: the four answers, plus which platforms to write
 * for. `sources` is new in US-027 and defaults to empty, which means "all of
 * them" — an older client that does not send it keeps working.
 */
/** What a platform that declares no rule of its own is held to. */
export const defaultQueryWords = 8;

export const generateBody = answersBody.extend({
  sources: sourcesField.default([]),
});

export const createBody = answersBody.extend({
  name: z.string().trim().min(1).max(80),
  ...planBody.shape,
  sources: sourcesField.default([]),
  /** Where the answers were copied from, for grouping. US-045. */
  projectId: z.uuid().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  pollIntervalSeconds: z.number().int().min(minimumPollIntervalSeconds).optional(),
  pollDays: pollDaysField.optional(),
  pollTimezone: pollTimezoneField.optional(),
  /**
   * The cap, set with the monitor rather than a moment later.
   *
   * A monitor created and given its cap in a second request is a monitor the
   * scheduler could poll in between, uncapped. US-014's form knows the cap
   * before it creates anything, because the cost test was measured against
   * it.
   */
  budget: budgetSchema.optional(),
  /** US-014: keep this plan, do not start it. The person was shown what it would cost. */
  startPaused: z.boolean().default(false),
  preFilter: preFilterSchema.partial().optional(),
  /**
   * US-020. Off unless asked for, here and in the column's own default.
   *
   * It is not in `preFilter` because it is not a filter setting: it decides
   * what is collected, and it multiplies what the classifier reads rather than
   * reducing it.
   */
  includeReplies: z.boolean().optional(),
});

/**
 * What an edit carries: only the fields it changes.
 *
 * `.partial()` makes every key optional, and a key that is optional and
 * defaulted is still filled in when it is absent. So a body of one setting
 * arrived carrying empty answers for everything else, and the route wrote
 * them: no signals for the prompt, no source to poll, and a version bump that
 * told the feedback already collected it was given against an older monitor.
 * The pre-filter form on the monitor list sends one setting, which is how a
 * live run found it.
 *
 * The four list fields are re-declared here without their defaults, so absent
 * means absent and `updateMonitor` leaves the column alone.
 */
export const updateBody = createBody.partial().extend({
  signals: signalsField.optional(),
  queries: queriesField.optional(),
  subreddits: subredditsField.optional(),
  sources: sourcesField.optional(),
});

export const missingCredentialSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  field: z.string(),
  label: z.string(),
  environmentVariable: z.string(),
});

/**
 * What a monitor spent this month, and what it may still spend.
 *
 * Micro-dollars on the wire, because that is what the database holds and a
 * rounded number here would be a second, disagreeing figure. The screen
 * formats them. `reason` is the sentence that refused the poll, sent whole so
 * the log and the screen say the same thing.
 *
 * Every figure is an estimate. See docs/costs.md: the provider's invoice is
 * authoritative and this arithmetic is not.
 */
export const spendSchema = z.object({
  sourceMicros: z.number(),
  modelMicros: z.number(),
  totalMicros: z.number(),
  /** Null when the monitor has no cap. */
  remainingMicros: z.number().nullable(),
  exhausted: z.boolean(),
  reason: z.string().nullable(),
  /** The first moment counted, so the screen can say what "this month" means. */
  since: z.string(),
});

/**
 * What one poll did. US-104.
 *
 * The three counts are separate on purpose and a screen must keep them
 * separate: none returned with units above zero says the queries or the parser
 * are at fault, many returned and none new says deduplication is working, and
 * many new with no match says the threshold is wrong. One "posts found" number
 * collapses all three, which is what the monitor list had.
 */
export const pollRunSchema = z.object({
  id: z.string(),
  /** The collection this poll belongs to. Several polls share one. */
  walkId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  outcome: z.string(),
  postsReturned: z.number(),
  postsNew: z.number(),
  units: z.number(),
  /** Estimated, in the sense docs/costs.md means. Never rounded to cents. */
  estimatedCostMicros: z.number(),
  stopReason: z.string().nullable(),
  sources: z.array(
    z.object({
      source: z.string(),
      provider: z.string().nullable(),
      pages: z.number(),
      postsReturned: z.number(),
      postsNew: z.number(),
      units: z.number(),
      estimatedCostMicros: z.number(),
      reason: z.string().nullable(),
    }),
  ),
});

export const stageDetailSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("filter"),
    keyword: z.number(),
    embedding: z.number(),
    triage: z.number(),
  }),
  z.object({
    stage: z.literal("replies"),
    threadsOpened: z.number(),
    threadsSkipped: z.number(),
    pagesBought: z.number(),
  }),
  z.object({
    stage: z.literal("classify"),
    /** What the model answered for in this run, not what the run was handed. */
    scored: z.number(),
    /** Already scored under this monitor's version, so not asked again. US-206. */
    skipped: z.number().optional(),
    matched: z.number(),
    unclassified: z.number(),
    dropped: z.number(),
    leftByCap: z.number(),
  }),
  z.object({ stage: z.literal("notify"), deliveries: z.number() }),
]);

export const stageRunSchema = z.object({
  id: z.string(),
  stage: z.string(),
  /** The collection this stage was part of, or null. US-203. */
  walkId: z.string().nullable(),
  /**
   * The poll inside that collection whose posts it processed, or null. US-211.
   *
   * Null in three ordinary cases, and a screen has to read all three the same
   * way — as "poll unknown", never as a guess. A row written before the field
   * existed has nothing to attribute. A poll trimmed away takes its reference
   * with it, since `poll_runs` keeps 200 rows per monitor against
   * `stage_runs`' 800. And the notification sweep belongs to no collection at
   * all.
   */
  pollRunId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string(),
  outcome: z.string(),
  itemsIn: z.number(),
  itemsOut: z.number(),
  units: z.number(),
  estimatedCostMicros: z.number(),
  detail: stageDetailSchema.nullable(),
  stopReason: z.string().nullable(),
});

/**
 * The history, as one list. US-266.
 *
 * A poll and a stage are different rows with different columns, so the entry
 * carries one or the other and says which. `at` is what the list is ordered
 * by, lifted out of both so the browser does not have to know where each kind
 * keeps its clock.
 */
export const activityEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("poll"), at: z.string(), poll: pollRunSchema }),
  z.object({ kind: z.literal("stage"), at: z.string(), stage: stageRunSchema }),
]);

export const activityPageSchema = z.object({
  entries: z.array(activityEntrySchema),
  /**
   * Where the stage record ends, or null when the monitor has none. US-266.
   *
   * `stage_runs` keeps 800 rows per monitor and `poll_runs` 200, so a long
   * history thins to polls alone at the bottom. This is the `startedAt` of the
   * oldest stage row still kept: a poll older than it had stages once, and
   * they are gone rather than absent, which the screen says.
   */
  stagesRecordedSince: z.string().nullable(),
  /** Whether asking with `before` set to the last entry's `at` would answer more. */
  more: z.boolean(),
});

export function toStageRunResponse(run: StageRun) {
  return {
    id: run.id,
    stage: run.stage,
    walkId: run.walkId,
    pollRunId: run.pollRunId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    outcome: run.outcome,
    itemsIn: run.itemsIn,
    itemsOut: run.itemsOut,
    units: run.units,
    estimatedCostMicros: run.estimatedCostMicros,
    detail: run.detail,
    stopReason: run.stopReason,
  };
}

export function toPollRunResponse(run: PollRun) {
  return {
    id: run.id,
    walkId: run.walkId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    outcome: run.outcome,
    postsReturned: run.postsReturned,
    postsNew: run.postsNew,
    units: run.units,
    estimatedCostMicros: run.estimatedCostMicros,
    stopReason: run.stopReason,
    sources: run.sources.map((entry) => ({ ...entry })),
  };
}

export const monitorSchema = z.object({
  notificationIssues: z.array(z.string()),
  id: z.string(),
  name: z.string(),
  /** The project this monitor came out of, for grouping. Null is normal. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  product: z.string(),
  idealCustomer: z.string(),
  problem: z.string(),
  signals: z.array(z.string()),
  queries: queriesResponse,
  subreddits: z.array(z.string()),
  sources: z.array(z.string()),
  minScore: z.number(),
  pollIntervalSeconds: z.number(),
  /** Postgres numbering, 0 is Sunday. US-041. */
  pollDays: z.array(z.number()),
  pollTimezone: z.string(),
  paused: z.boolean(),
  pausedAt: z.string().nullable(),
  lastPolledAt: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Recomputed on every read, never stored. The keys live in the environment
   * until US-004, so a monitor can become startable without its row changing.
   */
  missingCredentials: z.array(missingCredentialSchema),
  /**
   * Which provider last collected each platform, and when.
   *
   * US-026 added it, because a person who can change the provider has to be
   * able to see which one ran. It is read from `api_usage`, so the moment is
   * the last time money was spent on that pair rather than the last time a
   * poll was scheduled — a poll refused by the budget guard moves nothing
   * here, which is the honest answer.
   */
  lastCollected: z.array(z.object({ source: z.string(), provider: z.string(), at: z.string() })),
  /**
   * The last poll, or null where none has run yet. US-104.
   *
   * On the monitor itself rather than behind a second request, because the
   * question it answers — "is this working?" — is the one the list is opened
   * to ask. `lastPolledAt` above says a poll happened; this says what it did.
   */
  lastPoll: pollRunSchema.nullable(),
  /**
   * The stage of the work in flight, or null when the worker holds nothing
   * for this monitor. US-265. Read off the queue, not off the row, so it is
   * true at the instant of the request and never remembered.
   */
  stage: z
    .object({
      queue: z.string(),
      state: z.enum(["active", "queued"]),
      since: z.string(),
      items: z.number().nullable(),
      walkId: z.string().nullable(),
    })
    .nullable(),
  /** Null when no cap is set. A monitor with no cap still records what it spends. */
  budget: budgetSchema.nullable(),
  spend: spendSchema,
  /**
   * The pre-filter's settings and what it has dropped, all time.
   *
   * The counts are here so a person can see the stage working. A filter that
   * drops most of what it sees is either saving a lot of money or hiding the
   * inbox, and only the number says which question to ask.
   */
  preFilter: preFilterSchema.extend({
    /** `ceiling`: past the day's number for the search that found them. US-287. */
    dropped: z.object({
      keyword: z.number(),
      embedding: z.number(),
      triage: z.number(),
      ceiling: z.number(),
    }),
    /**
     * How many posts the classifier has read for this monitor.
     *
     * Beside the drops it makes the whole sentence: read plus skipped is every
     * post this monitor has decided about, which is the total a person can
     * check the filter against. `posts` has no monitor column — one row serves
     * every monitor that found it — so the total is these two added up rather
     * than a count of anything.
     */
    read: z.number(),
  }),
  /** US-020. Whether this monitor reads the replies under the posts it finds. */
  includeReplies: z.boolean(),
  /**
   * How many matches this monitor holds, and how many nobody has opened.
   * US-109.
   *
   * The list's one measure of whether any of the spending produced anything.
   * Every other figure on the row is about the work — posts returned, posts
   * skipped, money spent — and none of them says whether a lead came out.
   *
   * A hidden match is not counted: US-015 hides one whose post has been
   * deleted, and a number counting those promises leads that open on nothing.
   */
  matches: z.object({ total: z.number(), unread: z.number() }),
  /**
   * What the person thought of this monitor's matches, counting only the
   * verdicts in force.
   *
   * PLAN.md sets this as the real measure of success. A monitor whose feedback
   * is nine tenths negative is a product failure that no other figure on this
   * page would show: it can be running, inside its cap and filling an inbox
   * while being wrong about every post it finds.
   */
  feedback: z.object({ good: z.number(), notRelevant: z.number() }),
});

export const problemSchema = z.object({
  message: z.string(),
  missingCredentials: z.array(missingCredentialSchema).optional(),
});
