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
  type ConnectorDefinition,
  clearProviderChoice,
  createDatabase,
  createLogger,
  type Database,
  fakeSourceDefinition,
  filterDrops,
  getMonitor,
  loadEnv,
  type ModelCall,
  matches,
  modelCalls,
  monitors,
  type PollRunRecord,
  posts,
  type QueryGenerator,
  type QueryPlanOutcome,
  readNotificationSettings,
  recordFilterDrops,
  recordModelCall,
  recordPollRun,
  recordSourceUsage,
  recordVerdict,
  setProviderChoice,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asOwner, testOwner as owner } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

/** A deployment with the Bright Data key Reddit needs, and one without. */
const configured = { BRIGHTDATA_API_KEY: "bd-test-key" };
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
  queries: {
    reddit: [
      "playwright tests break every release",
      "how do small teams handle regression testing",
      "tired of manually testing signup and checkout",
    ],
    x: ["flaky tests", "e2e suite broken", "regression testing pain"],
  },
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
  /**
   * One key per platform this build ships, because that is what the route
   * answers with. A monitor watching Reddit alone still carries the empty
   * lists: the form renders a box for every platform, and a key that appeared
   * only once something was typed in it would make the form's shape depend on
   * its own history.
   */
  queries: {
    reddit: ["flaky end to end tests", "manual qa before every release"],
    x: [],
    linkedin: [],
    youtube: [],
    tiktok: [],
    instagram: [],
  },
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
    await db.delete(filterDrops);
    await db.delete(modelCalls);
    await db.delete(matches);
    await db.delete(monitors);
    await db.delete(posts);
  });

  interface ServerOptions {
    environment?: Record<string, string | undefined>;
    queryGenerator?: QueryGenerator | null;
    /** US-053: what this build offers, for a case about a connector that is off. */
    sources?: readonly ConnectorDefinition[];
    /** US-093: whether this deployment has a mailer to switch email on with. */
    canSendEmail?: boolean;
  }

  async function server({
    environment = configured,
    queryGenerator = null,
    sources = builtInSources,
    canSendEmail = false,
  }: ServerOptions = {}) {
    const env = loadEnv({ DATABASE_URL: database.url });

    return buildServer({
      session: asOwner,
      env,
      logger,
      db,
      sources,
      environment,
      queryGenerator,
      canSendEmail,
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

  /** Create a monitor through the route, and hand back its id. */
  async function create(app: Awaited<ReturnType<typeof server>>, payload = newMonitor) {
    const response = await app.inject({ method: "POST", url: "/api/monitors", payload });
    return response.json().id as string;
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

        // Both of Reddit's providers, because neither has a key here. Each
        // entry names its own account, so the screen can offer one *or* the
        // other: a person needs one Reddit provider, never both. US-026.
        expect(reddit.ready).toBe(false);
        expect(
          reddit.missingCredentials.map((credential: { environmentVariable: string }) => [
            credential.environmentVariable,
          ]),
        ).toEqual([
          ["BRIGHTDATA_API_KEY"],
          ["SCRAPECREATORS_API_KEY"],
          // US-031 gave Reddit a third provider. One key of the three is
          // enough to poll it, so all three are offered and none is demanded.
          ["SOCIALCRAWL_API_KEY"],
        ]);
        expect(reddit.missingCredentials[0]).toEqual({
          sourceId: "reddit",
          sourceName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
          field: "apiKey",
          label: "Bright Data API key",
          environmentVariable: "BRIGHTDATA_API_KEY",
        });
      });
    });

    it("lists one row per platform, whatever a platform's providers", async () => {
      /**
       * US-026. The build ships two Reddit connectors and the form must not
       * show Reddit twice, or ask a person to pick a scraper while they are
       * choosing where to listen. Which account fetches a platform is the
       * connections screen's question, and it is answered once for every
       * monitor.
       */
      await withServer({}, async (app) => {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();

        expect(builtInSources.filter((source) => source.platform.id === "reddit")).toHaveLength(3);
        // Two since US-061. X had one provider until then, which was the
        // thinnest dependency in the product: US-006 asked three and only one
        // could search X at all.
        expect(builtInSources.filter((source) => source.platform.id === "x")).toHaveLength(2);
        // Two since US-057, which added the fresher of them. LinkedIn is now
        // the second platform that has to collapse, and the first one where the
        // two providers agree about neither the price nor the billable unit:
        // SocialCrawl bills five credits for ten posts and Apify bills every
        // post it returns.
        expect(builtInSources.filter((source) => source.platform.id === "linkedin")).toHaveLength(
          2,
        );

        // Three providers for Reddit, two each for LinkedIn and X, and one
        // each for the rest: ten connectors make six rows. US-006 added the second platform, US-028
        // the third, US-034 the fourth, US-044 the fifth and US-049 the sixth,
        // which is why this list grew; a platform appearing twice is the
        // failure it guards. SocialCrawl fetching five of the six is exactly
        // the collapse this asserts.
        const ids = body.sources.map((source: { id: string }) => source.id);
        expect(ids).toEqual(["reddit", "x", "linkedin", "youtube", "tiktok", "instagram"]);
        expect(new Set(ids).size).toBe(ids.length);
        // And no price beside it. Two providers do not agree about what a
        // Reddit record costs, so a figure printed here would be one
        // provider's arithmetic on the other's bill.
        expect(body.sources[0]).not.toHaveProperty("pricePerUnitMicros");
      });
    });

    it("never returns the credential itself", async () => {
      // With no key set, so the variable is named. A configured deployment
      // names nothing, which is the case above.
      await withServer({ environment: unconfigured }, async (app) => {
        const response = await app.inject({ method: "GET", url: "/api/monitor-options" });

        expect(response.body).toContain("BRIGHTDATA_API_KEY");
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
        session: asOwner,
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
          payload: { ...newMonitor, queries: { reddit: ["playwright AND flaky"] } },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    it("refuses a query too long for the platform it is written for", async () => {
      /**
       * US-027, and the numbers are measured. US-006 sent
       * `end to end tests keep breaking` to a live X search twice: unquoted it
       * returned anime, Bitcoin and a CIA story across three weeks, and quoted
       * it matched nothing at all. Two words returned twenty posts, all on
       * topic. So the ceiling is four words on X and eight on Reddit, and a
       * person editing here is held to the same rule as the model.
       */
      await withServer({}, async (app) => {
        const tooLongForX = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: {
            ...newMonitor,
            sources: ["x"],
            queries: { x: ["end to end tests keep breaking"] },
          },
        });

        expect(tooLongForX.statusCode).toBe(400);

        const sameWordsOnReddit = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: {
            ...newMonitor,
            queries: { reddit: ["end to end tests keep breaking"] },
          },
        });

        expect(sameWordsOnReddit.statusCode).toBe(201);
      });
    });

    it("keeps each platform's queries apart, so one list cannot reach the other's search", async () => {
      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: {
            ...newMonitor,
            sources: ["reddit", "x"],
            queries: {
              reddit: ["manual qa before every release"],
              x: ["flaky tests"],
            },
          },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().queries).toEqual({
          reddit: ["manual qa before every release"],
          x: ["flaky tests"],
          // Named by no monitor here, and still its own list. The lists are
          // kept apart by platform and not by what the monitor watches.
          linkedin: [],
          youtube: [],
          tiktok: [],
          instagram: [],
        });
      });
    });

    it("sets the cap with the monitor, not a moment after it", async () => {
      // US-014's form knows the cap before it creates anything: the cost test
      // was measured against it. A monitor created and capped in a second
      // request is a monitor the scheduler could poll in between, uncapped.
      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: {
            ...newMonitor,
            budget: { monthlyCapMicros: 10_000_000, onExhausted: "notify" },
          },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().budget).toEqual({
          monthlyCapMicros: 10_000_000,
          onExhausted: "notify",
        });
        expect(response.json().spend.remainingMicros).toBe(10_000_000);
      });
    });

    it("keeps a plan without starting it when the person asks", async () => {
      // The cost test said this plan would cost more than the cap. Keeping it
      // and starting it are two decisions, and this is the first one.
      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: { ...newMonitor, startPaused: true },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().paused).toBe(true);
        // Not because anything is missing. The person chose it.
        expect(response.json().missingCredentials).toEqual([]);
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
        expect(body.missingCredentials[0].environmentVariable).toBe("BRIGHTDATA_API_KEY");
        expect(body.missingCredentials[0].label).toBe("Bright Data API key");
      });
    });
  });

  describe("editing, pausing and resuming", () => {
    it("replaces the queries without touching the answers", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { queries: { reddit: ["regression testing takes too long"] }, subreddits: [] },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().queries).toEqual({
          reddit: ["regression testing takes too long"],
          x: [],
          linkedin: [],
          youtube: [],
          tiktok: [],
          instagram: [],
        });
        expect(response.json().product).toBe(newMonitor.product);
      });
    });

    it("leaves alone every field the edit does not carry", async () => {
      // The pre-filter form on the monitor list sends `preFilter` and nothing
      // else, which is what a screen editing one setting should send. A body
      // schema that fills the absent keys with its own defaults erases the
      // monitor's definition on the way past: no signals for the prompt, no
      // source to poll, and a plan that collects nothing.
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { preFilter: { similarityThreshold: 0.4 } },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();
        expect(body.signals).toEqual(newMonitor.signals);
        expect(body.sources).toEqual(newMonitor.sources);
        expect(body.queries).toEqual(newMonitor.queries);
        expect(body.subreddits).toEqual(newMonitor.subreddits);
      });
    });

    it("does not move the version when only the plan changes", async () => {
      // `monitors.version` is the definition a verdict was given against. An
      // edited query changes what is collected, not what a good lead is, so a
      // verdict already collected still answers the same question.
      await withServer({}, async (app) => {
        const id = await create(app);
        const before = await getMonitor(db, id);

        await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { queries: { reddit: ["regression testing takes too long"] }, subreddits: [] },
        });

        const after = await getMonitor(db, id);
        expect(after?.version).toBe(before?.version);
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
        expect(response.json().message).toContain("BRIGHTDATA_API_KEY");

        // Both of Reddit's providers, because either one would unblock the
        // monitor and the person gets to pick which account to open. US-025
        // gave Reddit a second provider and US-031 a third; before them there
        // was one row here, and the rule that produced all three — a platform
        // is blocked only when every connector for it is — did not change.
        expect(
          response
            .json()
            .missingCredentials.map((missing: { providerId: string }) => missing.providerId),
        ).toEqual(["brightdata", "scrapecreators", "socialcrawl"]);

        // And the row still says paused, so the worker agrees with the answer.
        const [row] = await db.select().from(monitors);
        expect(row?.pausedAt).not.toBeNull();
      });
    });

    it("refuses to resume when the chosen provider is the one with no key", async () => {
      /**
       * US-026. Bright Data has a key and ScrapeCreators does not, so the old
       * rule — a platform is blocked only when every connector for it is —
       * would call this monitor startable. It is not: the poll obeys the
       * choice or refuses, and it never moves the collection to the account
       * nobody picked. The two have to agree, or a monitor starts and then
       * refuses every poll for ever.
       */
      await setProviderChoice(db, owner, "reddit", "scrapecreators");

      try {
        await withServer({ environment: configured }, async (app) => {
          const id = await create(app);

          const response = await app.inject({ method: "POST", url: `/api/monitors/${id}/resume` });

          expect(response.statusCode).toBe(409);
          expect(response.json().message).toContain("SCRAPECREATORS_API_KEY");
          expect(response.json().message).not.toContain("BRIGHTDATA_API_KEY");
        });
      } finally {
        await clearProviderChoice(db, owner, "reddit");
      }
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
  describe("the pre-filter", () => {
    it("starts on, at the permissive threshold, having dropped nothing", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        expect(response.json().preFilter).toEqual({
          enabled: true,
          similarityThreshold: 0.15,
          // `triage` joined the stages in US-030.
          dropped: { keyword: 0, embedding: 0, triage: 0 },
          // The other half of the sentence the screen writes from these.
          read: 0,
        });
      });
    });

    it("takes a threshold a person set, and keeps it", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { preFilter: { similarityThreshold: 0.4 } },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().preFilter.similarityThreshold).toBeCloseTo(0.4, 5);
        // The worker reads the row, not the response.
        const row = await getMonitor(db, id);
        expect(row?.similarityThreshold).toBeCloseTo(0.4, 5);
      });
    });

    it("turns the whole filter off when a person asks", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { preFilter: { enabled: false } },
        });

        expect(response.json().preFilter.enabled).toBe(false);
        // Off is off, and it does not silently move the threshold with it.
        expect(response.json().preFilter.similarityThreshold).toBeCloseTo(0.15, 5);
      });
    });

    it("refuses a similarity no cosine distance can produce", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { preFilter: { similarityThreshold: 1.4 } },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    it("counts what each stage dropped, on the list a screen reads", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const [post] = await db
          .insert(posts)
          .values({
            source: "reddit",
            externalId: "prefilter-1",
            url: "https://example.test/1",
            excerpt: "My sourdough starter died over the weekend.",
            postedAt: new Date("2026-09-01T10:00:00Z"),
          })
          .returning({ id: posts.id });

        const [second] = await db
          .insert(posts)
          .values({
            source: "reddit",
            externalId: "prefilter-2",
            url: "https://example.test/2",
            excerpt: "Playwright is awesome.",
            postedAt: new Date("2026-09-01T11:00:00Z"),
          })
          .returning({ id: posts.id });

        await recordFilterDrops(db, id, [
          { postId: post?.id as string, stage: "keyword", similarity: null },
          { postId: second?.id as string, stage: "embedding", similarity: 0.04 },
        ]);

        const response = await app.inject({ method: "GET", url: "/api/monitors" });

        expect(response.json()[0].preFilter.dropped).toEqual({
          keyword: 1,
          embedding: 1,
          triage: 0,
        });
      });
    });

    /**
     * The count beside the drops, on the wire.
     *
     * `posts` has no monitor column, so the total the screen shows is this
     * number plus the drops. A route that sent one without the other would
     * make that total wrong rather than missing.
     */
    it("says how many posts the classifier has read", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const [post] = await db
          .insert(posts)
          .values({
            source: "reddit",
            externalId: "classified-1",
            url: "https://example.test/3",
            excerpt: "Our end to end tests break on every UI change.",
            postedAt: new Date("2026-09-01T12:00:00Z"),
          })
          .returning({ id: posts.id });

        // Two calls about one post, as a re-scored post produces. The screen
        // counts posts, so this is one.
        for (const monitorVersion of [1, 2]) {
          await recordModelCall(db, {
            purpose: "classification",
            outcome: "scored",
            monitorId: id,
            monitorVersion,
            postId: post?.id as string,
            call: {
              provider: "anthropic",
              model: "test",
              latencyMs: 10,
              inputTokens: 100,
              outputTokens: 20,
              estimatedCostMicros: 250,
            },
          });
        }

        const response = await app.inject({ method: "GET", url: "/api/monitors" });

        expect(response.json()[0].preFilter.read).toBe(1);
      });
    });
  });

  describe("the feedback counts", () => {
    /** One match on this monitor, so there is something to judge. */
    async function seedMatch(
      monitorId: string,
      externalId: string,
      state: { readAt?: Date; hidden?: boolean } = {},
    ): Promise<string> {
      const [post] = await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId,
          url: `https://example.test/${externalId}`,
          excerpt: "We're manually checking our major flows before every release.",
          postedAt: new Date("2026-09-01T10:00:00Z"),
        })
        .returning({ id: posts.id });

      const [match] = await db
        .insert(matches)
        .values({
          monitorId,
          postId: post?.id as string,
          score: 88,
          relevance: 90,
          problemFit: 98,
          icpFit: 91,
          intent: 94,
          urgency: 70,
          intentType: "problem",
          reasons: ["Small SaaS team"],
          readAt: state.readAt ?? null,
          hidden: state.hidden ?? false,
        })
        .returning({ id: matches.id });

      return match?.id as string;
    }

    it("reports nothing judged on a monitor nobody has judged", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        expect(response.json().feedback).toEqual({ good: 0, notRelevant: 0 });
      });
    });

    it("counts the verdicts in force, on the list a screen reads", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await recordVerdict(db, {
          matchId: await seedMatch(id, "judged-1"),
          userId: owner,
          verdict: "good",
        });
        await recordVerdict(db, {
          matchId: await seedMatch(id, "judged-2"),
          userId: owner,
          verdict: "not_relevant",
        });

        const list = await app.inject({ method: "GET", url: "/api/monitors" });
        const one = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        // Both reads, because the list and the single monitor are two call
        // sites and only one of them counts in bulk.
        expect(list.json()[0].feedback).toEqual({ good: 1, notRelevant: 1 });
        expect(one.json().feedback).toEqual({ good: 1, notRelevant: 1 });
      });
    });

    it("counts this monitor's matches, and the ones nobody has opened. US-109", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await seedMatch(id, "found-1");
        await seedMatch(id, "found-2", { readAt: new Date() });
        await seedMatch(id, "found-3", { hidden: true });

        const list = await app.inject({ method: "GET", url: "/api/monitors" });
        const one = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        // Both reads, because the list counts in bulk and the single monitor
        // does not — and the hidden one is in neither.
        expect(list.json()[0].matches).toEqual({ total: 2, unread: 1 });
        expect(one.json().matches).toEqual({ total: 2, unread: 1 });
      });
    });

    it("reports no matches on a monitor that has found none", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        expect(response.json().matches).toEqual({ total: 0, unread: 0 });
      });
    });
  });

  describe("the budget", () => {
    it("reports no cap and a zero spend for a monitor that has never polled", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);
        const monitor = (await app.inject({ method: "GET", url: `/api/monitors/${id}` })).json();

        expect(monitor.budget).toBeNull();
        expect(monitor.spend.totalMicros).toBe(0);
        expect(monitor.spend.remainingMicros).toBeNull();
        expect(monitor.spend.exhausted).toBe(false);
      });
    });

    it("sets a cap, and replaces it rather than adding a second", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: 1_000_000, onExhausted: "pause" },
        });
        const response = await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: 5_000_000, onExhausted: "notify" },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().budget).toEqual({
          monthlyCapMicros: 5_000_000,
          onExhausted: "notify",
        });
      });
    });

    it("subtracts the recorded spend from the cap", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        // A dollar cap, and two hundred Reddit records at $1.50 per thousand
        // against it. Thirty cents spent, seventy left.
        await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: 1_000_000, onExhausted: "pause" },
        });
        await recordSourceUsage(db, {
          userId: owner,
          monitorId: id,
          source: "reddit",
          provider: "brightdata",
          units: 200,
          pricePerUnitMicros: 1500,
        });

        const monitor = (await app.inject({ method: "GET", url: `/api/monitors/${id}` })).json();

        expect(monitor.spend.sourceMicros).toBe(300_000);
        expect(monitor.spend.remainingMicros).toBe(700_000);
        expect(monitor.spend.exhausted).toBe(false);
        expect(monitor.spend.reason).toBeNull();
      });
    });

    it("says why a monitor stopped polling, in a sentence a person can read", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: 200_000, onExhausted: "pause" },
        });
        await recordSourceUsage(db, {
          userId: owner,
          monitorId: id,
          source: "reddit",
          provider: "brightdata",
          units: 200,
          pricePerUnitMicros: 1500,
        });

        const monitor = (await app.inject({ method: "GET", url: `/api/monitors/${id}` })).json();

        expect(monitor.spend.exhausted).toBe(true);
        expect(monitor.spend.reason).toBe(
          "Stopped at the budget: this monitor has spent an estimated $0.30 of its $0.20 monthly " +
            "budget. It is not collecting, and posts it already collected are not being scored. " +
            "Raise the cap to start both again.",
        );
      });
    });

    it("carries the spend on the list, so a screen needs one request", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await recordSourceUsage(db, {
          userId: owner,
          monitorId: id,
          source: "reddit",
          provider: "brightdata",
          units: 10,
          pricePerUnitMicros: 1500,
        });

        const [monitor] = (await app.inject({ method: "GET", url: "/api/monitors" })).json();

        expect(monitor.spend.totalMicros).toBe(15_000);
      });
    });

    it("removes the cap and keeps what was already recorded", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: 1_000, onExhausted: "pause" },
        });
        await recordSourceUsage(db, {
          userId: owner,
          monitorId: id,
          source: "reddit",
          provider: "brightdata",
          units: 10,
          pricePerUnitMicros: 1500,
        });

        const response = await app.inject({
          method: "DELETE",
          url: `/api/monitors/${id}/budget`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().budget).toBeNull();
        // The ledger is the answer to "what did this month cost". Removing the
        // cap must not remove the answer.
        expect(response.json().spend.totalMicros).toBe(15_000);
        expect(response.json().spend.exhausted).toBe(false);
      });
    });

    it("refuses a negative cap", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({
          method: "PUT",
          url: `/api/monitors/${id}/budget`,
          payload: { monthlyCapMicros: -1 },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    it("answers 404 for a budget on an id that is not there", async () => {
      await withServer({}, async (app) => {
        const missing = "00000000-0000-4000-8000-000000000000";

        expect(
          (
            await app.inject({
              method: "PUT",
              url: `/api/monitors/${missing}/budget`,
              payload: { monthlyCapMicros: 1_000 },
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await app.inject({ method: "DELETE", url: `/api/monitors/${missing}/budget` }))
            .statusCode,
        ).toBe(404);
      });
    });
  });
  describe("a platform this build does not offer", () => {
    /**
     * US-053. A connector can be switched off with one field, and the platform
     * has to leave every screen and every write path together — or a person
     * ticks it, is told nothing, and the poll collects nothing at 02:00.
     *
     * Fakes, not LinkedIn: the mechanism is the subject, and a test naming the
     * connector that happens to be off today would go red the day it comes
     * back.
     */
    const reason = "Bluesky is switched off: nothing has measured what it returns.";

    const offBuild: ConnectorDefinition[] = [
      fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "brightdata" }),
      fakeSourceDefinition({
        id: "linkedin",
        displayName: "LinkedIn",
        providerId: "socialcrawl",
        notOffered: reason,
      }),
    ];

    it("is not on the monitor form", async () => {
      await withServer({ sources: offBuild }, async (app) => {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();

        expect(body.sources.map((source: { id: string }) => source.id)).toEqual(["reddit"]);
      });
    });

    it("refuses a monitor that names it, and says why", async () => {
      await withServer({ sources: offBuild }, async (app) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: { ...newMonitor, sources: ["reddit", "linkedin"] },
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().message).toBe(reason);
        expect(await db.select().from(monitors)).toEqual([]);
      });
    });

    it("refuses an edit that adds it", async () => {
      await withServer({ sources: offBuild }, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });
        const id = created.json().id;

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${id}`,
          payload: { sources: ["linkedin"] },
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().message).toBe(reason);
        expect((await getMonitor(db, id))?.sources).toEqual(["reddit"]);
      });
    });

    it("lets an edit that does not touch the sources through", async () => {
      // An edit carrying one setting must not fail over a platform the monitor
      // already names. Absent is absent.
      await withServer({ sources: offBuild }, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        const response = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${created.json().id}`,
          payload: { minScore: 55 },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    it("has no queries written for it, even when the body asks for every platform", async () => {
      // Model tokens spent on a list nobody can use. The other five are the
      // schema's own platform list, unchanged: this route writes for what the
      // build offers and never for what it has a connector for.
      let asked: readonly { id: string }[] = [];

      const generator: QueryGenerator = {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        generate: async (_answers, wanted) => {
          asked = wanted;
          return { status: "generated", plan, call };
        },
      };

      await withServer({ sources: offBuild, queryGenerator: generator }, async (app) => {
        await app.inject({ method: "POST", url: "/api/monitors/queries", payload: answers });

        expect(asked.map((platform) => platform.id)).toEqual([
          "reddit",
          "x",
          "youtube",
          "tiktok",
          "instagram",
        ]);
      });
    });
  });
  describe("what the last poll did", () => {
    /**
     * US-104. The screen's question is "is this working?", and until this
     * existed the answer was `Running` for a monitor that had spent $0.666 and
     * collected nothing.
     */
    async function writePoll(monitorId: string, overrides: Partial<PollRunRecord> = {}) {
      const at = new Date();

      return await recordPollRun(db, {
        monitorId,
        userId: owner,
        walkId: crypto.randomUUID(),
        startedAt: at,
        finishedAt: at,
        outcome: "empty",
        postsReturned: 0,
        postsNew: 0,
        units: 67,
        estimatedCostMicros: 543_906,
        sources: [
          {
            source: "reddit",
            provider: "socialcrawl",
            pages: 5,
            postsReturned: 0,
            postsNew: 0,
            units: 67,
            estimatedCostMicros: 543_906,
            reason: null,
          },
        ],
        stopReason: null,
        ...overrides,
      });
    }

    it("puts the last poll on the monitor, spend and all", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);
        await writePoll(id);

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        expect(response.statusCode).toBe(200);
        expect(response.json().lastPoll).toMatchObject({
          outcome: "empty",
          postsReturned: 0,
          postsNew: 0,
          units: 67,
          estimatedCostMicros: 543_906,
        });
      });
    });

    it("says null where no poll has run", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}` });

        expect(response.json().lastPoll).toBeNull();
      });
    });

    it("lists the recent polls, newest first", async () => {
      await withServer({}, async (app) => {
        const id = await create(app);
        await writePoll(id, { startedAt: new Date(Date.now() - 60_000) });
        const newest = await writePoll(id, { outcome: "collected", postsReturned: 5, postsNew: 5 });

        const response = await app.inject({ method: "GET", url: `/api/monitors/${id}/polls` });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveLength(2);
        expect(response.json()[0].id).toBe(newest.id);
        expect(response.json()[0].sources[0]).toMatchObject({
          source: "reddit",
          provider: "socialcrawl",
        });
      });
    });

    it("answers 404 for a monitor that is not this account's", async () => {
      /**
       * 404 and not an empty list. "You have no polls" and "that is not your
       * monitor" are different sentences, and answering the first for the
       * second is how a stranger learns an id exists.
       */
      const [row] = await db
        .insert(monitors)
        .values({
          userId: "somebody-else",
          name: "Not yours",
          product: "A test runner",
          idealCustomer: "Small SaaS teams",
          problem: "Flaky end-to-end tests",
          sources: ["reddit"],
        })
        .returning({ id: monitors.id });

      await withServer({}, async (app) => {
        const response = await app.inject({
          method: "GET",
          url: `/api/monitors/${row?.id}/polls`,
        });

        expect(response.statusCode).toBe(404);
      });
    });

    it("answers 404 for the monitor page of a monitor that is not this account's", async () => {
      // US-109 gave a monitor an address of its own, so an id typed into it is
      // a way to ask about a stranger's monitor. The same read answers.
      const [row] = await db
        .insert(monitors)
        .values({
          userId: "somebody-else",
          name: "Not yours",
          product: "A test runner",
          idealCustomer: "Small SaaS teams",
          problem: "Flaky end-to-end tests",
          sources: ["reddit"],
        })
        .returning({ id: monitors.id });

      await withServer({}, async (app) => {
        const response = await app.inject({ method: "GET", url: `/api/monitors/${row?.id}` });

        expect(response.statusCode).toBe(404);
        // And it is not in the list either, so its count is in nobody's row.
        const list = await app.inject({ method: "GET", url: "/api/monitors" });
        expect(list.json().some((one: { id: string }) => one.id === row?.id)).toBe(false);
      });
    });
  });

  describe("a new monitor is told how to reach its owner", () => {
    /**
     * US-093. Before this there was no `notification_settings` row until
     * somebody opened a screen and saved, so the running instance held zero
     * rows and zero deliveries against 174 posts and 20 matches: a monitor that
     * collected, classified and told nobody.
     */
    const settingsFor = (id: string) => readNotificationSettings(db, id);

    it("writes the settings, addressed to the signed-in account", async () => {
      await withServer({ canSendEmail: true }, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        const row = await settingsFor(created.json().id);

        expect(row?.emailEnabled).toBe(true);
        expect(row?.emailTo).toBe("owner@example.test");
        expect(row?.immediateScore).toBe(70);
        expect(row?.minScore).toBe(50);
        expect(row?.digestHours).toBe(24);
      });
    });

    it("invents no webhook", async () => {
      // A webhook needs a URL only the person has.
      await withServer({ canSendEmail: true }, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        const row = await settingsFor(created.json().id);

        expect(row?.webhookEnabled).toBe(false);
        expect(row?.webhookUrl).toBe("");
      });
    });

    it("sends no backlog: only matches found after the row is written count", async () => {
      // What makes defaulting this on safe. `enabled_since` is the moment the
      // monitor was created, so an inbox filled later is not posted at once.
      const before = new Date();

      await withServer({ canSendEmail: true }, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        const row = await settingsFor(created.json().id);

        expect(row?.enabledSince.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });
    });

    it("leaves email off on a deployment with no mailer", async () => {
      // Most self-hosted instances. The row exists and says off, so nothing is
      // queued and the notification screen names what is missing.
      await withServer({}, async (app) => {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: newMonitor,
        });

        const row = await settingsFor(created.json().id);

        expect(row?.emailEnabled).toBe(false);
        expect(row?.emailTo).toBe("owner@example.test");
      });
    });
  });
});
