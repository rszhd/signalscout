/**
 * The setup marker, driven through the server. US-105.
 *
 * The rule is core's; what this file guards is the wire: the route writes the
 * marker for the signed-in account, a second call changes nothing, and
 * `/api/auth-status` reports the answer the setup gate reads.
 */
import { createDatabase, createLogger, type Database, loadEnv } from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asOwner } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

describe("the setup marker route", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_onboarding");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  async function server() {
    const env = loadEnv({ DATABASE_URL: database.url });
    return buildServer({ session: asOwner, env, logger, db, queryGenerator: null });
  }

  it("marks the signed-in account, and the status route says so", async () => {
    const app = await server();

    try {
      const answer = await app.inject({ method: "PUT", url: "/api/onboarding" });

      expect(answer.statusCode).toBe(200);
      expect(answer.json()).toEqual({ onboarded: true });

      const status = await app.inject({ method: "GET", url: "/api/auth-status" });
      expect(status.json().onboarded).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("changes nothing on a second call", async () => {
    const app = await server();

    try {
      await app.inject({ method: "PUT", url: "/api/onboarding" });
      const second = await app.inject({ method: "PUT", url: "/api/onboarding" });

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ onboarded: true });
    } finally {
      await app.close();
    }
  });
});
