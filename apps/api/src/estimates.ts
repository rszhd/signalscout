/**
 * The HTTP side of a cost test: start one, and read what it found.
 *
 * Two routes, because the answer does not arrive inside the request. A Reddit
 * sample is collected by the provider over about two minutes, so `POST`
 * answers 202 with a run that is still collecting and the screen reads `GET`
 * until it is ready. A route that held the connection open would lose a sample
 * the user had already paid for the first time a proxy timed out.
 *
 * `GET` is a pure read. The worker advances the run; nothing here does, so
 * refreshing the screen cannot spend money.
 */
import {
  type ConnectorDescriptor,
  type Database,
  defaultPollIntervalSeconds,
  estimateProbeKinds,
  estimateStatuses,
  getBudget,
  getMonitor,
  type JobSender,
  maximumQueries,
  maximumSubreddits,
  minimumPollIntervalSeconds,
  probesFor,
  readEstimate,
  refuseEstimate,
  reportFor,
  searchQuerySchema,
  startEstimate,
  sources as storableSources,
  subredditSchema,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

const sampleSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  channel: z.string().nullable(),
  excerpt: z.string(),
  postedAt: z.string(),
});

/**
 * One line of the answer.
 *
 * The cost is a range. Its two ends are equal when the source had nothing more
 * to give; they differ when the sample was billed everything it asked for, and
 * then the width is the honest measure of what one small sample cannot say.
 *
 * A null cost is two different situations and the screen says something
 * different for each: this source charges nothing, or this query has not
 * finished being measured. Neither is a zero, and a zero is what a reader would
 * take a missing number for.
 */
const probeSchema = z.object({
  source: z.string(),
  sourceName: z.string(),
  kind: z.enum(estimateProbeKinds),
  term: z.string(),
  status: z.enum(estimateStatuses),
  /** Posts inside the window. The volume answer, and never the cost one. */
  postsFound: z.number(),
  /** What the source charged for this one search. The cost answer. */
  unitsBilled: z.number(),
  /** The source billed everything the sample asked for, so there was more. */
  capped: z.boolean(),
  postsPerDay: z.number(),
  monthlyUnitsLow: z.number(),
  monthlyUnitsHigh: z.number(),
  monthlyCostMicrosLow: z.number().nullable(),
  monthlyCostMicrosHigh: z.number().nullable(),
  billableUnit: z.string(),
  overCap: z.boolean(),
  samples: z.array(sampleSchema),
  error: z.string().nullable(),
});

const reportSchema = z.object({
  id: z.string(),
  monitorId: z.string().nullable(),
  status: z.enum(estimateStatuses),
  /** What the projection assumes. The same plan costs more the faster it polls. */
  pollIntervalSeconds: z.number(),
  windowDays: z.number(),
  /** What the test itself consumed and cost. Estimated, like every figure here. */
  testUnits: z.number(),
  testCostMicros: z.number(),
  queries: z.array(probeSchema),
  totals: z.object({
    postsPerDay: z.number(),
    monthlyUnitsLow: z.number(),
    monthlyUnitsHigh: z.number(),
    monthlyCostMicrosLow: z.number().nullable(),
    monthlyCostMicrosHigh: z.number().nullable(),
    capMicros: z.number().nullable(),
    /** True when the plan *could* spend the budget, not only when it must. */
    overCap: z.boolean(),
  }),
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

const problemSchema = z.object({ message: z.string() });

const startBody = z.object({
  /** Set when an existing monitor is retested. Absent while the plan is a plan. */
  monitorId: z.uuid().optional(),
  queries: z.array(searchQuerySchema).max(maximumQueries).default([]),
  subreddits: z.array(subredditSchema).max(maximumSubreddits).default([]),
  sources: z.array(z.enum(storableSources)).min(1),
  pollIntervalSeconds: z
    .number()
    .int()
    .min(minimumPollIntervalSeconds)
    .default(defaultPollIntervalSeconds),
  /** The cap to measure against. Read from the monitor when one is named. */
  monthlyCapMicros: z.number().int().min(0).nullable().default(null),
});

export interface EstimateRoutesOptions {
  readonly db: Database;
  readonly sources: readonly ConnectorDescriptor[];
  /**
   * How the worker is told to run the test. Null when this deployment has no
   * queue to send to, which the route says rather than writing a run nothing
   * will ever pick up.
   */
  readonly jobs: JobSender | null;
}

export async function registerEstimateRoutes(
  app: ApiServer,
  { db, sources, jobs }: EstimateRoutesOptions,
): Promise<void> {
  /**
   * Start a cost test.
   *
   * This spends money on the user's key, which is the honest tension in
   * US-014: the only way to find out what a query collects is to collect a
   * little of it. So it happens when a person presses a button, never on a
   * keystroke, and the answer says what the answer cost.
   */
  app.route({
    method: "POST",
    url: "/api/monitors/estimates",
    schema: {
      body: startBody,
      response: { 202: reportSchema, 400: problemSchema, 404: problemSchema, 503: problemSchema },
    },
    handler: async (request, reply) => {
      const { monitorId, queries, subreddits, sources: sourceIds } = request.body;

      const probes = probesFor(sourceIds, queries, subreddits);

      if (probes.length === 0) {
        return reply.code(400).send({
          message: "There is nothing to test. Keep at least one search query or subreddit.",
        });
      }

      if (!jobs) {
        return reply.code(503).send({
          message:
            "No worker is reachable, so a cost test cannot run. Start the worker, or set " +
            "WORKER_IN_PROCESS=true.",
        });
      }

      // A named monitor brings its own interval and its own cap. Reading them
      // here rather than trusting the body is what makes the flag mean
      // something: the number a person is warned against is the number the
      // budget guard will refuse them at.
      let pollIntervalSeconds = request.body.pollIntervalSeconds;
      let monthlyCapMicros = request.body.monthlyCapMicros;

      if (monitorId) {
        const monitor = await getMonitor(db, monitorId);
        if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

        pollIntervalSeconds = monitor.pollIntervalSeconds;
        monthlyCapMicros = (await getBudget(db, monitorId))?.monthlyCapMicros ?? null;
      }

      const estimateId = await startEstimate(db, {
        monitorId: monitorId ?? null,
        pollIntervalSeconds,
        monthlyCapMicros,
        probes,
      });

      try {
        await jobs.sendEstimate(estimateId);
      } catch (cause) {
        // The run exists and nothing will ever pick it up. Saying so beats a
        // screen that waits for an answer that is not coming.
        request.log.error({ err: cause, estimateId }, "the cost test could not be queued");
        await refuseEstimate(db, estimateId, "The cost test could not be queued for the worker.");
      }

      const run = await readEstimate(db, estimateId);
      if (!run) throw new Error("The cost test was not written.");

      return reply.code(202).send(toResponse(run, sources));
    },
  });

  app.route({
    method: "GET",
    url: "/api/monitors/estimates/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: reportSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const run = await readEstimate(db, request.params.id);
      if (!run) return reply.code(404).send({ message: "No cost test has that id." });

      return toResponse(run, sources);
    },
  });
}

function toResponse(
  run: Awaited<ReturnType<typeof readEstimate>> & object,
  sources: readonly ConnectorDescriptor[],
) {
  const report = reportFor(run, sources);

  return {
    ...report,
    queries: report.queries.map((probe) => ({ ...probe, samples: [...probe.samples] })),
    finishedAt: report.finishedAt?.toISOString() ?? null,
  };
}
