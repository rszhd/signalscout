/**
 * Creating, editing, pausing and resuming a monitor.
 *
 * This is the write side of the four answers. It lives in `core` and not in a
 * Fastify route for the usual reason — the worker reads these rows too — and
 * for one specific to US-010: **a monitor that cannot poll must not start.**
 * A rule written in a route is a rule one caller enforces, and docs/testing.md
 * is blunt about what happens next. The rule is here, and the functions below
 * are shaped so that a caller who ignores the answer still cannot start a
 * monitor that has no key: `resume` clears `paused_at` only on the branch that
 * found no missing credential, and `create` sets it on the branch that did.
 *
 * The four answers and the generated queries are separate columns, which is
 * what lets `regenerate` replace the queries without a person retyping
 * anything. That separation is in the schema; this file is where it is used.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { monitors, projects, type Signal, type Source } from "../db/schema.js";
import type { ConnectorDescriptor, ProviderChoices } from "../sources/types.js";
import { type MissingCredential, missingCredentials } from "../worker/credentials.js";

/** A monitor row, as Drizzle selects it. */
export type Monitor = typeof monitors.$inferSelect;

/**
 * A monitor row, scoped to the person who owns it.
 *
 * US-017 replaced the `singleUserId` constant that used to sit here. The
 * column was always `NOT NULL`, so this is the same shape carrying a real id:
 * what changed is who fills it and who is allowed to read it back.
 *
 * There is deliberately no foreign key to `users`. A monitor may be older than
 * the first account — every instance that upgraded into US-017 has some — and
 * a constraint would refuse to apply the migration on exactly the instances
 * that have data worth keeping. `claimUnownedRows` is what closes the gap, at
 * the moment the account exists.
 */

/** What the person typed. PLAN.md, *Monitor creation*. */
export interface MonitorAnswers {
  readonly name: string;
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
  readonly signals: readonly Signal[];
}

/** What the model wrote, after the person edited it. */
export interface MonitorPlan {
  readonly queries: MonitorQueries;
  readonly subreddits: readonly string[];
}

/**
 * The pre-filter settings a caller may write.
 *
 * Both are on the monitor because the right answer is a judgement about one
 * product's market, like `minScore`. `preFilterEnabled` is false for the
 * person who suspects the filter is hiding something: a filter that cannot be
 * turned off cannot be found out.
 */
export interface MonitorFilterSettings {
  readonly preFilterEnabled?: boolean;
  /** Cosine similarity, 0 to 1. Zero keeps everything the keyword stage kept. */
  readonly similarityThreshold?: number;
}

export interface CreateMonitorInput extends MonitorAnswers, MonitorPlan, MonitorFilterSettings {
  /**
   * Who this monitor belongs to. US-017.
   *
   * Required, with no default. A default here would be one word in one file
   * deciding that every monitor an instance ever makes belongs to the same
   * person, which is precisely the state this ticket left behind.
   */
  readonly userId: string;
  /**
   * `Source`, not a free connector id. `posts.source` can only hold a source
   * the schema names, so a monitor that named any other id would collect posts
   * that cannot be stored. The registry's id space is wider on purpose; this
   * column is the narrower one.
   */
  readonly sources: readonly Source[];
  /**
   * The project these answers were copied from. US-045.
   *
   * Provenance and grouping, not a link: the four answers are already on this
   * input, and the monitor keeps whatever they were when it was made. Absent
   * is the normal state.
   */
  readonly projectId?: string;
  readonly minScore?: number;
  readonly pollIntervalSeconds?: number;
  /** Which days it may poll on. Postgres numbering, 0 is Sunday. US-041. */
  readonly pollDays?: readonly number[];
  /** The IANA zone the days are counted in. US-041. */
  readonly pollTimezone?: string;
  /**
   * Save the monitor without starting it, even when it could start.
   *
   * US-014: a person whose cost test says the plan would cost more than the
   * cap may still want to keep it. Keeping it and starting it are two
   * decisions, and this is the first one on its own. `resumeMonitor` is the
   * second, and it applies the credential rule the same as ever.
   */
  readonly startPaused?: boolean;
}

/** Everything the rules below need to know about the deployment. */
export interface MonitorEnvironment {
  /** The connectors this build ships. Read for their providers' credential fields. */
  readonly descriptors: readonly ConnectorDescriptor[];
  /**
   * The environment half of where a key lives. `source_credentials` is the
   * other half, and `storedCredentials` below is what it holds.
   */
  readonly environment?: Record<string, string | undefined>;
  /**
   * Which credentials the database holds, as `provider:field` names.
   *
   * The set rather than the table, because these rules are synchronous and a
   * caller that is already loading a page can read the hints once instead of
   * once per source. `listCredentialHints` never decrypts, so building this
   * costs no key.
   */
  readonly storedCredentials?: ReadonlySet<string>;
  /**
   * Which provider fetches each platform, as somebody recorded it.
   *
   * Read so that this file and the poll agree. Without it a monitor whose
   * platform is set to a provider with no key would look startable here and
   * refuse at every poll, which is the failure US-010 wrote these rules to
   * prevent, one axis further along.
   */
  readonly providerChoices?: ProviderChoices;
}

export interface CreatedMonitor {
  readonly monitor: Monitor;
  /**
   * Empty when the monitor started. Otherwise the monitor exists, is paused,
   * and these are the credentials that have to be set before it can run.
   *
   * Refusing to create it instead would throw away four answers a person just
   * typed, over a key they can paste in a minute. Creating it running would be
   * a monitor that logs the same missing key every hour for ever.
   */
  readonly missing: readonly MissingCredential[];
}

/**
 * Queries as a caller supplies them: one list per platform, keyed by platform
 * id. A platform with no key is a platform this monitor searches with nothing,
 * which is what a monitor that watches only the other one wants.
 */
export type MonitorQueries = Readonly<Record<string, readonly string[]>>;

/** Stored as a plain object, so a row is readable and a key is a platform id. */
function queriesToStore(queries: MonitorQueries): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(queries).map(([platform, list]) => [platform, [...list]]),
  );
}

export type ResumeResult =
  | { readonly status: "resumed"; readonly monitor: Monitor }
  | { readonly status: "blocked"; readonly missing: readonly MissingCredential[] };

/**
 * The generated queries, keyed by the platform they were written for.
 *
 * The column is `jsonb`, so its type is a promise rather than a fact, and
 * every reader has to make the same decision about a value that is not a
 * string. One reader, so the poll and the API cannot disagree about what a
 * malformed row means.
 *
 * Two shapes are accepted, and the older one is not a mistake to clean up
 * later. Until US-027 the column held one list for every platform, and
 * migration 0021 keys those rows by the platforms their monitor watches. A row
 * the migration could not key — a monitor that names no platform — is still an
 * array, and it still polls nothing, so reading it as "these queries are for
 * whatever you asked about" costs nothing and loses nothing.
 */
export function monitorQueryPlan(value: unknown): Record<string, string[]> {
  if (Array.isArray(value)) return {};
  if (typeof value !== "object" || value === null) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([platform, list]) => [
      platform,
      stringsOf(list),
    ]),
  );
}

/**
 * One platform's queries.
 *
 * The platform is required, because the whole point of US-027 is that a query
 * belongs somewhere. A caller that wants every query for a person to read is
 * asking a different question, and `allMonitorQueries` answers that one.
 */
export function monitorQueries(value: unknown, platform: string): string[] {
  if (Array.isArray(value)) return stringsOf(value);

  return monitorQueryPlan(value)[platform] ?? [];
}

/**
 * Every query a monitor holds, in one list.
 *
 * For a reader that is describing the monitor rather than searching with it:
 * a screen, a log line, a count. Never for building a search — one platform's
 * phrasing sent to another platform's search is the bug this all exists to
 * stop.
 */
export function allMonitorQueries(value: unknown): string[] {
  if (Array.isArray(value)) return stringsOf(value);

  return Object.values(monitorQueryPlan(value)).flat();
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Which credentials the named sources need and the deployment does not have.
 *
 * A platform the build has no connector for contributes nothing here. That is
 * not a shrug: `createSourceRegistry` refuses to boot on an unknown id and
 * `posts.source` refuses to store one, so an unknown id cannot reach a poll,
 * and reporting it as a missing key would name a variable that would not help.
 */
export function startBlockers(
  sourceIds: readonly string[],
  {
    descriptors,
    environment = process.env,
    storedCredentials,
    providerChoices = {},
  }: MonitorEnvironment,
): MissingCredential[] {
  return sourceIds.flatMap((id) => {
    const all = descriptors.filter((candidate) => candidate.platform.id === id);

    // A recorded choice narrows the question to one provider. Reading the
    // other one's key as an answer here would report a monitor as startable
    // that every poll then refuses, because `only` obeys the choice or
    // refuses and never falls back to the provider nobody picked.
    const chosen = providerChoices[id];
    const connectors = chosen ? all.filter((candidate) => candidate.provider.id === chosen) : all;

    const blockers = (connectors.length > 0 ? connectors : all).map((connector) =>
      missingCredentials(connector, environment, storedCredentials),
    );

    // One usable connector is enough to poll a platform, so a platform is
    // blocked only when every connector for it is. With one provider per
    // platform this is the old rule exactly; with two it is the rule that
    // stays right, and it fails towards letting a monitor run rather than
    // demanding a key for a provider the person does not use.
    if (blockers.some((missing) => missing.length === 0)) return [];

    return blockers.flat();
  });
}

/**
 * Whether a platform will actually return replies on this deployment. US-020.
 *
 * The question the monitor form has to answer is not "does the build ship a
 * connector that can read replies" but "will the connector that runs here read
 * them". Those differ the moment a platform has two providers and only one of
 * them can: a build shipping both Reddit connectors would otherwise promise
 * replies to an instance holding the key of the one that cannot, and the person
 * would tick the box and be given none, silently.
 *
 * So this follows the same narrowing `startBlockers` does — a recorded choice
 * first, then the connectors whose credentials are present — and answers about
 * those. A platform with nothing usable answers from the build instead, because
 * a fresh install with no keys should still be told the truth about what it
 * could do.
 */
export function canFetchRepliesFor(
  sourceIds: readonly string[],
  {
    descriptors,
    environment = process.env,
    storedCredentials,
    providerChoices = {},
  }: MonitorEnvironment,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};

  for (const id of sourceIds) {
    const all = descriptors.filter((candidate) => candidate.platform.id === id);
    const chosen = providerChoices[id];
    const connectors = chosen ? all.filter((candidate) => candidate.provider.id === chosen) : all;
    const considered = connectors.length > 0 ? connectors : all;

    const usable = considered.filter(
      (connector) => missingCredentials(connector, environment, storedCredentials).length === 0,
    );

    out[id] = (usable.length > 0 ? usable : considered).some(
      (connector) => connector.canFetchReplies === true,
    );
  }

  return out;
}

/**
 * The missing credentials as one sentence fragment a person can act on.
 *
 * Fields of one provider are joined with "and", because that account needs
 * both. Providers are joined with "or", because a platform two providers fetch
 * needs one of them and not both — and "and" there would tell a person to open
 * an account they do not need. US-026.
 */
export function describeMissingCredentials(missing: readonly MissingCredential[]): string {
  const byProvider = new Map<string, string[]>();

  for (const credential of missing) {
    const names = byProvider.get(credential.providerId) ?? [];
    names.push(credential.environmentVariable);
    byProvider.set(credential.providerId, names);
  }

  return [...byProvider.values()].map((names) => names.join(" and ")).join(" or ");
}

/**
 * A monitor with the name of the project it came out of, when it has one.
 *
 * US-045. The name rather than only the id, because the list groups by project
 * and a heading reading a uuid helps nobody. Null on a monitor made before
 * projects existed, or made outside one — which is the normal state and must
 * stay visible rather than disappearing into a group nobody made.
 */
export interface MonitorWithProject extends Monitor {
  readonly projectName: string | null;
}

export async function listMonitors(db: Database, userId: string): Promise<MonitorWithProject[]> {
  const rows = await db
    .select({ monitor: monitors, projectName: projects.name })
    .from(monitors)
    .leftJoin(projects, eq(projects.id, monitors.projectId))
    .where(eq(monitors.userId, userId))
    .orderBy(desc(monitors.createdAt));

  return rows.map((row) => ({ ...row.monitor, projectName: row.projectName }));
}

export async function getMonitor(db: Database, id: string): Promise<Monitor | undefined> {
  const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id)).limit(1);
  return monitor;
}

export async function createMonitor(
  db: Database,
  input: CreateMonitorInput,
  runtime: MonitorEnvironment,
): Promise<CreatedMonitor> {
  const missing = startBlockers(input.sources, runtime);

  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: input.userId,
      name: input.name,
      product: input.product,
      idealCustomer: input.idealCustomer,
      problem: input.problem,
      signals: [...input.signals],
      generatedQueries: queriesToStore(input.queries),
      generatedSubreddits: [...input.subreddits],
      sources: [...input.sources],
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
      ...(input.pollDays === undefined ? {} : { pollDays: [...input.pollDays] }),
      ...(input.pollTimezone === undefined ? {} : { pollTimezone: input.pollTimezone }),
      ...(input.pollIntervalSeconds === undefined
        ? {}
        : { pollIntervalSeconds: input.pollIntervalSeconds }),
      ...(input.pollDays === undefined ? {} : { pollDays: [...input.pollDays] }),
      ...(input.pollTimezone === undefined ? {} : { pollTimezone: input.pollTimezone }),
      ...(input.preFilterEnabled === undefined ? {} : { preFilterEnabled: input.preFilterEnabled }),
      ...(input.similarityThreshold === undefined
        ? {}
        : { similarityThreshold: input.similarityThreshold }),
      // Created paused when it could not poll anyway, or when the person
      // asked for it. Never started against either.
      pausedAt: missing.length > 0 || input.startPaused ? new Date() : null,
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not inserted.");

  return { monitor, missing };
}

/**
 * What an edit may change.
 *
 * Not `paused_at`: pausing and resuming are their own functions because
 * resuming has a rule, and an update that could write the column would be a
 * second way to start a monitor with no key.
 */
export interface UpdateMonitorInput
  extends Partial<MonitorAnswers>,
    Partial<MonitorPlan>,
    MonitorFilterSettings {
  readonly sources?: readonly Source[];
  readonly minScore?: number;
  readonly pollIntervalSeconds?: number;
  /** Which days it may poll on. Postgres numbering, 0 is Sunday. US-041. */
  readonly pollDays?: readonly number[];
  /** The IANA zone the days are counted in. US-041. */
  readonly pollTimezone?: string;
}

/**
 * Whether an edit changes the definition the classifier judges against.
 *
 * The four fields here are exactly what `ai/prompt.ts` puts in the system
 * prompt. An edit to any of them means a later verdict is about a different
 * question from an earlier one, and `monitors.version` is how the two are told
 * apart. A rename, a new poll interval, an edited query or a moved threshold
 * change what is collected or how often, not what a good lead is.
 *
 * A field sent back unchanged is not a change. The monitor form sends every
 * field it holds, so comparing values rather than counting keys is what keeps
 * "save" without an edit from invalidating the feedback already collected.
 */
export function redefinesTheMonitor(monitor: Monitor, input: UpdateMonitorInput): boolean {
  if (input.product !== undefined && input.product !== monitor.product) return true;
  if (input.idealCustomer !== undefined && input.idealCustomer !== monitor.idealCustomer) {
    return true;
  }
  if (input.problem !== undefined && input.problem !== monitor.problem) return true;

  if (input.signals !== undefined) {
    // Order is not meaning: a form that re-sends the same ticked boxes in a
    // different order has changed nothing.
    const before = [...monitor.signals].sort();
    const after = [...input.signals].sort();
    if (before.length !== after.length) return true;
    if (before.some((signal, index) => signal !== after[index])) return true;
  }

  return false;
}

export async function updateMonitor(
  db: Database,
  id: string,
  input: UpdateMonitorInput,
): Promise<Monitor | undefined> {
  const changes = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.product === undefined ? {} : { product: input.product }),
    ...(input.idealCustomer === undefined ? {} : { idealCustomer: input.idealCustomer }),
    ...(input.problem === undefined ? {} : { problem: input.problem }),
    ...(input.signals === undefined ? {} : { signals: [...input.signals] }),
    ...(input.queries === undefined ? {} : { generatedQueries: queriesToStore(input.queries) }),
    ...(input.subreddits === undefined ? {} : { generatedSubreddits: [...input.subreddits] }),
    ...(input.sources === undefined ? {} : { sources: [...input.sources] }),
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
    ...(input.pollDays === undefined ? {} : { pollDays: [...input.pollDays] }),
    ...(input.pollTimezone === undefined ? {} : { pollTimezone: input.pollTimezone }),
    ...(input.pollIntervalSeconds === undefined
      ? {}
      : { pollIntervalSeconds: input.pollIntervalSeconds }),
    ...(input.preFilterEnabled === undefined ? {} : { preFilterEnabled: input.preFilterEnabled }),
    ...(input.similarityThreshold === undefined
      ? {}
      : { similarityThreshold: input.similarityThreshold }),
  };

  if (Object.keys(changes).length === 0) return getMonitor(db, id);

  const current = await getMonitor(db, id);
  if (!current) return undefined;

  const [monitor] = await db
    .update(monitors)
    .set({
      ...changes,
      // Incremented in SQL rather than from the row above, so two edits that
      // read the same version still leave two versions behind them.
      ...(redefinesTheMonitor(current, input) ? { version: sql`${monitors.version} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(monitors.id, id))
    .returning();

  return monitor;
}

/**
 * Stop polling this monitor, and change nothing else.
 *
 * Pausing an already paused monitor keeps the first timestamp. "Paused 3 days
 * ago" is what the monitor list shows, and a second press must not reset it to
 * today.
 */
export async function pauseMonitor(db: Database, id: string): Promise<Monitor | undefined> {
  const monitor = await getMonitor(db, id);
  if (!monitor || monitor.pausedAt) return monitor;

  const [paused] = await db
    .update(monitors)
    .set({ pausedAt: new Date(), updatedAt: new Date() })
    .where(eq(monitors.id, id))
    .returning();

  return paused;
}

/**
 * Start polling again, unless a credential is missing.
 *
 * Nothing else is written, so the monitor resumes with every post, match and
 * verdict it already had. The scheduler's next tick finds it due if its
 * interval has passed, which is the same rule as any other monitor: a pause is
 * not a reason to poll immediately, and a monitor paused for a month should
 * not start by collecting a month.
 */
export async function resumeMonitor(
  db: Database,
  id: string,
  runtime: MonitorEnvironment,
): Promise<ResumeResult | undefined> {
  const monitor = await getMonitor(db, id);
  if (!monitor) return undefined;

  const missing = startBlockers(monitor.sources, runtime);
  if (missing.length > 0) return { status: "blocked", missing };

  if (!monitor.pausedAt) return { status: "resumed", monitor };

  const [resumed] = await db
    .update(monitors)
    .set({ pausedAt: null, updatedAt: new Date() })
    .where(eq(monitors.id, id))
    .returning();

  if (!resumed) return undefined;

  return { status: "resumed", monitor: resumed };
}

export async function deleteMonitor(db: Database, id: string): Promise<boolean> {
  const deleted = await db.delete(monitors).where(eq(monitors.id, id)).returning({
    id: monitors.id,
  });

  return deleted.length > 0;
}
