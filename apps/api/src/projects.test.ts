/**
 * The project routes, driven through the server. US-045.
 *
 * What these cases guard is the wire, not the rule: `projects.test.ts` in core
 * owns the rule. Two of them exist because a route is where the rules get lost
 * — a `PATCH` that fills the fields a request did not carry, and a refusal that
 * answers 200 with nothing in it.
 */
import {
  createDatabase,
  createLogger,
  type Database,
  type DescribeResult,
  loadEnv,
  modelCalls,
  type ProjectDescriber,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asOwner } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

const answers = {
  name: "Acme QA",
  product: "A test runner for small teams",
  idealCustomer: "Small SaaS teams with no dedicated QA",
  problem: "Their end to end tests break on every UI change",
  signals: ["problem"],
};

describe("the project routes", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_projects");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  /** A describer that answers whatever a case needs, without a model. */
  function describerAnswering(result: DescribeResult): ProjectDescriber {
    return {
      provider: "anthropic",
      model: "test",
      describe: async () => result,
    };
  }

  const draft = {
    status: "ok" as const,
    object: {
      name: "Acme QA",
      product: "A test runner for small teams",
      idealCustomer: "Small SaaS teams",
      problem: "Tests break on every UI change",
      signals: ["problem" as const],
      missing: ["how it is priced"],
    },
    call: {
      provider: "anthropic" as const,
      model: "test",
      latencyMs: 12,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostMicros: 900,
    },
  };

  async function server(describer: ProjectDescriber | null = describerAnswering(draft)) {
    const env = loadEnv({ DATABASE_URL: database.url });
    return buildServer({ session: asOwner, env, logger, db, queryGenerator: null, describer });
  }

  async function post(url: string, body: Record<string, unknown>) {
    const app = await server();
    try {
      return await app.inject({ method: "POST", url, payload: body });
    } finally {
      await app.close();
    }
  }

  async function send(
    method: "GET" | "PATCH" | "DELETE",
    url: string,
    body?: Record<string, unknown>,
  ) {
    const app = await server();
    try {
      return body === undefined
        ? await app.inject({ method, url })
        : await app.inject({ method, url, payload: body });
    } finally {
      await app.close();
    }
  }

  let created: { id: string };

  beforeEach(async () => {
    const response = await post("/api/projects", answers);
    created = response.json();
  });

  it("creates a project and answers 201 with it", async () => {
    const response = await post("/api/projects", { ...answers, name: "Beta" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Beta",
      product: answers.product,
      monitorCount: 0,
    });
  });

  /**
   * The project form stopped asking for signals, so the body arrives without.
   *
   * A required field would answer 400 to every project the screen now makes.
   * The column stays for the projects that already hold one, and absent means
   * none rather than a refusal.
   */
  it("creates a project that names no signals", async () => {
    const response = await post("/api/projects", {
      name: "Gamma",
      product: answers.product,
      idealCustomer: answers.idealCustomer,
      problem: answers.problem,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().signals).toEqual([]);
  });

  it("refuses a project with no product", async () => {
    const response = await post("/api/projects", { ...answers, product: "" });

    expect(response.statusCode).toBe(400);
  });

  it("lists what was created", async () => {
    const response = await send("GET", "/api/projects");

    expect(response.statusCode).toBe(200);
    expect(response.json().projects.map((p: { name: string }) => p.name)).toContain("Acme QA");
  });

  /**
   * US-022's bug, on a new table.
   *
   * A `PATCH` carrying one field erased every field it did not carry, because
   * the body schema filled the absent keys with its own defaults. The fix is
   * a schema with no defaults, and this is the case that keeps it.
   */
  it("changes only the field a PATCH carries", async () => {
    const response = await send("PATCH", `/api/projects/${created.id}`, { name: "Acme QA (EU)" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Acme QA (EU)",
      product: answers.product,
      idealCustomer: answers.idealCustomer,
      problem: answers.problem,
    });
  });

  it("answers 404 for a project that is not there", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";

    expect((await send("GET", `/api/projects/${missing}`)).statusCode).toBe(404);
    expect((await send("PATCH", `/api/projects/${missing}`, { name: "x" })).statusCode).toBe(404);
    expect((await send("DELETE", `/api/projects/${missing}`)).statusCode).toBe(404);
  });

  /**
   * The point of a project, asserted through the wire that carries it.
   *
   * A monitor made in a project records where its answers came from, so the
   * monitor list can group and the inbox can filter. The answers themselves
   * are a copy and are already on the monitor.
   */
  it("records the project a monitor was made in", async () => {
    const app = await server();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/monitors",
        payload: {
          name: "Reddit, weekly",
          product: answers.product,
          idealCustomer: answers.idealCustomer,
          problem: answers.problem,
          signals: answers.signals,
          projectId: created.id,
          queries: { reddit: ["flaky tests"] },
          subreddits: [],
          sources: [],
        },
      });

      expect(response.statusCode).toBe(201);

      const listed = await app.inject({ method: "GET", url: "/api/projects" });
      const project = listed.json().projects.find((p: { id: string }) => p.id === created.id) as {
        monitorCount: number;
      };

      expect(project.monitorCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("deletes a project and answers 204", async () => {
    const response = await send("DELETE", `/api/projects/${created.id}`);

    expect(response.statusCode).toBe(204);
    expect((await send("GET", `/api/projects/${created.id}`)).statusCode).toBe(404);
  });
});

describe("drafting a project from a document", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_projects_describe");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  const good = {
    status: "ok" as const,
    object: {
      name: "Acme QA",
      product: "A test runner",
      idealCustomer: "Small SaaS teams",
      problem: "Tests break on every UI change",
      signals: ["problem" as const],
      missing: ["how it is priced"],
    },
    call: {
      provider: "anthropic" as const,
      model: "test",
      latencyMs: 12,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostMicros: 900,
    },
  };

  beforeEach(async () => {
    // One case counts the calls it caused, so it must not count another's.
    await db.delete(modelCalls);
  });

  async function describing(result: DescribeResult | null, body: Record<string, unknown>) {
    const env = loadEnv({ DATABASE_URL: database.url });
    const app = await buildServer({
      session: asOwner,
      env,
      logger,
      db,
      queryGenerator: null,
      describer:
        result === null
          ? null
          : { provider: "anthropic", model: "test", describe: async () => result },
    });

    try {
      return await app.inject({ method: "POST", url: "/api/projects/describe", payload: body });
    } finally {
      await app.close();
    }
  }

  it("drafts the four answers from an uploaded document", async () => {
    const response = await describing(good, {
      text: "Acme QA is a test runner for small teams whose tests break on every UI change.",
      contentType: "text/markdown",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Acme QA",
      product: "A test runner",
      // Shown rather than swallowed: a person needs to know which field was
      // guessed at before they save it.
      missing: ["how it is priced"],
    });
  });

  it("records the call, because no monitor and no budget will", async () => {
    await describing(good, { text: "Acme QA is a test runner.", contentType: "text/plain" });

    const calls = await db.select().from(modelCalls);
    const analysis = calls.filter((call) => call.purpose === "project_analysis");

    expect(analysis).toHaveLength(1);
    // No monitor exists yet, which is why the column is nullable.
    expect(analysis[0]?.monitorId).toBeNull();
    expect(analysis[0]?.estimatedCostMicros).toBe(900);
  });

  it("refuses a document with no words rather than paying to be told so", async () => {
    const response = await describing(good, { text: "   ", contentType: "text/plain" });

    expect(response.statusCode).toBe(400);
    // Nothing was called, so nothing was billed.
    expect(await db.select().from(modelCalls)).toHaveLength(0);
  });

  it("refuses a URL this server must not fetch, naming why", async () => {
    const response = await describing(good, { url: "http://169.254.169.254/latest/meta-data/" });

    expect(response.statusCode).toBe(400);
    // The scheme is refused before anything resolves or connects.
    expect(response.json().message).toContain("https");
  });

  it("will not take a URL and a document at once", async () => {
    const response = await describing(good, { url: "https://example.test/", text: "hello" });

    expect(response.statusCode).toBe(400);
  });

  it("says so when this instance has no model key", async () => {
    const response = await describing(null, { text: "hello", contentType: "text/plain" });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toContain("no model key");
  });

  it("tells a model that refused apart from one that broke", async () => {
    const refused = await describing(
      { status: "rejected", error: "That is not a product page.", call: good.call },
      { text: "a shopping list", contentType: "text/plain" },
    );

    expect(refused.statusCode).toBe(422);

    const broke = await describing(
      { status: "failed", error: "the provider timed out", call: good.call },
      { text: "a page", contentType: "text/plain" },
    );

    // 422 is about the document; 502 is about the provider. A person's next
    // action differs, so the codes do.
    expect(broke.statusCode).toBe(502);
  });
});
