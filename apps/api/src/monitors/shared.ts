/**
 * What the monitor route groups share: their options, the context each is
 * handed, and the one function every response goes through. US-265.
 *
 * `toResponse` is the reason this file exists. The list reads its counts in
 * bulk and the single-monitor paths read them one at a time, and both end
 * here, so neither can grow a field the other lacks.
 */
import {
  type BudgetState,
  type ConnectorDescriptor,
  checkOwnedBudget,
  classifiedPostCounts,
  type Database,
  type FilterDropCounts,
  filterDropCounts,
  type LastCollection,
  lastCollections,
  latestPollRuns,
  type MatchCounts,
  type Monitor,
  type MonitorEnvironment,
  matchCounts,
  monitorQueryPlan,
  noFilterDrops,
  noMatchCounts,
  notificationIssues,
  notOfferedReason,
  noVerdicts,
  type PollRun,
  type ProviderChoices,
  type QueryGenerator,
  readProviderChoices,
  startBlockers,
  type VerdictCounts,
  verdictCounts,
} from "@signalscout/pipeline";
import { type MonitorStage, monitorStages } from "../activity.js";
import { toPollRunResponse } from "./schemas.js";

export interface MonitorRoutesOptions {
  readonly db: Database;
  /** The connectors this build ships, read for their credential fields. */
  readonly sources: readonly ConnectorDescriptor[];
  /** The environment half of where a source key lives. */
  readonly environment?: Record<string, string | undefined>;
  /**
   * Whether this deployment has a working mailer. US-093.
   *
   * A boolean rather than the SMTP settings, because these routes have no
   * other business with them: `notificationReadiness` is asked once at the
   * composition root, where the notification routes already ask it. False by
   * default, so a caller that says nothing creates monitors that notify
   * nobody — which is how every monitor behaved before US-093.
   */
  readonly canSendEmail?: boolean;
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

/**
 * Why the platforms a body names cannot be watched, or null when they can.
 *
 * US-053. The body schema checks the `posts.source` enum, which says what the
 * database can store and not what this build will collect — so a monitor
 * naming a switched-off platform passes every shape check, reads as startable,
 * and then collects nothing at 02:00 with nobody told why. This is the sentence
 * that refuses it instead.
 *
 * Absent `sources` means the body is not changing them, so there is nothing to
 * refuse: an edit that only moves a threshold must not fail over a platform the
 * monitor already names.
 */
export function switchedOffSources(
  sources: readonly ConnectorDescriptor[],
  named: readonly string[] | undefined,
): string | null {
  const reasons = (named ?? [])
    .map((id) => notOfferedReason(sources, id))
    .filter((reason): reason is string => reason !== null);

  return reasons.length === 0 ? null : [...new Set(reasons)].join(" ");
}

export function monitorEnvironment(
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
export function replySettings(body: { includeReplies?: boolean }) {
  return body.includeReplies === undefined ? {} : { includeReplies: body.includeReplies };
}

export function filterSettings(body: {
  preFilter?: { enabled?: boolean; similarityThreshold?: number };
}) {
  return {
    ...(body.preFilter?.enabled === undefined ? {} : { preFilterEnabled: body.preFilter.enabled }),
    ...(body.preFilter?.similarityThreshold === undefined
      ? {}
      : { similarityThreshold: body.preFilter.similarityThreshold }),
  };
}

/**
 * Everything read *about* a monitor rather than off its row.
 *
 * One object rather than nine positional arguments. Both paths below fill it,
 * and each field is named where it is passed — which matters here because
 * several of them are counts, and a pair swapped by hand would type-check and
 * report the filter's drops as the classifier's reads.
 */
export interface MonitorReadings {
  readonly state: BudgetState;
  readonly dropped: FilterDropCounts;
  readonly read: number;
  readonly verdicts: VerdictCounts;
  /** How many matches this monitor holds, and how many are unread. US-109. */
  readonly matches: MatchCounts;
  readonly collected: readonly LastCollection[];
  readonly notificationProblems: readonly string[];
  readonly lastPoll: PollRun | null;
  /** What the worker holds for this monitor now, or null. US-265. */
  readonly stage: MonitorStage | null;
}

export function toResponse(
  monitor: Monitor & { projectName?: string | null },
  runtime: MonitorEnvironment,
  readings: MonitorReadings,
) {
  const { state, dropped, read, verdicts, collected, notificationProblems, lastPoll, stage } =
    readings;

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
    lastPoll: lastPoll ? toPollRunResponse(lastPoll) : null,
    stage,
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
    /** US-109. The list's one measure of whether any of this produced anything. */
    matches: readings.matches,
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
export async function readResponse(db: Database, monitor: Monitor, runtime: MonitorEnvironment) {
  const [state, drops, read, verdicts, found, collected, notifications, polls, stages] =
    await Promise.all([
      checkOwnedBudget(db, monitor.userId, monitor.id),
      filterDropCounts(db, [monitor.id]),
      classifiedPostCounts(db, [monitor.id]),
      verdictCounts(db, [monitor.id]),
      matchCounts(db, [monitor.id]),
      lastCollections(db),
      notificationIssues(db),
      latestPollRuns(db, monitor.userId, [monitor.id]),
      monitorStages(db, [monitor.id]),
    ]);

  return toResponse(monitor, runtime, {
    state,
    dropped: drops.get(monitor.id) ?? noFilterDrops,
    read: read.get(monitor.id) ?? 0,
    verdicts: verdicts.get(monitor.id) ?? noVerdicts,
    matches: found.get(monitor.id) ?? noMatchCounts,
    collected: collected.get(monitor.id) ?? [],
    notificationProblems: notifications.get(monitor.id) ?? [],
    lastPoll: polls.get(monitor.id) ?? null,
    stage: stages.get(monitor.id) ?? null,
  });
}

/**
 * What every route group is handed. US-265.
 *
 * Built once per registration and read per request: `generatorFor` and
 * `currentEnvironment` are calls, not values, for the reasons written on
 * each, so a key or a provider choice written while the process runs is what
 * the next request sees.
 */
export interface MonitorContext {
  readonly db: Database;
  readonly options: MonitorRoutesOptions;
  readonly generatorFor: (userId: string) => Promise<QueryGenerator | null>;
  readonly currentEnvironment: (userId: string) => Promise<MonitorEnvironment>;
}

export function createMonitorContext(options: MonitorRoutesOptions): MonitorContext {
  const { db, queryGenerator, queryGeneratorFor } = options;

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
      readProviderChoices(db, userId),
    ]);

    return monitorEnvironment(options, storedCredentials, providerChoices);
  }

  return { db, options, generatorFor, currentEnvironment };
}
