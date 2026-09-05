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
  checkBudget,
  clearBudget,
  createMonitor,
  type Database,
  deleteMonitor,
  environmentVariableFor,
  exhaustedBehaviours,
  getMonitor,
  listMonitors,
  type Monitor,
  type MonitorEnvironment,
  maximumQueries,
  maximumSubreddits,
  minimumPollIntervalSeconds,
  monitorQueries,
  pauseMonitor,
  type QueryGenerator,
  recordModelCall,
  resumeMonitor,
  type SourceDescriptor,
  searchQuerySchema,
  setBudget,
  signals as signalIds,
  signalList,
  startBlockers,
  sources as storableSources,
  subredditSchema,
  updateMonitor,
} from "@intentwatch/core";
import { z } from "zod";
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

/** The four answers PLAN.md's form asks for. */
const answersBody = z.object({
  product: answerText,
  idealCustomer: answerText,
  problem: answerText,
  signals: z.array(z.enum(signalIds)).max(signalIds.length).default([]),
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
const planBody = z.object({
  queries: z.array(searchQuerySchema).max(maximumQueries).default([]),
  subreddits: z.array(subredditSchema).max(maximumSubreddits).default([]),
});

const createBody = answersBody.extend({
  name: z.string().trim().min(1).max(80),
  ...planBody.shape,
  sources: z.array(z.enum(storableSources)).default([]),
  minScore: z.number().int().min(0).max(100).optional(),
  pollIntervalSeconds: z.number().int().min(minimumPollIntervalSeconds).optional(),
});

const updateBody = createBody.partial();

const missingCredentialSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
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

const budgetSchema = z.object({
  monthlyCapMicros: z.number(),
  onExhausted: z.enum(exhaustedBehaviours),
});

const monitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  product: z.string(),
  idealCustomer: z.string(),
  problem: z.string(),
  signals: z.array(z.string()),
  queries: z.array(z.string()),
  subreddits: z.array(z.string()),
  sources: z.array(z.string()),
  minScore: z.number(),
  pollIntervalSeconds: z.number(),
  paused: z.boolean(),
  pausedAt: z.string().nullable(),
  lastPolledAt: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Recomputed on every read, never stored. The keys live in the environment
   * until US-004, so a monitor can become startable without its row changing.
   */
  missingCredentials: z.array(missingCredentialSchema),
  /** Null when no cap is set. A monitor with no cap still records what it spends. */
  budget: budgetSchema.nullable(),
  spend: spendSchema,
});

const problemSchema = z.object({
  message: z.string(),
  missingCredentials: z.array(missingCredentialSchema).optional(),
});

export interface MonitorRoutesOptions {
  readonly db: Database;
  /** The connectors this build ships, read for their credential fields. */
  readonly sources: readonly SourceDescriptor[];
  /** Where the keys live until US-004 encrypts them in the database. */
  readonly environment?: Record<string, string | undefined>;
  /** Null when this deployment has no model key. The form says so. */
  readonly queryGenerator: QueryGenerator | null;
}

function monitorEnvironment(options: MonitorRoutesOptions): MonitorEnvironment {
  return { descriptors: options.sources, environment: options.environment };
}

function toResponse(monitor: Monitor, runtime: MonitorEnvironment, state: BudgetState) {
  return {
    id: monitor.id,
    name: monitor.name,
    product: monitor.product,
    idealCustomer: monitor.idealCustomer,
    problem: monitor.problem,
    signals: monitor.signals,
    queries: monitorQueries(monitor.generatedQueries),
    subreddits: monitor.generatedSubreddits,
    sources: monitor.sources,
    minScore: monitor.minScore,
    pollIntervalSeconds: monitor.pollIntervalSeconds,
    paused: monitor.pausedAt !== null,
    pausedAt: monitor.pausedAt?.toISOString() ?? null,
    lastPolledAt: monitor.lastPolledAt?.toISOString() ?? null,
    createdAt: monitor.createdAt.toISOString(),
    missingCredentials: startBlockers(monitor.sources, runtime),
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
  };
}

export async function registerMonitorRoutes(
  app: ApiServer,
  options: MonitorRoutesOptions,
): Promise<void> {
  const { db, sources, queryGenerator } = options;
  const runtime = monitorEnvironment(options);
  const environment = options.environment ?? process.env;

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
              billableUnit: z.string(),
              pricePerUnitMicros: z.number(),
              credentials: z.array(
                z.object({
                  name: z.string(),
                  label: z.string(),
                  environmentVariable: z.string(),
                  configured: z.boolean(),
                }),
              ),
              ready: z.boolean(),
            }),
          ),
          /** False when no model key is set, so the form can say why. */
          canGenerateQueries: z.boolean(),
        }),
      },
    },
    handler: async () => ({
      signals: signalList.map(({ id, label, hint }) => ({ id, label, hint })),
      sources: sources.map((source) => {
        const missing = startBlockers([source.id], runtime);

        return {
          id: source.id,
          displayName: source.displayName,
          billableUnit: source.billableUnit,
          pricePerUnitMicros: source.pricePerUnitMicros,
          credentials: source.credentialFields.map((field) => ({
            name: field.name,
            label: field.label,
            // The one naming rule, from the one file that holds it. A second
            // copy here would name a variable that does not exist the first
            // time either rule changes.
            environmentVariable: environmentVariableFor(source.id, field.name),
            // Never the value itself, set or not. US-004 encrypts these; an
            // endpoint that echoed one would make that pointless.
            configured: !missing.some((credential) => credential.field === field.name),
          })),
          ready: missing.length === 0,
        };
      }),
      canGenerateQueries: queryGenerator !== null,
    }),
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
      body: answersBody,
      response: {
        200: z.object({
          queries: z.array(z.string()),
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
      if (!queryGenerator) {
        return reply.code(503).send({
          message:
            "No model is configured, so queries cannot be written. Set AI_API_KEY, " +
            "or AI_PROVIDER=ollama to run a local model. You can still type the " +
            "queries yourself.",
        });
      }

      const outcome = await queryGenerator.generate(request.body);

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
            `${queryGenerator.model} did not write a usable set of queries. ` +
            "Try again, or make the answers more specific. You can also type the queries yourself.",
        });
      }

      if (outcome.status === "failed") {
        request.log.error({ err: outcome.error }, "the model could not be reached");
        return reply.code(502).send({
          message: `${queryGenerator.model} could not be reached: ${outcome.error}`,
        });
      }

      return {
        queries: outcome.plan.queries,
        subreddits: outcome.plan.subreddits,
        model: queryGenerator.model,
        estimatedCostMicros: outcome.call.estimatedCostMicros ?? null,
      };
    },
  });

  app.route({
    method: "GET",
    url: "/api/monitors",
    schema: { response: { 200: z.array(monitorSchema) } },
    handler: async () => {
      // One read for every monitor's spend, rather than one per row. The
      // screen that shows this is a list, and a per-row query here would be
      // the list's cost growing with the number of monitors.
      const rows = await listMonitors(db);
      const states = await budgetStates(db);

      return Promise.all(
        rows.map(async (monitor) =>
          // A monitor created between the two reads is not in the map. It is
          // read on its own rather than defaulted to zero: this is a bill
          // page, and a zero nothing measured is the failure US-013 is about.
          toResponse(
            monitor,
            runtime,
            states.get(monitor.id) ?? (await checkBudget(db, monitor.id)),
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
      const { monitor, missing } = await createMonitor(db, request.body, runtime);

      if (missing.length > 0) {
        // Created, and paused, because four answers somebody just typed are
        // not thrown away over a key they can paste in a minute. The response
        // says which one, and the monitor stays off until it is set.
        request.log.warn(
          { monitorId: monitor.id, missing: missing.map((one) => one.environmentVariable) },
          "monitor created but not started: a credential is missing",
        );
      }

      return reply.code(201).send(toResponse(monitor, runtime, await checkBudget(db, monitor.id)));
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
      const monitor = await getMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return toResponse(monitor, runtime, await checkBudget(db, monitor.id));
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
      const monitor = await updateMonitor(db, request.params.id, request.body);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return toResponse(monitor, runtime, await checkBudget(db, monitor.id));
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
      const monitor = await pauseMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return toResponse(monitor, runtime, await checkBudget(db, monitor.id));
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
      const result = await resumeMonitor(db, request.params.id, runtime);
      if (!result) return reply.code(404).send({ message: "No monitor has that id." });

      if (result.status === "blocked") {
        const names = result.missing.map((credential) => credential.environmentVariable);

        return reply.code(409).send({
          message:
            `This monitor cannot start until ${names.join(" and ")} ` +
            `${names.length === 1 ? "is" : "are"} set.`,
          missingCredentials: [...result.missing],
        });
      }

      return toResponse(result.monitor, runtime, await checkBudget(db, result.monitor.id));
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
      const monitor = await getMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await setBudget(db, monitor.id, request.body);

      return toResponse(monitor, runtime, await checkBudget(db, monitor.id));
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
      const monitor = await getMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await clearBudget(db, monitor.id);

      return toResponse(monitor, runtime, await checkBudget(db, monitor.id));
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
      const deleted = await deleteMonitor(db, request.params.id);
      if (!deleted) return reply.code(404).send({ message: "No monitor has that id." });

      return reply.code(204).send(null);
    },
  });

  // Read once at boot, so a deployment that set no key learns it here rather
  // than from a monitor that quietly never polls.
  const unconfigured = sources.filter((source) => startBlockers([source.id], runtime).length > 0);

  if (unconfigured.length > 0) {
    app.log.warn(
      {
        sources: unconfigured.map((source) => source.id),
        set: Object.keys(environment).filter((name) => name.endsWith("_API_KEY")).length,
      },
      "some sources have no credentials; monitors that name them cannot start",
    );
  }
}
