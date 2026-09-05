/**
 * A cost test, as rows and as the answer a person reads.
 *
 * The run is a table and not one long HTTP request because the sample is
 * bought before it is read. Bright Data bills a collection when it is
 * triggered and serves it about two minutes later, so a person who closes the
 * tab has already paid; the row is what keeps their money's worth. It is the
 * same reasoning as `worker/continuations.ts`, and BUG-001 is what its absence
 * cost.
 *
 * `worker/estimate.ts` advances a run. This file writes it down and reads it
 * back, and `estimate.ts` holds the arithmetic neither of them may repeat.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  type EstimateProbeKind,
  type EstimateStatus,
  queryEstimateProbes,
  queryEstimates,
  type Source,
} from "../db/schema.js";
import type { ConnectorDescriptor } from "../sources/types.js";
import {
  type EstimateSample,
  type EstimateTotals,
  exceedsCap,
  type ProbeRequest,
  type Projection,
  projectMonthly,
  samplePostsPerProbe,
  sampleWindowDays,
  totalsFor,
} from "./estimate.js";

/** One query, run once against one source. */
export interface EstimateProbe {
  readonly id: string;
  readonly source: Source;
  readonly kind: EstimateProbeKind;
  readonly term: string;
  readonly status: EstimateStatus;
  /** Opaque, from the connector that issued it. */
  readonly cursor: string | null;
  readonly resumeAfter: Date | null;
  readonly attempts: number;
  readonly units: number;
  readonly estimatedCostMicros: number;
  readonly postsFound: number;
  readonly capped: boolean;
  readonly oldestPostAt: Date | null;
  readonly newestPostAt: Date | null;
  readonly samples: readonly EstimateSample[];
  readonly error: string | null;
}

export interface EstimateRun {
  readonly id: string;
  /** Null for a plan that is still a plan. That is the common case. */
  readonly monitorId: string | null;
  readonly status: EstimateStatus;
  readonly pollIntervalSeconds: number;
  readonly monthlyCapMicros: number | null;
  /** What the test itself consumed and cost, summed from its probes. */
  readonly units: number;
  readonly estimatedCostMicros: number;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly probes: readonly EstimateProbe[];
}

export interface StartEstimateInput {
  readonly monitorId?: string | null;
  readonly pollIntervalSeconds: number;
  readonly monthlyCapMicros?: number | null;
  readonly probes: readonly ProbeRequest[];
}

/** The `samples` column is `jsonb`, so its type is a promise rather than a fact. */
function readSamples(value: unknown): EstimateSample[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (entry): entry is EstimateSample =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as EstimateSample).url === "string",
  );
}

export async function startEstimate(
  db: Database,
  { monitorId = null, pollIntervalSeconds, monthlyCapMicros = null, probes }: StartEstimateInput,
): Promise<string> {
  if (probes.length === 0) {
    throw new Error("A cost test needs at least one query or subreddit to run.");
  }

  const [run] = await db
    .insert(queryEstimates)
    .values({ monitorId, pollIntervalSeconds, monthlyCapMicros })
    .returning({ id: queryEstimates.id });

  if (!run) throw new Error("The cost test was not inserted.");

  await db
    .insert(queryEstimateProbes)
    .values(probes.map((probe, position) => ({ estimateId: run.id, position, ...probe })));

  return run.id;
}

export async function readEstimate(db: Database, id: string): Promise<EstimateRun | undefined> {
  const [row] = await db.select().from(queryEstimates).where(eq(queryEstimates.id, id)).limit(1);
  if (!row) return undefined;

  // In the plan's own order, because this list is a screen: a plan whose lines
  // moved between two reads would read as a different plan.
  const probes = await db
    .select()
    .from(queryEstimateProbes)
    .where(eq(queryEstimateProbes.estimateId, id))
    .orderBy(asc(queryEstimateProbes.position));

  return {
    id: row.id,
    monitorId: row.monitorId,
    status: row.status,
    pollIntervalSeconds: row.pollIntervalSeconds,
    monthlyCapMicros: row.monthlyCapMicros,
    units: row.units,
    estimatedCostMicros: row.estimatedCostMicros,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    probes: probes.map((probe) => ({
      id: probe.id,
      source: probe.source,
      kind: probe.kind,
      term: probe.term,
      status: probe.status,
      cursor: probe.cursor,
      resumeAfter: probe.resumeAfter,
      attempts: probe.attempts,
      units: probe.units,
      estimatedCostMicros: probe.estimatedCostMicros,
      postsFound: probe.postsFound,
      capped: probe.capped,
      oldestPostAt: probe.oldestPostAt,
      newestPostAt: probe.newestPostAt,
      samples: readSamples(probe.samples),
      error: probe.error,
    })),
  };
}

/** What one call to a source did to a probe. The step decides it; this writes it. */
export interface ProbeProgress {
  readonly status: EstimateStatus;
  readonly cursor?: string | null;
  readonly resumeAfter?: Date | null;
  /** True for a resume that brought nothing back. Progress clears the count. */
  readonly attempted?: boolean;
  readonly units?: number;
  readonly estimatedCostMicros?: number;
  readonly postsFound?: number;
  readonly capped?: boolean;
  readonly oldestPostAt?: Date | null;
  readonly newestPostAt?: Date | null;
  readonly samples?: readonly EstimateSample[];
  readonly error?: string | null;
}

/**
 * Record where a probe got to.
 *
 * `units` and the cost are added rather than replaced, because a probe that
 * waited through three resumes was billed by whichever of them the provider
 * charged for. A write that replaced them would lose every charge but the
 * last, and the number this feature exists to report would be too small.
 */
export async function recordProbeProgress(
  db: Database,
  probeId: string,
  progress: ProbeProgress,
): Promise<void> {
  await db
    .update(queryEstimateProbes)
    .set({
      status: progress.status,
      ...(progress.cursor === undefined ? {} : { cursor: progress.cursor }),
      ...(progress.resumeAfter === undefined ? {} : { resumeAfter: progress.resumeAfter }),
      ...(progress.attempted === undefined
        ? {}
        : {
            attempts: progress.attempted ? sql`${queryEstimateProbes.attempts} + 1` : 0,
          }),
      ...(progress.units === undefined
        ? {}
        : { units: sql`${queryEstimateProbes.units} + ${progress.units}` }),
      ...(progress.estimatedCostMicros === undefined
        ? {}
        : {
            estimatedCostMicros: sql`${queryEstimateProbes.estimatedCostMicros} + ${progress.estimatedCostMicros}`,
          }),
      ...(progress.postsFound === undefined ? {} : { postsFound: progress.postsFound }),
      ...(progress.capped === undefined ? {} : { capped: progress.capped }),
      ...(progress.oldestPostAt === undefined ? {} : { oldestPostAt: progress.oldestPostAt }),
      ...(progress.newestPostAt === undefined ? {} : { newestPostAt: progress.newestPostAt }),
      ...(progress.samples === undefined ? {} : { samples: [...progress.samples] }),
      ...(progress.error === undefined ? {} : { error: progress.error }),
      updatedAt: sql`now()`,
    })
    .where(eq(queryEstimateProbes.id, probeId));
}

/**
 * Close a run and total up what it spent.
 *
 * The totals are summed from the probe rows rather than accumulated as the
 * step goes. A step that added as it went would double a charge on a retry,
 * and a retry is what a queue does with a job that threw.
 */
export async function finishEstimate(
  db: Database,
  id: string,
  error: string | null = null,
): Promise<void> {
  const [totals] = await db
    .select({
      units: sql<string>`coalesce(sum(${queryEstimateProbes.units}), 0)`,
      cost: sql<string>`coalesce(sum(${queryEstimateProbes.estimatedCostMicros}), 0)`,
      ready: sql<string>`count(*) filter (where ${queryEstimateProbes.status} = 'ready')`,
    })
    .from(queryEstimateProbes)
    .where(eq(queryEstimateProbes.estimateId, id));

  // A run is only failed when nothing in it worked. One query that the source
  // refused is a line on the screen with a reason, not a lost test: the other
  // queries were paid for and their numbers are worth reading.
  const nothingWorked = Number(totals?.ready ?? 0) === 0;

  await db
    .update(queryEstimates)
    .set({
      status: nothingWorked ? "failed" : "ready",
      units: Number(totals?.units ?? 0),
      estimatedCostMicros: Number(totals?.cost ?? 0),
      ...(error === null ? {} : { error }),
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(queryEstimates.id, id));
}

/** Stop a run before it reaches a source. The budget guard is the caller. */
export async function refuseEstimate(db: Database, id: string, reason: string): Promise<void> {
  await db
    .update(queryEstimateProbes)
    .set({ status: "failed", error: reason, updatedAt: sql`now()` })
    .where(
      and(eq(queryEstimateProbes.estimateId, id), eq(queryEstimateProbes.status, "collecting")),
    );

  await db
    .update(queryEstimates)
    .set({ status: "failed", error: reason, finishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(queryEstimates.id, id));
}

/** One line of the answer: what this query finds, what it would cost, and whether it fits. */
export interface ProbeReport {
  readonly source: Source;
  readonly sourceName: string;
  readonly kind: EstimateProbeKind;
  readonly term: string;
  readonly status: EstimateStatus;
  /** Posts inside the window. The volume answer, and never the cost one. */
  readonly postsFound: number;
  /** What the source charged for this one search. The cost answer. */
  readonly unitsBilled: number;
  /** True when the source billed everything the sample asked for, so there was more. */
  readonly capped: boolean;
  readonly postsPerDay: number;
  readonly monthlyUnitsLow: number;
  readonly monthlyUnitsHigh: number;
  /** Null when this source charges nothing. The two are equal unless `capped`. */
  readonly monthlyCostMicrosLow: number | null;
  readonly monthlyCostMicrosHigh: number | null;
  readonly billableUnit: string;
  readonly overCap: boolean;
  readonly samples: readonly EstimateSample[];
  readonly error: string | null;
}

export interface EstimateReport {
  readonly id: string;
  readonly monitorId: string | null;
  readonly status: EstimateStatus;
  readonly pollIntervalSeconds: number;
  /** The days a sample looked back over, so the screen can say what it measured. */
  readonly windowDays: number;
  /** What the test itself consumed and cost. Estimated, like every figure here. */
  readonly testUnits: number;
  readonly testCostMicros: number;
  readonly queries: readonly ProbeReport[];
  readonly totals: EstimateTotals;
  readonly error: string | null;
  readonly finishedAt: Date | null;
}

/**
 * Turn a run into the answer.
 *
 * The projection needs three facts from the connector — its price, what one
 * query may collect in a poll, and the shortest window it can be asked for —
 * and a probe whose platform this build no longer ships has none of them. Such a
 * probe reports what it measured and no cost at all, rather than a cost
 * computed from a price we made up.
 */
export function reportFor(
  run: EstimateRun,
  descriptors: readonly ConnectorDescriptor[],
): EstimateReport {
  const window = { windowDays: sampleWindowDays };
  const projections: Projection[] = [];

  const queries = run.probes.map((probe): ProbeReport => {
    const descriptor = descriptors.find((candidate) => candidate.platform.id === probe.source);

    const projection = descriptor
      ? projectMonthly(
          {
            postsFound: probe.postsFound,
            capped: probe.capped,
            unitsBilled: probe.units,
            // What this probe asked the source for. The sample's own size, so
            // "billed everything it asked for" is a comparison and not a guess.
            unitsAsked: samplePostsPerProbe,
            oldestPostAt: probe.oldestPostAt,
            newestPostAt: probe.newestPostAt,
          },
          {
            pollIntervalSeconds: run.pollIntervalSeconds,
            maxUnitsPerQueryPoll: descriptor.maxUnitsPerQueryPoll,
            pricePerUnitMicros: descriptor.pricePerUnitMicros,
          },
          window,
        )
      : {
          postsPerDay: 0,
          capped: false,
          unitsPerPollLow: 0,
          unitsPerPollHigh: 0,
          monthlyUnitsLow: 0,
          monthlyUnitsHigh: 0,
          monthlyCostMicrosLow: null,
          monthlyCostMicrosHigh: null,
        };

    // Only a probe that finished says anything about a month. One still
    // collecting has measured nothing yet, and one that failed measured
    // nothing at all; counting either as zero would read as "this query is
    // free" on the screen that decides whether to run it.
    if (probe.status === "ready") projections.push(projection);

    return {
      source: probe.source,
      sourceName: descriptor?.platform.displayName ?? probe.source,
      kind: probe.kind,
      term: probe.term,
      status: probe.status,
      postsFound: probe.postsFound,
      unitsBilled: probe.units,
      capped: projection.capped,
      postsPerDay: projection.postsPerDay,
      monthlyUnitsLow: projection.monthlyUnitsLow,
      monthlyUnitsHigh: projection.monthlyUnitsHigh,
      monthlyCostMicrosLow: probe.status === "ready" ? projection.monthlyCostMicrosLow : null,
      monthlyCostMicrosHigh: probe.status === "ready" ? projection.monthlyCostMicrosHigh : null,
      billableUnit: descriptor?.billableUnit ?? "unit",
      // The high end, for the reason `totalsFor` gives: a warning about money
      // is worth giving early, and the range is what lets a person disagree.
      overCap:
        probe.status === "ready" &&
        exceedsCap(projection.monthlyCostMicrosHigh, run.monthlyCapMicros),
      samples: probe.samples,
      error: probe.error,
    };
  });

  return {
    id: run.id,
    monitorId: run.monitorId,
    status: run.status,
    pollIntervalSeconds: run.pollIntervalSeconds,
    windowDays: sampleWindowDays,
    // Summed from the probes rather than read from the run, so a person
    // watching a test in progress is told what it has spent so far. The run's
    // own columns are the closed record, written when it finishes.
    testUnits: run.probes.reduce((total, probe) => total + probe.units, 0),
    testCostMicros: run.probes.reduce((total, probe) => total + probe.estimatedCostMicros, 0),
    queries,
    totals: totalsFor(projections, run.monthlyCapMicros),
    error: run.error,
    finishedAt: run.finishedAt,
  };
}
