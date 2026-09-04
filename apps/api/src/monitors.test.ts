/**
 * The monitor routes, against real Postgres.
 *
 * The generator is a stub. That is not a shortcut around docs/testing.md: the
 * interface it implements is ours, and the evidence about what a real model
 * does with the prompt belongs to `packages/core`, which owns the prompt. What
 * these tests own is the other half — the status code a person meets, and
 * whether the row the worker reads says what the response claimed.
 *
 * `AI_API_KEY` is blank for the whole suite, so a route that fell back to a
 * real provider would reach nothing rather than spend anything.
 */
import {
  builtInSources,
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  type ModelCall,
  modelCalls,
  monitors,
  type QueryGenerator,
  type QueryPlanOutcome,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const logger = createLogger({ level: "silent", name: "test" });

/** A deployment with the Bright Data key Reddit needs, and one without. */
const configured = { REDDIT_API_KEY: "bd-test-key" };
const unconfigured = {};

const call: ModelCall = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens: 400,
  outputTokens: 90,
  latencyMs: 250,
  estimatedCostMicros: 850,
};

const plan = {
  queries: [
    "playwright tests break every release",
    "how do small teams handle regression testing",
    "tired of manually testing signup and checkout",
  ],
  subreddits: ["SaaS", "webdev"],
};

/**
 * A generator that answers however the case needs.
 *
 * Hand-written, because `QueryGenerator` is our own interface and the three
 * outcomes are our own words. The question here is what the route does with
 * each of them.
 */
function stubGenerator(outcome: QueryPlanOutcome): QueryGenerator {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    generate: async () => outcome,
  };
}

const answers = {
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["recommendation_request", "problem"],
};

const newMonitor = {
  name: "Journeys",
  ...answers,
  queries: ["flaky end to end tests", "manual qa before every release"],
  subreddits: ["SaaS"],
  sources: ["reddit"],
};

describe("the monitor routes", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_monitors");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(modelCalls);
    await db.delete(monitors);
  });

  interface ServerOptions {
    environment?: Record<string, string | undefined>;
    queryGenerator?: QueryGenerator | null;
  }

  async function server({ environment = configured, queryGenerator = null }: ServerOptions = {}) {
    const env = loadEnv({ DATABASE_URL: database.url });

    return buildServer({
      env,
      logger,
      db,
      sources: builtInSources,
      environment,
      queryGenerator,
    });
  }

  async function withServer<T>(
    options: ServerOptions,
    body: (app: Awaited<ReturnType<typeof server>>) => Promise<T>,
  ): Promise<T> {
    const app = await server(options);
    try {
      return await body(app);
    } finally {
      await app.close();
    }
  }

  describe("what the form needs to render itself", () => {
    it("lists the signals with the labels the prompts were built from", async () => {
      await withServer({}, async (app) => {
        const response = await app.inject({ method: "GET", url: "/api/monitor-options" });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // PLAN.md's seven, in the schema's order.
        expect(body.signals).toHaveLength(7);
        expect(body.signals[0]).toEqual({
          id: "recommendation_request",
          label: "Asking for recommendations",
          hint: "“What are other teams using?”",
        });
      });
    });

    it("names the variable a missing source credential needs", async () => {
      await withServer({ environment: unconfigured }, async (app) => {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        const reddit = body.sources.find((source: { id: string }) => source.id === "reddit");

        expect(reddit.ready).toBe(false);
        expect(reddit.credentials).toEqual([
          {
            name: "apiKey",
            label: "Bright Data API key",
            environmentVariable: "REDDIT_API_KEY",
            configured: false,
          },
        ]);
      });
    });

    it("never returns the credential itself", async () => {
      await withServer({}, async (app) => {
        const response = await app.inject({ method: "GET", url: "/api/monitor-options" });

        expect(response.body).toContain("REDDIT_API_KEY");
        // The name of the variable, never its value. US-004 encrypts these,
        // and an endpoint that echoed one would make that pointless.
        expect(response.body).not.toContain("bd-test-key");
      });
    });

    it("says when queries cannot be written, so the form can offer to be typed", async () => {
      await withServer({}, async (app) => {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();

        expect(body.canGenerateQueries).toBe(false);
      });
    });
  });

  describe("writing the queries", () => {
    it("returns them and records what the call cost", async () => {
      await withServer(
        { queryGenerator: stubGenerator({ status: "generated", plan, call }) },
        async (app) => {
          const response = await app.inject({
            method: "POST",
            url: "/api/monitors/queries",
            payload: answers,
          });

          expect(response.statusCode).toBe(200);
          expect(response.json().queries).toEqual(plan.queries);
          expect(response.json().subreddits).toEqual(plan.subreddits);

          // The call spent the user's money before any monitor existed, so
          // the ledger carries it with no monitor id.
          const recorded = await db.select().from(modelCalls);

          expect(recorded).toHaveLength(1);
          expect(recorded[0]?.purpose).toBe("query_generation");
          expect(recorded[0]?.outcome).toBe("scored");
          expect(recorded[0]?.monitorId).toBeNull();
          expect(recorded[0]?.postId).toBeNull();
          expect(recorded[0]?.estimatedCostMicros).toBe(850);
        },
      );
    });

    it("records a refusal too, because a refusal is billed like an answer", async () => {
      await withServer(
        {
          queryGenerator: stubGenerator({ status: "rejected", error: "not JSON", call }),
        },
        async (app) => {
          const response = await app.inject({
            method: "POST",
            url: "/api/monitors/queries",
            payload: answers,
          });

          expect(response.statusCode).toBe(422);

          const recorded = await db.select().from(modelCalls);
          expect(recorded[0]?.outcome).toBe("rejected");
          expect(recorded[0]?.error).toBe("not JSON");
        },
      );
    });

    it("answers 502 when the model was never reached", async () => {
      // A different code from the refusal above, on purpose: this one sends a
      // person to look at their key or their network, not at their answers.
      await withServer(
        {
          queryGenerator: stubGenerator({
            status: "failed",
            error: "rate limit exceeded",
            call: { ...call, inputTokens: undefined, estimatedCostMicros: undefined },
          }),
        },
        async (app) => {
          const response = await app.inject({
            method: "POST",
            url: "/api/monitors/queries",
            payload: answers,
          });

          expect(response.statusCode).toBe(502);
          expect(response.json().message).toContain("rate limit");
          // Nothing measurable was billed, and the row says so rather than
          // recording a zero.
          expect((await db.select().from(modelCalls))[0]?.estimatedCostMicros).toBeNull();
        },
      );
    });

    it("says so when no model is configured, instead of failing silently", async () => {
      // No generator passed at all, so the server builds its own from an
      // environment the suite keeps keyless.
      const app = await buildServer({
        env: loadEnv({ DATABASE_URL: database.url }),
        logger,
        db,
        sources: builtInSources,
        environment: configured,
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors/queries",
          payload: answers,
        });

        expect(response.statusCode).toBe(503);
        expect(response.json().message).toContain("AI_API_KEY");
        expect(await db.select().from(modelCalls)).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("refuses answers too short to write a query from", async () => {
      await withServer(
        { queryGenerator: stubGenerator({ status: "generated", plan, call }) },
        async (app) => {
          const response = await app.inject({
            method: "POST",
            url: "/api/monitors/queries",
            payload: { ...answers, product: "QA" },
          });

          expect(response.statusCode).toBe(400);
          // Refused before the call, so nothing was spent finding out.
          expect(await db.select().from(modelCalls)).toEqual([]);
        },
      );
    });
  });

  describe("creating a monitor", () => {
    it("stores the answers and the edited queries", async () => {
      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();

        expect(body.product).toBe(newMonitor.product);
        expect(body.queries).toEqual(newMonitor.queries);
        expect(body.subreddits).toEqual(["SaaS"]);
        expect(body.paused).toBe(false);
        expect(body.missingCredentials).toEqual([]);
      });
    });

    it("holds a person to the same query rule as the model", async () => {
      // An edited query costs exactly what a generated one costs. A Boolean
      // string is matched literally, finds nothing, and looks like a quiet
      // week.
      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: { ...newMonitor, queries: ["playwright AND flaky"] },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    it("creates it paused when the source has no credentials, and says which", async () => {
      await withServer({ environment: unconfigured }, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();

        // The answers are kept. The monitor is off.
        expect(body.product).toBe(newMonitor.product);
        expect(body.paused).toBe(true);
        expect(body.missingCredentials[0].environmentVariable).toBe("REDDIT_API_KEY");
        expect(body.missingCredentials[0].label).toBe("Bright Data API key");
      });
    });
  });

  describe("editing, pausing and resuming", () => {
    async function create(app: Awaited<ReturnType<typeof server>>, payload = newMonitor) {
      const response = await app.inject({ method: "POST", url: "/api/monitors", payload });
      return response.json().id as string;
    }

    it("replaces the queries without touching the answers", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { queries: ["regression testing takes too long"], subreddits: [] },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().queries).toEqual(["regression testing takes too long"]);
        expect(response.json().product).toBe(newMonitor.product);
      });
    });

    it("pauses and resumes", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const paused = await app.inject({ method: "POST", url: `/api/monitors/${id}/pause` });
        expect(paused.json().paused).toBe(true);
        expect(paused.json().pausedAt).not.toBeNull();

        const resumed = await app.inject({ method: "POST", url: `/api/monitors/${id}/resume` });
        expect(resumed.json().paused).toBe(false);
        expect(resumed.json().pausedAt).toBeNull();
      });
    });

    it("refuses to resume a monitor whose credential is missing, and names it", async () => {
      await withServer({ environment: unconfigured }, async (app) => {
        const id = await create(app);

        const response = await app.inject({ method: "POST", url: `/api/monitors/${id}/resume` });

        expect(response.statusCode).toBe(409);
        expect(response.json().message).toContain("REDDIT_API_KEY");
        expect(response.json().missingCredentials).toHaveLength(1);

        // And the row still says paused, so the worker agrees with the answer.
        const [row] = await db.select().from(monitors);
        expect(row?.pausedAt).not.toBeNull();
      });
    });

    it("lists what has been created", async () => {
      await withServer({}, async (app) => {
        await create(app);
        await create(app, { ...newMonitor, name: "Second" });

        const response = await app.inject({ method: "GET", url: "/api/monitors" });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveLength(2);
      });
    });

    it("answers 404 for an id that is not there", async () => {
      await withServer({}, async (app) => {
        const missing = "00000000-0000-4000-8000-000000000000";

        expect(
          (await app.inject({ method: "GET", url: `/api/monitors/${missing}` })).statusCode,
        ).toBe(404);
        expect(
          (await app.inject({ method: "POST", url: `/api/monitors/${missing}/resume` })).statusCode,
        ).toBe(404);
      });
    });

    it("deletes one", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        expect(
          (await app.inject({ method: "DELETE", url: `/api/monitors/${id}` })).statusCode,
        ).toBe(204);
        expect((await app.inject({ method: "GET", url: `/api/monitors/${id}` })).statusCode).toBe(
          404,
        );
      });
    });
  });
});
