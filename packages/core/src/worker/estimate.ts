/**
 * The cost test: run each query once, against a small sample.
 *
 * US-014. Read docs/sources.md before changing it, for the same reason
 * `collect.ts` says so — this is the second step that calls a real connector,
 * and it spends real money doing it.
 *
 * It is a queued step and not an HTTP handler because the sample is bought
 * before it can be read. Bright Data bills a collection when it is triggered
 * and serves it about two minutes later, so a person who closes the tab has
 * already paid. The run and its probes are the durable fact; this job is the
 * alarm clock that comes back for them. `continuations.ts` holds the same
 * shape for a poll, and BUG-001 is what its absence cost.
 *
 * Three limits bound what one test can spend. A probe asks for
 * `samplePostsPerProbe` posts, so eight queries cost about twelve cents at
 * Reddit's rate. `maxSamplePagesPerProbe` stops a source that hands back short
 * pages for ever. `maxEstimateAttempts` stops a collection that never becomes
 * ready. None of them is a performance setting.
 */
import { checkBudget, recordSourceUsage } from "../budget/budget.js";
import {
  type EstimateSample,
  maxEstimateAttempts,
  sampleExcerptLength,
  samplePostsPerProbe,
  samplesKept,
  sampleWindowDays,
} from "../estimate/estimate.js";
import {
  type EstimateProbe,
  finishEstimate,
  type ProbeProgress,
  readEstimate,
  recordProbeProgress,
  refuseEstimate,
} from "../estimate/runs.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { CandidatePost, SocialSource, SourceCredentials } from "../sources/types.js";
import type { CredentialLookup } from "./credentials.js";
import { type EstimatePayload, estimateQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

/**
 * Pages one probe may fetch before it answers with what it has.
 *
 * A sample is meant to be one page. Three is room for a connector that hands
 * back short pages — "a short page is not the last page", from the caller's
 * side — and a stop for one that would do so all day at the caller's expense.
 */
export const maxSamplePagesPerProbe = 3;

export interface EstimateOptions {
  readonly registry: SourceRegistry;
  readonly credentialsFor: CredentialLookup;
}

/** What one probe's sample measured, before any projection. */
interface Sample {
  readonly posts: readonly CandidatePost[];
  readonly unitsConsumed: number;
  /** The source stopped us rather than running out: there is more behind this. */
  readonly capped: boolean;
  /** Set when the source asked us to come back instead of answering. */
  readonly waitUntil?: Date;
  readonly waitCursor?: string | null;
}

/** The few posts a person reads to judge whether the volume is worth having. */
function samplesFrom(posts: readonly CandidatePost[]): EstimateSample[] {
  return [...posts]
    .sort((one, other) => other.postedAt.getTime() - one.postedAt.getTime())
    .slice(0, samplesKept)
    .map((post) => ({
      url: post.url,
      title: post.title ?? null,
      author: post.author ?? null,
      channel: post.channel ?? null,
      // Short on purpose: nothing re-checks a sample against the source, so
      // the less it holds the less there is to take down. US-015.
      excerpt: post.text.slice(0, sampleExcerptLength),
      postedAt: post.postedAt.toISOString(),
    }));
}

/**
 * Ask one source for one query's sample.
 *
 * The stopping rule reads `next`, never `posts.length`, and the cap on posts
 * is checked separately: a connector may answer "done" while our own limit is
 * what truncated the collection, which is exactly the Reddit case. So the
 * sample is capped when it came back full, whatever the source said next.
 */
async function takeSample(
  source: SocialSource,
  probe: EstimateProbe,
  credentials: SourceCredentials,
  since: Date,
  bill: (units: number) => Promise<void>,
): Promise<Sample> {
  const query = {
    queries: probe.kind === "query" ? [probe.term] : [],
    channels: probe.kind === "channel" ? [probe.term] : [],
    since,
  };

  const collected: CandidatePost[] = [];
  let unitsConsumed = 0;
  let cursor = probe.cursor ?? undefined;
  let pages = 0;
  let more = true;

  while (pages < maxSamplePagesPerProbe && collected.length < samplePostsPerProbe) {
    const result = await source.search({
      query,
      credentials,
      limit: samplePostsPerProbe - collected.length,
      ...(cursor === undefined ? {} : { cursor }),
    });

    pages += 1;
    unitsConsumed += result.unitsConsumed;
    collected.push(...result.posts);
    await bill(result.unitsConsumed);

    if (result.next.status === "wait") {
      // The collection is running at the provider and was billed when it
      // started. The cursor travels back to the row before this job ends.
      return {
        posts: collected,
        unitsConsumed,
        capped: false,
        waitUntil: result.next.retryAfter,
        waitCursor: result.next.cursor ?? null,
      };
    }

    if (result.next.status === "done") {
      more = false;
      break;
    }

    cursor = result.next.cursor;
  }

  return {
    posts: collected,
    unitsConsumed,
    // Full, or stopped with more behind it. Either way the rate this measures
    // is a floor and the projection has to say so.
    capped: collected.length >= samplePostsPerProbe || more,
  };
}

function measurementOf(
  posts: readonly CandidatePost[],
): Pick<ProbeProgress, "postsFound" | "oldestPostAt" | "newestPostAt"> {
  const times = posts.map((post) => post.postedAt.getTime());

  return {
    postsFound: posts.length,
    oldestPostAt: times.length > 0 ? new Date(Math.min(...times)) : null,
    newestPostAt: times.length > 0 ? new Date(Math.max(...times)) : null,
  };
}

export function createEstimateStep({
  registry,
  credentialsFor,
}: EstimateOptions): Step<EstimatePayload> {
  return async function estimate({ estimateId }, { db, boss, logger }: StepContext): Promise<void> {
    const run = await readEstimate(db, estimateId);

    if (!run) {
      logger.warn({ estimateId }, "cost test skipped: the run is gone");
      return;
    }

    if (run.status !== "collecting") {
      logger.debug({ estimateId, status: run.status }, "cost test skipped: it is finished");
      return;
    }

    /**
     * The budget guard, before any source is reached.
     *
     * docs/testing.md counts this as the guard's third caller, and a rule is
     * only as tested as its least-tested caller. `checkBudget` rather than
     * `enforceBudget`: a person pressing a button must not pause the monitor
     * they were about to test. The poll's guard is what pauses it.
     *
     * A test of a plan that has no monitor yet passes here, because there is
     * no cap to read. That is the honest shape of it — the cap belongs to a
     * monitor, and this money is spent before one exists. docs/costs.md says
     * so to the user.
     */
    if (run.monitorId) {
      const budget = await checkBudget(db, run.monitorId);

      if (budget.exhausted) {
        logger.error(
          { estimateId, monitorId: run.monitorId, spentMicros: budget.spend.totalMicros },
          budget.reason ?? "cost test refused: this monitor has spent its monthly budget",
        );
        await refuseEstimate(db, estimateId, budget.reason ?? "This monitor has no budget left.");
        return;
      }
    }

    const now = new Date();
    const since = new Date(now.getTime() - sampleWindowDays * 24 * 60 * 60 * 1000);

    /** The earliest moment any probe asked to be tried again. */
    let wakeAt: Date | undefined;
    const wakeNoLaterThan = (moment: Date) => {
      if (!wakeAt || moment < wakeAt) wakeAt = moment;
    };

    for (const probe of run.probes) {
      if (probe.status !== "collecting") continue;

      if (probe.resumeAfter && probe.resumeAfter > now) {
        wakeNoLaterThan(probe.resumeAfter);
        continue;
      }

      if (probe.attempts >= maxEstimateAttempts) {
        // The sample never became ready. Saying so beats a spinner that never
        // stops, and the money it cost is already recorded against the run.
        logger.error(
          { estimateId, term: probe.term, attempts: probe.attempts },
          "sample abandoned: it was never ready to read",
        );
        await recordProbeProgress(db, probe.id, {
          status: "failed",
          error: "The source never finished collecting this sample. Try again in a few minutes.",
        });
        continue;
      }

      let source: SocialSource;
      try {
        source = registry.get(probe.source);
      } catch (error) {
        await recordProbeProgress(db, probe.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const credentials = await credentialsFor(source);

      if (!credentials) {
        // Not transient, and not worth a retry. The sentence names what to
        // set, which is the whole support channel in a bring-your-own-keys
        // product.
        await recordProbeProgress(db, probe.id, {
          status: "failed",
          error: `${source.displayName} has no credentials configured, so nothing can be sampled.`,
        });
        continue;
      }

      try {
        const sample = await takeSample(source, probe, credentials, since, (units) =>
          recordSourceUsage(db, {
            monitorId: run.monitorId,
            source: probe.source,
            units,
            pricePerUnitMicros: source.pricePerUnitMicros,
          }),
        );

        const spent = {
          units: sample.unitsConsumed,
          estimatedCostMicros: sample.unitsConsumed * source.pricePerUnitMicros,
        };

        if (sample.waitUntil) {
          wakeNoLaterThan(sample.waitUntil);
          await recordProbeProgress(db, probe.id, {
            status: "collecting",
            cursor: sample.waitCursor ?? null,
            resumeAfter: sample.waitUntil,
            attempted: sample.posts.length === 0,
            ...spent,
          });
          continue;
        }

        await recordProbeProgress(db, probe.id, {
          status: "ready",
          cursor: null,
          resumeAfter: null,
          attempted: false,
          capped: sample.capped,
          samples: samplesFrom(sample.posts),
          ...measurementOf(sample.posts),
          ...spent,
        });

        logger.info(
          {
            estimateId,
            source: probe.source,
            term: probe.term,
            posts: sample.posts.length,
            unitsConsumed: sample.unitsConsumed,
          },
          "sample taken",
        );
      } catch (error) {
        // One query the source refused is a line on the screen with a reason,
        // not a failed test: the other queries were paid for and their numbers
        // are worth reading. The connector already phrased this as something a
        // person can act on.
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ estimateId, term: probe.term, err: error }, "sample failed");
        await recordProbeProgress(db, probe.id, { status: "failed", error: message });
      }
    }

    const after = await readEstimate(db, estimateId);
    const stillCollecting = after?.probes.some((probe) => probe.status === "collecting") ?? false;

    if (!stillCollecting) {
      await finishEstimate(db, estimateId);
      return;
    }

    /**
     * Come back for the samples that are still collecting.
     *
     * The rows are written already, so a refused job is not a lost test: the
     * queue refuses precisely when a job for this run is queued, and that job
     * reads the same rows. Without one, though, the run would sit collecting
     * for ever, so a run with no wake-up time is woken at once.
     */
    const jobId = await boss.send(
      estimateQueue,
      { estimateId },
      { singletonKey: estimateId, startAfter: wakeAt ?? new Date() },
    );

    if (jobId === null) {
      logger.debug({ estimateId, wakeAt }, "resume not booked: a cost test is already queued");
    }
  };
}
