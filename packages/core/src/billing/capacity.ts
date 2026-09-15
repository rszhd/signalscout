/**
 * What the plan that lends the keys sells: a capacity, not an allowance.
 * US-133 holds the mechanism and US-134 the numbers.
 *
 * Correctness-critical: plan. The failure shape is an account polling on the
 * instance's keys past what the plan was priced for — six queries pointed at
 * the dearest platform, or LinkedIn polled six times a day — with nothing
 * refusing it but a fuse that blows inside a plan somebody paid for.
 *
 * **A customer buys watching, not dollars.** The dials they already set on the
 * monitor form are the ones they understand: how many monitors, how many
 * queries, how often it polls, which platforms. Those four are also what
 * decides our bill, so selling them costs nothing in control. What they do not
 * see is `ACCOUNT_MONTHLY_CAP_MICROS`, which stays as the deployment's fuse and
 * sits above everything here.
 *
 * **A query costs what its platform's provider charges, and the spread is
 * thirteen to one.** So the query limit is counted per platform and the poll
 * interval is per platform: three LinkedIn queries polled every four hours
 * were $27 of a $35 plan, and the same three polled daily are $4.50.
 *
 * The numbers are a price decision and will change, so each is read from the
 * environment beside `STRIPE_PRICE_ID` with US-134's figure as
 * the default. Nothing here knows what a plan is: `accountKeys.capacity`
 * decides whether an account has one at all, and which.
 */
import type { PlatformId } from "../sources/types.js";

export interface PlanCapacity {
  /** How many monitors the account may hold. */
  readonly monitors: number;
  /** How many projects the account may hold. */
  readonly projects: number;
  /** How many queries, in total across every platform of every monitor. */
  readonly queries: number;
  /**
   * A tighter limit for one platform, counted across the account. Absent
   * means the total above is the only bound. US-134: three on LinkedIn,
   * because a LinkedIn query is thirteen times a Reddit one.
   */
  readonly queriesPerPlatform: Readonly<Partial<Record<PlatformId, number>>>;
  /** The platforms the plan includes. A monitor naming another is refused. */
  readonly platforms: readonly PlatformId[];
  /**
   * The shortest interval at which each platform is polled, in seconds. A
   * source covered more recently than this is skipped before anything is
   * fetched, whatever the monitor's own interval says.
   */
  readonly pollIntervalSeconds: Readonly<Record<PlatformId, number>>;
  /**
   * Whether the plan reads comment threads. US-134 left this to be decided
   * here, and the decision is no: a thread page on Instagram is $0.04 and a
   * LinkedIn thread up to $0.10, and twenty-five threads a poll at those
   * prices is the plan's whole month in a day. A monitor asking for replies
   * on this plan is refused at the write, and the poll opens none.
   */
  readonly replies: boolean;
}

const hour = 60 * 60;

/**
 * The plan, as US-134 priced it on 2026-09-14: one project, one monitor, six
 * queries with at most three on LinkedIn, every platform, and an interval per
 * platform that keeps the dear ones cheap. The worst mix is about $9 of
 * fetching a month, a third of the price with the model.
 */
export const defaultPlanCapacity: PlanCapacity = {
  monitors: 1,
  projects: 1,
  queries: 6,
  queriesPerPlatform: { linkedin: 3 },
  platforms: ["reddit", "x", "linkedin", "youtube", "tiktok", "instagram"],
  pollIntervalSeconds: {
    reddit: 4 * hour,
    x: 4 * hour,
    youtube: 4 * hour,
    tiktok: 4 * hour,
    instagram: 12 * hour,
    linkedin: 24 * hour,
  },
  replies: false,
};

/**
 * The trial, which is smaller than the plan. US-134: four queries, polled
 * once a day, and neither Instagram nor LinkedIn — the two platforms that
 * could make seven free days cost more than the first month earns. Seven
 * daily polls of four queries is $0.11 to $0.22 of fetching.
 */
export const defaultTrialCapacity: PlanCapacity = {
  monitors: 1,
  projects: 1,
  queries: 4,
  queriesPerPlatform: {},
  platforms: ["reddit", "x", "youtube", "tiktok"],
  pollIntervalSeconds: {
    reddit: 24 * hour,
    x: 24 * hour,
    youtube: 24 * hour,
    tiktok: 24 * hour,
    instagram: 24 * hour,
    linkedin: 24 * hour,
  },
  replies: false,
};

/**
 * The variables a deployment may set, each with the default above.
 *
 *     KEYS_INCLUDED_MONITORS=1
 *     KEYS_INCLUDED_PROJECTS=1
 *     KEYS_INCLUDED_QUERIES=6
 *     KEYS_INCLUDED_QUERIES_LINKEDIN=3           one per platform, optional
 *     KEYS_INCLUDED_PLATFORMS=reddit,x,linkedin,youtube,tiktok,instagram
 *     KEYS_INCLUDED_POLL_SECONDS_LINKEDIN=86400  one per platform
 *
 * and the same under `KEYS_INCLUDED_TRIAL_` for the trial. A value that is not
 * a positive whole number is refused rather than read as the default, because
 * a typo that read as the default would sell a capacity nobody chose.
 */
export function planCapacityFrom(
  environment: Record<string, string | undefined>,
  defaults: PlanCapacity = defaultPlanCapacity,
  prefix = "KEYS_INCLUDED_",
): PlanCapacity {
  const platforms = listAt(environment, `${prefix}PLATFORMS`) ?? defaults.platforms;
  const every = [...new Set([...Object.keys(defaults.pollIntervalSeconds), ...platforms])];

  return {
    monitors: countAt(environment, `${prefix}MONITORS`) ?? defaults.monitors,
    projects: countAt(environment, `${prefix}PROJECTS`) ?? defaults.projects,
    queries: countAt(environment, `${prefix}QUERIES`) ?? defaults.queries,
    queriesPerPlatform: Object.fromEntries(
      every
        .map((platform) => [
          platform,
          countAt(environment, `${prefix}QUERIES_${variableName(platform)}`) ??
            defaults.queriesPerPlatform[platform],
        ])
        .filter(([, value]) => value !== undefined),
    ),
    platforms,
    pollIntervalSeconds: Object.fromEntries(
      every.map((platform) => [
        platform,
        countAt(environment, `${prefix}POLL_SECONDS_${variableName(platform)}`) ??
          defaults.pollIntervalSeconds[platform] ??
          defaultPlanCapacity.pollIntervalSeconds[platform] ??
          24 * hour,
      ]),
    ),
    replies: defaults.replies,
  };
}

/** Both capacities a deployment holds, read once at boot. */
export interface Capacities {
  readonly plan: PlanCapacity;
  readonly trial: PlanCapacity;
}

export function capacitiesFrom(environment: Record<string, string | undefined>): Capacities {
  return {
    plan: planCapacityFrom(environment, defaultPlanCapacity, "KEYS_INCLUDED_"),
    trial: planCapacityFrom(environment, defaultTrialCapacity, "KEYS_INCLUDED_TRIAL_"),
  };
}

function variableName(platform: string): string {
  return platform.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

function countAt(
  environment: Record<string, string | undefined>,
  name: string,
): number | undefined {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name}=${raw} is not a whole number of zero or more.`);
  }
  return value;
}

function listAt(
  environment: Record<string, string | undefined>,
  name: string,
): PlatformId[] | undefined {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

// ------------------------------------------------------------ the checks

/** The shape of one monitor, as a write or a row presents it. */
export interface MonitorShape {
  readonly sources: readonly string[];
  /** Queries keyed by platform, the shape `generated_queries` holds. */
  readonly queries: Readonly<Record<string, readonly string[]>>;
  readonly pollIntervalSeconds: number;
  readonly includeReplies: boolean;
}

/** What the account already holds, so a write can be judged against it. */
export interface AccountHoldings {
  /** Every other monitor of the account, the one being written excluded. */
  readonly otherMonitors: readonly MonitorShape[];
  /** How many projects the account holds, the one being written excluded. */
  readonly otherProjects: number;
}

/**
 * Why a write would put an account past its capacity, or null when it would
 * not. One sentence naming the plan and the number, so a person knows what to
 * change and by how much.
 *
 * Counted across the account and not the monitor: six queries on the dearest
 * platform is the case a per-monitor count misses. The monitor being written
 * is judged with the others, so an account that arrives over capacity keeps
 * what it has and may not add — an existing monitor is never refused by this,
 * only a write.
 */
export function capacityRefusal(
  capacity: PlanCapacity,
  monitor: MonitorShape,
  holdings: AccountHoldings,
  platformName: (id: string) => string = (id) => id,
): string | null {
  const plan = "Your plan";

  if (holdings.otherMonitors.length >= capacity.monitors) {
    return `${plan} includes ${plural(capacity.monitors, "monitor")}, and this account already has ${holdings.otherMonitors.length}.`;
  }

  const excluded = monitor.sources.filter((source) => !capacity.platforms.includes(source));
  if (excluded.length > 0) {
    return `${plan} does not include ${excluded.map(platformName).join(", ")}. It includes ${capacity.platforms.map(platformName).join(", ")}.`;
  }

  const all = [...holdings.otherMonitors, monitor];
  const total = all.reduce((sum, each) => sum + countQueries(each), 0);
  if (total > capacity.queries) {
    return `${plan} includes ${plural(capacity.queries, "query", "queries")} in total across your monitors, and this would make ${total}.`;
  }

  for (const [platform, limit] of Object.entries(capacity.queriesPerPlatform)) {
    if (limit === undefined) continue;
    const onPlatform = all.reduce((sum, each) => sum + (each.queries[platform]?.length ?? 0), 0);
    if (onPlatform > limit) {
      return `${plan} includes at most ${plural(limit, "query", "queries")} on ${platformName(platform)}, and this would make ${onPlatform}.`;
    }
  }

  const floor = pollFloorFor(capacity, monitor.sources);
  if (floor !== null && monitor.pollIntervalSeconds < floor) {
    const slowest = monitor.sources
      .map((source) => ({ source, seconds: capacity.pollIntervalSeconds[source] ?? 0 }))
      .sort((a, b) => b.seconds - a.seconds)[0];
    return `${plan} polls ${slowest ? platformName(slowest.source) : "this platform"} every ${describeInterval(floor)} at most. Choose an interval of ${describeInterval(floor)} or longer.`;
  }

  if (monitor.includeReplies && !capacity.replies) {
    return `${plan} does not read comment threads. Switch replies off for this monitor.`;
  }

  return null;
}

/**
 * The shortest interval a monitor naming these platforms may poll at: the
 * smallest of its platforms' floors, because the monitor's interval is the
 * cadence of the whole poll and each platform is then skipped until its own
 * floor has passed. Null where nothing is named.
 */
export function pollFloorFor(capacity: PlanCapacity, sources: readonly string[]): number | null {
  const floors = sources
    .map((source) => capacity.pollIntervalSeconds[source])
    .filter((seconds): seconds is number => typeof seconds === "number");
  return floors.length === 0 ? null : Math.min(...floors);
}

/**
 * The queries a poll may send for one platform: the first `limit` of them.
 *
 * The write refuses more, so this only ever trims a row that predates the
 * plan or a limit that was lowered. Trimming rather than refusing is the
 * "keeps what it has" rule: the monitor still polls, within what the plan
 * carries, and the spend it was priced on is what it can cause.
 */
export function queriesWithin(
  capacity: PlanCapacity,
  platform: string,
  queries: readonly string[],
): readonly string[] {
  const limit = Math.min(capacity.queriesPerPlatform[platform] ?? Infinity, capacity.queries);
  return queries.length > limit ? queries.slice(0, limit) : queries;
}

/**
 * Whether a platform is due under the plan, given when it was last covered.
 * A source with no coverage is due; one covered more recently than the
 * platform's floor is not, and is skipped before anything is fetched.
 */
export function platformDue(
  capacity: PlanCapacity,
  platform: string,
  coveredThrough: Date | undefined,
  now: Date,
): boolean {
  if (!coveredThrough) return true;
  const floor = capacity.pollIntervalSeconds[platform];
  if (floor === undefined) return true;
  return coveredThrough.getTime() + floor * 1000 <= now.getTime();
}

export function countQueries(monitor: MonitorShape): number {
  return Object.values(monitor.queries).reduce((sum, list) => sum + list.length, 0);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return plural(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return plural(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}
