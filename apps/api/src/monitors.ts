/**
 * The HTTP side of a monitor: the form's options, the generated queries, and
 * the writes.
 *
 * Every rule these routes enforce lives in `@intentwatch/core`. A route is a
 * shape check and a status code, and nothing else. That is not tidiness: the
 * worker reads the same rows, so a rule written here would be a rule one
 * caller obeys, and docs/testing.md is clear about how that ends.
 *
 * Two status codes carry a decision worth reading. A query generation that the
 * model refused answers 422 and one that never reached the model answers 502,
 * because the person's next action differs: the first is about the prompt or
 * the answers, the second is about a key, a network or an outage. And a resume
 * that cannot start answers 409 with the missing credential named, because
 * "check your credentials" is not a sentence anybody can act on.
 */
import {
  type BudgetState,
  budgetStates,
  type ConnectorDescriptor,
  canFetchRepliesFor,
  checkBudget,
  classifiedPostCounts,
  clearBudget,
  createMonitor,
  type Database,
  deleteMonitor,
  describeMissingCredentials,
  exhaustedBehaviours,
  type FilterDropCounts,
  filterDropCounts,
  groupByPlatform,
  type LastCollection,
  lastCollections,
  listMonitors,
  type Monitor,
  type MonitorEnvironment,
  maximumQueries,
  maximumSubreddits,
  minimumPollIntervalSeconds,
  monitorQueryPlan,
  noFilterDrops,
  notificationIssues,
  noVerdicts,
  type ProviderChoices,
  pauseMonitor,
  platforms,
  type QueryGenerator,
  readProviderChoices,
  recordModelCall,
  resumeMonitor,
  searchQuerySchemaFor,
  setBudget,
  signals as signalIds,
  signalList,
  startBlockers,
  sources as storableSources,
  subredditSchema,
  updateMonitor,
  type VerdictCounts,
  verdictCounts,
} from "@intentwatch/core";
import { z } from "zod";
import { ownedMonitor, sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

/**
 * The shortest answer worth sending to a model.
 *
 * Not a style rule. "QA" as the product tells the generator nothing, and the
 * queries it writes from nothing collect the whole site — which, on a metered
 * source, is the bill. The form is where that is cheapest to catch.
 */
const shortestAnswer = 10;
const longestAnswer = 2000;

const answerText = z.string().trim().min(shortestAnswer).max(longestAnswer);

/**
 * The list fields, without their defaults.
 *
 * A create fills an absent list with an empty one. An edit must not: absent
 * has to mean "leave it alone", or a screen that changes one setting erases
 * the rest. `updateBody` re-declares these four for exactly that reason.
 */
const signalsField = z.array(z.enum(signalIds)).max(signalIds.length);

/** The four answers PLAN.md's form asks for. */
const answersBody = z.object({
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
const queriesField = z.object(
  Object.fromEntries(
    platforms.map((platform) => [
      platform.id,
      z.array(searchQuerySchemaFor(platform.search)).max(maximumQueries).default([]),
    ]),
  ),
);

/** The same shape on the way out, where the keys are whatever a row holds. */
const queriesResponse = z.record(z.string(), z.array(z.string()));

const subredditsField = z.array(subredditSchema).max(maximumSubreddits);

const planBody = z.object({
  queries: queriesField.default({}),
  subreddits: subredditsField.default([]),
});

/**
 * A monthly cap, as the wire carries it. Micro-dollars, the unit the whole
 * product counts in; the screen turns what a person typed in dollars into it.
 */
const budgetSchema = z.object({
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
const preFilterSchema = z.object({
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
const pollDaysField = z
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
const pollTimezoneField = z
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

const sourcesField = z.array(z.enum(storableSources));

/**
 * The generate route's body: the four answers, plus which platforms to write
 * for. `sources` is new in US-027 and defaults to empty, which means "all of
 * them" — an older client that does not send it keeps working.
 */
/** What a platform that declares no rule of its own is held to. */
const defaultQueryWords = 8;

const generateBody = answersBody.extend({
  sources: sourcesField.default([]),
});

const createBody = answersBody.extend({
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
const updateBody = createBody.partial().extend({
  signals: signalsField.optional(),
  queries: queriesField.optional(),
  subreddits: subredditsField.optional(),
  sources: sourcesField.optional(),
});

const missingCredentialSchema = z.object({
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
const spendSchema = z.object({
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

const monitorSchema = z.object({
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
    dropped: z.object({ keyword: z.number(), embedding: z.number(), triage: z.number() }),
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

const problemSchema = z.object({
  message: z.string(),
  missingCredentials: z.array(missingCredentialSchema).optional(),
});

export interface MonitorRoutesOptions {
  readonly db: Database;
  /** The connectors this build ships, read for their credential fields. */
  readonly sources: readonly ConnectorDescriptor[];
  /** The environment half of where a source key lives. */
  readonly environment?: Record<string, string | undefined>;
  /**
   * The stored half: which credentials `source_credentials` holds, as
   * `source:field` names.
   *
   * A function, so it is read when a request asks. `startApi` passes one that
   * reads `source_credentials`; a test that describes a deployment passes one
   * that answers from memory. US-004, US-023.
   */
  readonly storedCredentials?: (
    userId: string,
  ) => Promise<ReadonlySet<string>> | ReadonlySet<string>;
  /** Null when this deployment has no model key. The form says so. */
  readonly queryGenerator?: QueryGenerator | null;
  /**
   * The per-account fallback. US-068.
   *
   * The option above stays an override — a test passes one, and `null` still
   * means "this deployment has none". This is what is used when it is absent,
   * and it is a function of the person asking because they pay for the call.
   */
  readonly queryGeneratorFor?: (userId: string) => Promise<QueryGenerator | null>;
}

function monitorEnvironment(
  options: MonitorRoutesOptions,
  storedCredentials: ReadonlySet<string>,
  providerChoices: ProviderChoices,
): MonitorEnvironment {
  return {
    descriptors: options.sources,
    environment: options.environment,
    storedCredentials,
    providerChoices,
  };
}

/** The pre-filter settings, as the core write functions take them. */
function replySettings(body: { includeReplies?: boolean }) {
  return body.includeReplies === undefined ? {} : { includeReplies: body.includeReplies };
}

function filterSettings(body: { preFilter?: { enabled?: boolean; similarityThreshold?: number } }) {
  return {
    ...(body.preFilter?.enabled === undefined ? {} : { preFilterEnabled: body.preFilter.enabled }),
    ...(body.preFilter?.similarityThreshold === undefined
      ? {}
      : { similarityThreshold: body.preFilter.similarityThreshold }),
  };
}

function toResponse(
  monitor: Monitor & { projectName?: string | null },
  runtime: MonitorEnvironment,
  state: BudgetState,
  dropped: FilterDropCounts,
  read: number,
  verdicts: VerdictCounts,
  collected: readonly LastCollection[],
  notificationProblems: readonly string[],
) {
  return {
    id: monitor.id,
    name: monitor.name,
    projectId: monitor.projectId,
    // Absent on the single-monitor path, which does not join. Null there means
    // "not loaded", and the list is the only screen that groups.
    projectName: monitor.projectName ?? null,
    product: monitor.product,
    idealCustomer: monitor.idealCustomer,
    problem: monitor.problem,
    signals: monitor.signals,
    queries: monitorQueryPlan(monitor.generatedQueries),
    subreddits: monitor.generatedSubreddits,
    sources: monitor.sources,
    minScore: monitor.minScore,
    pollIntervalSeconds: monitor.pollIntervalSeconds,
    pollDays: monitor.pollDays,
    pollTimezone: monitor.pollTimezone,
    paused: monitor.pausedAt !== null,
    pausedAt: monitor.pausedAt?.toISOString() ?? null,
    lastPolledAt: monitor.lastPolledAt?.toISOString() ?? null,
    createdAt: monitor.createdAt.toISOString(),
    missingCredentials: startBlockers(monitor.sources, runtime),
    lastCollected: collected.map((one) => ({
      source: one.source,
      provider: one.provider,
      at: one.at.toISOString(),
    })),
    budget:
      state.capMicros === null || state.onExhausted === null
        ? null
        : { monthlyCapMicros: state.capMicros, onExhausted: state.onExhausted },
    spend: {
      sourceMicros: state.spend.sourceMicros,
      modelMicros: state.spend.modelMicros,
      totalMicros: state.spend.totalMicros,
      remainingMicros: state.remainingMicros,
      exhausted: state.exhausted,
      reason: state.reason,
      since: state.spend.since.toISOString(),
    },
    preFilter: {
      enabled: monitor.preFilterEnabled,
      similarityThreshold: monitor.similarityThreshold,
      dropped,
      read,
    },
    includeReplies: monitor.includeReplies,
    feedback: verdicts,
    notificationIssues: [...notificationProblems],
  };
}

/**
 * One monitor, with everything the screen shows beside it.
 *
 * The list route reads its spend and its drop counts in bulk instead. Both
 * paths end in `toResponse`, so neither can grow a field the other lacks.
 */
async function readResponse(db: Database, monitor: Monitor, runtime: MonitorEnvironment) {
  const [state, drops, read, verdicts, collected, notifications] = await Promise.all([
    checkBudget(db, monitor.id),
    filterDropCounts(db, [monitor.id]),
    classifiedPostCounts(db, [monitor.id]),
    verdictCounts(db, [monitor.id]),
    lastCollections(db),
    notificationIssues(db),
  ]);

  return toResponse(
    monitor,
    runtime,
    state,
    drops.get(monitor.id) ?? noFilterDrops,
    read.get(monitor.id) ?? 0,
    verdicts.get(monitor.id) ?? noVerdicts,
    collected.get(monitor.id) ?? [],
    notifications.get(monitor.id) ?? [],
  );
}

export async function registerMonitorRoutes(
  app: ApiServer,
  options: MonitorRoutesOptions,
): Promise<void> {
  const { db, sources, queryGenerator, queryGeneratorFor } = options;

  /**
   * The model that writes this person's queries. US-068.
   *
   * They pay for the call, so the settings are theirs. The option stays an
   * override for tests, including `null` for a deployment that has none.
   */
  async function generatorFor(userId: string): Promise<QueryGenerator | null> {
    return queryGenerator === undefined
      ? ((await queryGeneratorFor?.(userId)) ?? null)
      : queryGenerator;
  }

  /**
   * Which credentials exist, read when a request asks rather than at boot.
   *
   * US-023 is why this is a call and not a constant. The connections screen
   * stores a key while this process runs, and a set captured at registration
   * would go on reporting that key as missing until a restart. One small table
   * per request is the price of the two screens agreeing.
   */
  const stored = options.storedCredentials ?? (() => new Set<string>());

  /**
   * What this *person* can poll with. US-067.
   *
   * A key is an account's since US-067, so "is Reddit ready?" is a question
   * about whoever is asking. It used to be a question about the instance, and
   * on an instance taking registrations that answer would tell one person a
   * platform is connected because somebody else pasted a key for it.
   */
  async function currentEnvironment(userId: string): Promise<MonitorEnvironment> {
    // Both halves per request, and for the same reason: the connections screen
    // writes a key and a provider choice into this running process, and a
    // value captured at registration would keep answering with the old one
    // until a restart.
    const [storedCredentials, providerChoices] = await Promise.all([
      stored(userId),
      readProviderChoices(db),
    ]);

    return monitorEnvironment(options, storedCredentials, providerChoices);
  }

  /**
   * Everything the form needs to render itself.
   *
   * The signals come from `signalList`, which is the same file both prompts
   * read. A form with its own copy of the labels is how a checkbox and a
   * prompt end up meaning different things.
   */
  app.route({
    method: "GET",
    url: "/api/monitor-options",
    schema: {
      response: {
        200: z.object({
          signals: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string() })),
          sources: z.array(
            z.object({
              id: z.string(),
              displayName: z.string(),
              /**
               * How a query has to be written for this platform. US-027: the
               * form asks for one list per platform and holds each to its own
               * rule, so it has to be able to say what the rule is.
               */
              search: z.object({ maxQueryWords: z.number(), note: z.string() }),
              /** Empty when the platform can be collected. */
              missingCredentials: z.array(missingCredentialSchema),
              ready: z.boolean(),
              /**
               * Whether the connector that would run here reads replies.
               *
               * Per platform and per deployment, not per build. A build ships
               * two Reddit connectors and only one of them reads replies, so
               * an instance holding the other one's key must be told that
               * ticking the box will give it nothing.
               */
              canFetchReplies: z.boolean(),
            }),
          ),
          /** False when no model key is set, so the form can say why. */
          canGenerateQueries: z.boolean(),
        }),
      },
    },
    handler: async (request) => {
      const runtime = await currentEnvironment(sessionUserId(request));

      return {
        signals: signalList.map(({ id, label, hint }) => ({ id, label, hint })),
        /**
         * One row per platform, not per connector.
         *
         * US-026, and it is the whole of what this form knows about providers.
         * A person ticks networks to watch; which account fetches them is one
         * row on the connections screen, chosen once for every monitor. Two
         * Reddit connectors listed here would put Reddit on the form twice and
         * make the person pick a scraper.
         *
         * The price is gone from this response for the same reason. It belongs
         * to the pair, and two providers do not agree about it, so a figure
         * printed beside a platform would be one provider's arithmetic on the
         * other's bill. The cost test reads it from the connector that took
         * the sample.
         */
        sources: groupByPlatform(sources).map(({ platform }) => {
          const missing = startBlockers([platform.id], runtime);
          const replies = canFetchRepliesFor([platform.id], runtime);

          return {
            id: platform.id,
            displayName: platform.displayName,
            search: {
              maxQueryWords: platform.search?.maxQueryWords ?? defaultQueryWords,
              note: platform.search?.note ?? "",
            },
            // What is still to be set, from whichever providers are blocked.
            // Each entry names its provider, so a platform two providers fetch
            // can be shown as needing one account or the other, never both.
            missingCredentials: missing,
            ready: missing.length === 0,
            canFetchReplies: replies[platform.id] === true,
          };
        }),
        canGenerateQueries: (await generatorFor(sessionUserId(request))) !== null,
      };
    },
  });

  /**
   * Write the queries for a set of answers, before any monitor exists.
   *
   * This spends money on the user's key, so the call is recorded whatever it
   * returned. The row carries no monitor id, because there is no monitor yet:
   * a person may generate three times and create nothing, and those three
   * calls are still on the bill.
   */
  app.route({
    method: "POST",
    url: "/api/monitors/queries",
    schema: {
      body: generateBody,
      response: {
        200: z.object({
          queries: queriesResponse,
          subreddits: z.array(z.string()),
          model: z.string(),
          estimatedCostMicros: z.number().nullable(),
        }),
        422: problemSchema,
        502: problemSchema,
        503: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const generator = await generatorFor(sessionUserId(request));

      if (!generator) {
        return reply.code(503).send({
          message:
            "No model is configured, so queries cannot be written. Set AI_API_KEY, " +
            "or AI_PROVIDER=ollama to run a local model. You can still type the " +
            "queries yourself.",
        });
      }

      /**
       * Write for the platforms this monitor watches, and for no others.
       *
       * A monitor that watches one platform must not be billed for queries it
       * will never run, and a plan written for a platform nobody ticked is a
       * list a person has to read and delete. An empty list means the form has
       * not asked the question yet, so every platform is written for: that is
       * the old behaviour, and it is what an older client still gets.
       */
      const wanted = request.body.sources;
      const wantedPlatforms =
        wanted.length === 0
          ? platforms
          : platforms.filter((platform) => wanted.some((id) => id === platform.id));

      const outcome = await generator.generate(request.body, wantedPlatforms);

      await recordModelCall(db, {
        purpose: "query_generation",
        outcome: outcome.status === "generated" ? "scored" : outcome.status,
        call: outcome.call,
        error: outcome.status === "generated" ? null : outcome.error,
      });

      if (outcome.status === "rejected") {
        request.log.warn({ err: outcome.error }, "the model wrote an unusable set of queries");
        return reply.code(422).send({
          message:
            `${generator.model} did not write a usable set of queries. ` +
            "Try again, or make the answers more specific. You can also type the queries yourself.",
        });
      }

      if (outcome.status === "failed") {
        request.log.error({ err: outcome.error }, "the model could not be reached");
        return reply.code(502).send({
          message: `${generator.model} could not be reached: ${outcome.error}`,
        });
      }

      return {
        // Copied into plain arrays: the plan is readonly and the response
        // schema is not, and a cast here would hide the next shape change.
        queries: Object.fromEntries(
          Object.entries(outcome.plan.queries).map(([platform, list]) => [platform, [...list]]),
        ),
        subreddits: [...outcome.plan.subreddits],
        model: generator.model,
        estimatedCostMicros: outcome.call.estimatedCostMicros ?? null,
      };
    },
  });

  app.route({
    method: "GET",
    url: "/api/monitors",
    schema: { response: { 200: z.array(monitorSchema) } },
    handler: async (request) => {
      const runtime = await currentEnvironment(sessionUserId(request));

      // One read for every monitor's spend, rather than one per row. The
      // screen that shows this is a list, and a per-row query here would be
      // the list's cost growing with the number of monitors.
      const rows = await listMonitors(db, sessionUserId(request));
      const [states, drops, read, verdicts, collected, notifications] = await Promise.all([
        budgetStates(db),
        filterDropCounts(db),
        classifiedPostCounts(db),
        verdictCounts(db),
        lastCollections(db),
        notificationIssues(db),
      ]);

      return Promise.all(
        rows.map(async (monitor) =>
          // A monitor created between the two reads is not in the map. Its
          // spend is read on its own rather than defaulted to zero: this is a
          // bill page, and a zero nothing measured is the failure US-013 is
          // about. A missing drop count is different — it means this monitor
          // has dropped nothing, which is what zero says.
          toResponse(
            monitor,
            runtime,
            states.get(monitor.id) ?? (await checkBudget(db, monitor.id)),
            drops.get(monitor.id) ?? noFilterDrops,
            read.get(monitor.id) ?? 0,
            verdicts.get(monitor.id) ?? noVerdicts,
            collected.get(monitor.id) ?? [],
            notifications.get(monitor.id) ?? [],
          ),
        ),
      );
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors",
    schema: {
      body: createBody,
      response: { 201: monitorSchema },
    },
    handler: async (request, reply) => {
      const runtime = await currentEnvironment(sessionUserId(request));

      const { monitor, missing } = await createMonitor(
        db,
        {
          ...request.body,
          ...filterSettings(request.body),
          ...replySettings(request.body),
          userId: sessionUserId(request),
        },
        runtime,
      );

      if (request.body.budget) await setBudget(db, monitor.id, request.body.budget);

      if (missing.length > 0) {
        // Created, and paused, because four answers somebody just typed are
        // not thrown away over a key they can paste in a minute. The response
        // says which one, and the monitor stays off until it is set.
        request.log.warn(
          { monitorId: monitor.id, missing: missing.map((one) => one.environmentVariable) },
          "monitor created but not started: a credential is missing",
        );
      }

      return reply.code(201).send(await readResponse(db, monitor, runtime));
    },
  });

  app.route({
    method: "GET",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "PATCH",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: updateBody,
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const monitor = await updateMonitor(db, request.params.id, {
        ...request.body,
        ...filterSettings(request.body),
        ...replySettings(request.body),
      });
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors/:id/pause",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const monitor = await pauseMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors/:id/resume",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema, 409: problemSchema },
    },
    handler: async (request, reply) => {
      // Read now, not at boot. A key stored on the connections screen a moment
      // ago is what makes this resume the one that succeeds.
      const runtime = await currentEnvironment(sessionUserId(request));

      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const result = await resumeMonitor(db, request.params.id, runtime);
      if (!result) return reply.code(404).send({ message: "No monitor has that id." });

      if (result.status === "blocked") {
        // "and" inside one provider, "or" between providers. A platform two
        // providers fetch needs one account, and a sentence that joined them
        // with "and" would send a person to open the second one.
        const names = describeMissingCredentials(result.missing);

        return reply.code(409).send({
          message:
            `This monitor cannot start until ${names} ` +
            `${result.missing.length === 1 ? "is" : "are"} set.`,
          missingCredentials: [...result.missing],
        });
      }

      return readResponse(db, result.monitor, runtime);
    },
  });

  /**
   * Set this monitor's monthly cap, or replace the one it has.
   *
   * `PUT`, because one monitor has one budget and sending it twice must leave
   * one cap. The amount is micro-dollars, the unit the whole product counts
   * in; the screen turns what a person typed in dollars into this.
   *
   * A cap of zero is allowed. "This monitor may spend nothing" is a real thing
   * to ask for, and it is the fastest way to stop a monitor billing while
   * keeping everything it has already collected.
   */
  app.route({
    method: "PUT",
    url: "/api/monitors/:id/budget",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        monthlyCapMicros: z.number().int().min(0),
        onExhausted: z.enum(exhaustedBehaviours).default("pause"),
      }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await setBudget(db, monitor.id, request.body);

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  /**
   * Remove the cap. The recorded usage stays.
   *
   * Deleting the spend with the cap would erase the answer to "what did this
   * month cost", which is the question the ledger exists to answer. A monitor
   * with no cap goes on recording every unit it spends.
   *
   * This does not resume a monitor the cap paused. Removing a limit and
   * starting to spend again are two decisions, and the second one is a
   * person's.
   */
  app.route({
    method: "DELETE",
    url: "/api/monitors/:id/budget",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await clearBudget(db, monitor.id);

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 204: z.null(), 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const deleted = await deleteMonitor(db, request.params.id);
      if (!deleted) return reply.code(404).send({ message: "No monitor has that id." });

      return reply.code(204).send(null);
    },
  });
}
