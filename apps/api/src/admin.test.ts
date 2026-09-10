/**
 * The admin registrations route. US-111.
 *
 * The claim worth guarding is the refusal: the endpoint returns every
 * account's data, so an account that is signed in and not listed must be
 * turned away, and an instance with no list must turn everybody away. The
 * shape of the answer is asserted once, against a real row.
 */
import { createDatabase, createLogger, type Database, loadEnv, users } from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asUser } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

describe("the admin registrations route", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_admin");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  beforeEach(async () => {
    await db.delete(users);
  });

  /** A server whose session is `session` and whose admin list is `admins`. */
  async function server(
    admins: string | undefined,
    session = asUser("someone"),
  ): Promise<Awaited<ReturnType<typeof buildServer>>> {
    const env = loadEnv({ DATABASE_URL: database.url, ADMIN_EMAILS: admins });
    return buildServer({ session, env, logger, db, queryGenerator: null });
  }

  it("refuses a signed-in account that is not listed", async () => {
    const app = await server("admin@example.test", asUser("someone"));

    try {
      const reply = await app.inject({ method: "GET", url: "/api/admin/registrations" });

      expect(reply.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("refuses everybody when no admin is configured", async () => {
    // The safe default. A self-hosted instance that never sets the variable
    // must not hand every account's data to whoever asks.
    const app = await server(undefined, asUser("admin"));

    try {
      const reply = await app.inject({ method: "GET", url: "/api/admin/registrations" });

      expect(reply.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("answers a listed account with the day's registrations", async () => {
    await db.insert(users).values({ id: "newbie", name: "New Person", email: "new@example.test" });

    const app = await server("admin@example.test", asUser("admin"));

    try {
      const reply = await app.inject({ method: "GET", url: "/api/admin/registrations" });

      expect(reply.statusCode).toBe(200);
      const body = reply.json() as {
        date: string;
        users: { id: string; createdAt: string; projects: number }[];
        totals: { users: number };
      };

      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.users.map((one) => one.id)).toContain("newbie");
      expect(body.users[0]?.createdAt).toMatch(/T/);
      expect(body.totals.users).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("is behind the session gate", async () => {
    const app = await server("admin@example.test", async () => null);

    try {
      const reply = await app.inject({ method: "GET", url: "/api/admin/registrations" });

      expect(reply.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
