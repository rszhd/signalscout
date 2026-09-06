/**
 * The project routes, driven through the server. US-045.
 *
 * What these cases guard is the wire, not the rule: `projects.test.ts` in core
 * owns the rule. Two of them exist because a route is where the rules get lost
 * — a `PATCH` that fills the fields a request did not carry, and a refusal that
 * answers 200 with nothing in it.
 */
import { createDatabase, createLogger, type Database, loadEnv } from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

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

  async function server() {
    const env = loadEnv({ DATABASE_URL: database.url });
    return buildServer({ env, logger, db, queryGenerator: null });
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
