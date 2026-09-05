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
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { monitors, type Signal, type Source } from "../db/schema.js";
import type { SourceDescriptor } from "../sources/types.js";
import { type MissingCredential, missingCredentials } from "../worker/credentials.js";

/** A monitor row, as Drizzle selects it. */
export type Monitor = typeof monitors.$inferSelect;

/**
 * Who owns a monitor until Better Auth creates the user table in US-017.
 *
 * A constant rather than a nullable column: the column is `NOT NULL` because
 * an unowned monitor is not a thing the product has, and a self-hosted
 * instance has exactly one account. US-017 replaces this with the session's
 * user and adds the foreign key; nothing else about these rows changes.
 */
export const singleUserId = "self-hosted";

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
  readonly queries: readonly string[];
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
   * `Source`, not a free connector id. `posts.source` can only hold a source
   * the schema names, so a monitor that named any other id would collect posts
   * that cannot be stored. The registry's id space is wider on purpose; this
   * column is the narrower one.
   */
  readonly sources: readonly Source[];
  readonly minScore?: number;
  readonly pollIntervalSeconds?: number;
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
  /** The connectors this build ships. Read for their credential fields. */
  readonly descriptors: readonly SourceDescriptor[];
  /** Where the keys live until US-004 encrypts them in the database. */
  readonly environment?: Record<string, string | undefined>;
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

export type ResumeResult =
  | { readonly status: "resumed"; readonly monitor: Monitor }
  | { readonly status: "blocked"; readonly missing: readonly MissingCredential[] };

/**
 * The generated queries as strings.
 *
 * The column is `jsonb`, so its type is a promise rather than a fact, and
 * every reader has to make the same decision about a value that is not a
 * string. One reader, so the poll and the API cannot disagree about what a
 * malformed row means.
 */
export function monitorQueries(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Which credentials the named sources need and the deployment does not have.
 *
 * A source the build does not ship contributes nothing here. That is not a
 * shrug: `createSourceRegistry` refuses to boot on an unknown id and
 * `posts.source` refuses to store one, so an unknown id cannot reach a poll,
 * and reporting it as a missing key would name a variable that would not help.
 */
export function startBlockers(
  sourceIds: readonly string[],
  { descriptors, environment = process.env }: MonitorEnvironment,
): MissingCredential[] {
  return sourceIds.flatMap((id) => {
    const descriptor = descriptors.find((candidate) => candidate.id === id);
    return descriptor ? missingCredentials(descriptor, environment) : [];
  });
}

export async function listMonitors(db: Database): Promise<Monitor[]> {
  return db.select().from(monitors).orderBy(desc(monitors.createdAt));
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
      userId: singleUserId,
      name: input.name,
      product: input.product,
      idealCustomer: input.idealCustomer,
      problem: input.problem,
      signals: [...input.signals],
      generatedQueries: [...input.queries],
      generatedSubreddits: [...input.subreddits],
      sources: [...input.sources],
      ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
      ...(input.pollIntervalSeconds === undefined
        ? {}
        : { pollIntervalSeconds: input.pollIntervalSeconds }),
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
    ...(input.queries === undefined ? {} : { generatedQueries: [...input.queries] }),
    ...(input.subreddits === undefined ? {} : { generatedSubreddits: [...input.subreddits] }),
    ...(input.sources === undefined ? {} : { sources: [...input.sources] }),
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
    ...(input.pollIntervalSeconds === undefined
      ? {}
      : { pollIntervalSeconds: input.pollIntervalSeconds }),
    ...(input.preFilterEnabled === undefined ? {} : { preFilterEnabled: input.preFilterEnabled }),
    ...(input.similarityThreshold === undefined
      ? {}
      : { similarityThreshold: input.similarityThreshold }),
  };

  if (Object.keys(changes).length === 0) return getMonitor(db, id);

  const [monitor] = await db
    .update(monitors)
    .set({ ...changes, updatedAt: new Date() })
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
