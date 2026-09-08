/**
 * The cost test routes, against real Postgres.
 *
 * Nothing here runs a sample: the worker does that, and `worker/estimate.ts`
 * owns those assertions. What these tests own is the other half — what a
 * person meets. That the run is written before the job is sent, that the job
 * is sent once, that a named monitor's own cap is what the answer is measured
 * against, and that reading the answer back cannot spend anything.
 */
import {
  builtInSources,
  createDatabase,
  createLogger,
  type Database,
  type JobSender,
  loadEnv,
  monitors,
  queryEstimates,
  readEstimate,
  setBudget,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { asOwner } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

const plan = {
  queries: { reddit: ["flaky end to end tests", "manual qa before every release"] },
  subreddits: ["SaaS"],
  sources: ["reddit"],
};

function stubJobs() {
  const sendEstimate = vi.fn(async (_estimateId: string) => "job-1");

  return { sendEstimate, jobs: { sendEstimate, stop: async () => {} } as JobSender };
}

describe("the cost test routes", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_estimates");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(queryEstimates);
    await db.delete(monitors);
  });

  async function withServer<T>(
    jobs: JobSender | null,
    body: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<T>,
  ): Promise<T> {
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: builtInSources,
      environment: { REDDIT_API_KEY: "bd-test-key" },
      queryGenerator: null,
      jobs,
    });

    try {
      return await body(app);
    } finally {
      await app.close();
    }
  }

  it("writes one probe per query and per subreddit, and queues the run once", async () => {
    const { jobs, sendEstimate } = stubJobs();

    await withServer(jobs, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: plan,
      });

      // 202: the answer is not ready, and the run is where it will be.
      expect(response.statusCode).toBe(202);

      const body = response.json();

      expect(body.status).toBe("collecting");
      expect(body.queries.map((probe: { term: string }) => probe.term)).toEqual([
        "flaky end to end tests",
        "manual qa before every release",
        "SaaS",
      ]);
      expect(body.queries.map((probe: { kind: string }) => probe.kind)).toEqual([
        "query",
        "query",
        "channel",
      ]);

      expect(sendEstimate).toHaveBeenCalledTimes(1);
      expect(sendEstimate).toHaveBeenCalledWith(body.id);
    });
  });

  it("measures a named monitor against that monitor's own cap and interval", async () => {
    // The flag has to name the number the budget guard will refuse them at.
    // A cap taken from the request body would be a number the caller chose.
    const { jobs } = stubJobs();

    await withServer(jobs, async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/monitors",
        payload: {
          name: "Journeys",
          product: "A test runner that records browser flows",
          idealCustomer: "Small SaaS teams with no dedicated QA engineer",
          problem: "End-to-end tests break whenever the UI changes",
          signals: [],
          ...plan,
          pollIntervalSeconds: 7200,
        },
      });
      const monitorId = created.json().id as string;

      await setBudget(db, monitorId, { monthlyCapMicros: 5_000_000, onExhausted: "pause" });

      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: { ...plan, monitorId, pollIntervalSeconds: 60, monthlyCapMicros: 999 },
      });
      const body = response.json();

      expect(body.monitorId).toBe(monitorId);
      // The monitor's, not the body's.
      expect(body.pollIntervalSeconds).toBe(7200);
      expect(body.totals.capMicros).toBe(5_000_000);
    });
  });

  it("refuses a plan with nothing in it, before anything is queued", async () => {
    const { jobs, sendEstimate } = stubJobs();

    await withServer(jobs, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: { queries: {}, subreddits: [], sources: ["reddit"] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/nothing to test/i);
      expect(sendEstimate).not.toHaveBeenCalled();
      expect(await db.select().from(queryEstimates)).toHaveLength(0);
    });
  });

  it("says so when there is no worker to run the test", async () => {
    // A run nothing will pick up is a screen that waits for an answer that is
    // not coming.
    await withServer(null, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: plan,
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().message).toMatch(/worker/i);
      expect(await db.select().from(queryEstimates)).toHaveLength(0);
    });
  });

  it("marks the run failed when the queue refuses the job", async () => {
    const jobs = {
      sendEstimate: async () => {
        throw new Error("the queue is not reachable");
      },
      stop: async () => {},
    } as JobSender;

    await withServer(jobs, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: plan,
      });
      const body = response.json();

      expect(body.status).toBe("failed");
      expect(body.error).toMatch(/could not be queued/i);
    });
  });

  it("reads a run back without asking a source for anything", async () => {
    const { jobs } = stubJobs();

    await withServer(jobs, async (app) => {
      const started = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: plan,
      });
      const id = started.json().id as string;

      const read = await app.inject({ method: "GET", url: `/api/monitors/estimates/${id}` });

      expect(read.statusCode).toBe(200);
      expect(read.json().id).toBe(id);
      // A refresh spends nothing: the probes are where the first answer left
      // them.
      expect((await readEstimate(db, id))?.probes[0]?.status).toBe("collecting");
    });
  });

  it("answers 404 for a run that does not exist", async () => {
    const { jobs } = stubJobs();

    await withServer(jobs, async (app) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/monitors/estimates/00000000-0000-4000-8000-000000000000",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it("refuses a query the search cannot run, before it is billed for it", async () => {
    // The same rule the monitor form applies to a generated query. A query
    // carrying Boolean syntax is searched literally, finds nothing, and costs
    // the same as one that works.
    const { jobs } = stubJobs();

    await withServer(jobs, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors/estimates",
        payload: { ...plan, queries: { reddit: ['"flaky tests" AND ci'] } },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
