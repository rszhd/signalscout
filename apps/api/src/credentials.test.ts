/**
 * The half of US-004 that `packages/core` cannot assert: what an HTTP response
 * carries, and what the process does at boot with a credential it cannot read.
 *
 * Correctness-critical: credential encryption. The failure shape from
 * docs/testing.md is "a key reaches a log line or an API response", and the
 * log line is pinned in `packages/core/src/secrets/leak.test.ts`. This file
 * pins the response, against real Postgres and a real server.
 */
import {
  builtInSources,
  createDatabase,
  createLogger,
  type Database,
  generateEncryptionKey,
  listCredentialHints,
  loadEnv,
  monitors,
  putSourceCredential,
  readEncryptionKey,
  sourceCredentials,
  UndecryptableSecretError,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { startApi } from "./start.js";

const logger = createLogger({ level: "silent", name: "test" });

/** One value. A leak anywhere below is a substring match, not a judgement. */
const secret = "brd_7f3a91c4e08b2d65";
const key = readEncryptionKey(generateEncryptionKey());
const otherKey = generateEncryptionKey();

describe("a stored credential and the API", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_credentials");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(sourceCredentials);
    await db.delete(monitors);
  });

  async function storedSet() {
    return new Set((await listCredentialHints(db)).map((hint) => `${hint.provider}:${hint.field}`));
  }

  async function server(options: {
    environment?: Record<string, string | undefined>;
    storedCredentials?: () => Promise<ReadonlySet<string>>;
  }) {
    return buildServer({
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: builtInSources,
      queryGenerator: null,
      ...options,
    });
  }

  describe("what a response carries", () => {
    it("never carries a key that came from the environment", async () => {
      const app = await server({ environment: { BRIGHTDATA_API_KEY: secret } });

      try {
        for (const url of [
          "/api/monitor-options",
          "/api/monitors",
          "/api/matches",
          "/api/health",
        ]) {
          const response = await app.inject({ method: "GET", url });

          expect(response.body, `${url} carried the key`).not.toContain(secret);
        }
      } finally {
        await app.close();
      }
    });

    it("never carries a key that came from the database", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      const app = await server({ environment: {}, storedCredentials: storedSet });

      try {
        for (const url of ["/api/monitor-options", "/api/monitors", "/api/matches"]) {
          const response = await app.inject({ method: "GET", url });

          expect(response.body, `${url} carried the key`).not.toContain(secret);
        }
      } finally {
        await app.close();
      }
    });

    it("says a source is configured without saying what with", async () => {
      const app = await server({ environment: { BRIGHTDATA_API_KEY: secret } });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        const reddit = body.sources.find((source: { id: string }) => source.id === "reddit");

        // Nothing is missing, so nothing is named. The variable appears only
        // when a person has to go and set it.
        expect(reddit.missingCredentials).toEqual([]);
        expect(reddit.ready).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("counts a stored credential as configured, the same as an environment one", async () => {
      // Otherwise a person who moved a key into the database is told their
      // source is not set up, while the worker polls it happily.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      const app = await server({ environment: {}, storedCredentials: storedSet });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        const reddit = body.sources.find((source: { id: string }) => source.id === "reddit");

        expect(reddit.missingCredentials).toEqual([]);
        expect(reddit.ready).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("still reports a source with no credential anywhere as unconfigured", async () => {
      // The pass and the fail of the rule above have to differ, or it is
      // asserting nothing. docs/testing.md, *A guard whose pass and fail share
      // an answer is guarding nothing*.
      const app = await server({ environment: {}, storedCredentials: async () => new Set() });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        const reddit = body.sources.find((source: { id: string }) => source.id === "reddit");

        expect(reddit.missingCredentials[0].environmentVariable).toBe("BRIGHTDATA_API_KEY");
        expect(reddit.ready).toBe(false);
      } finally {
        await app.close();
      }
    });

    it("has no route that returns a stored credential", async () => {
      // Structural, not a sample: every route this build registers, by method
      // and path. A route added later that serves a key has to pass this.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      const app = await server({ environment: {}, storedCredentials: storedSet });

      try {
        const routes = app
          .printRoutes({ commonPrefix: false })
          .split("\n")
          .filter((line) => /\((GET|POST|PUT|PATCH|DELETE)/.test(line));

        // The tree really was read. An empty list would pass the next line.
        expect(routes.length).toBeGreaterThan(5);
        expect(routes.join("\n")).not.toMatch(/credential|secret|apikey/i);
      } finally {
        await app.close();
      }
    });
  });

  describe("the boot check", () => {
    it("refuses to start when a stored credential cannot be decrypted", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      await expect(
        startApi({
          env: loadEnv({
            DATABASE_URL: database.url,
            WORKER_IN_PROCESS: "false",
            ENCRYPTION_KEY: otherKey,
          }),
          logger,
          createDatabase: () => ({ db, pool: {}, close: async () => undefined }) as never,
          startJobSender: vi.fn(async () => ({ send: vi.fn(), stop: vi.fn() })) as never,
          buildServer: vi.fn() as never,
        }),
      ).rejects.toThrow(UndecryptableSecretError);
    });

    it("refuses to start when a credential is stored and no key is set", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      await expect(
        startApi({
          env: loadEnv({ DATABASE_URL: database.url, WORKER_IN_PROCESS: "false" }),
          logger,
          createDatabase: () => ({ db, pool: {}, close: async () => undefined }) as never,
          startJobSender: vi.fn(async () => ({ send: vi.fn(), stop: vi.fn() })) as never,
          buildServer: vi.fn() as never,
        }),
      ).rejects.toThrow(/ENCRYPTION_KEY/);
    });

    it("never puts the value in the message it refuses with", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      try {
        await startApi({
          env: loadEnv({
            DATABASE_URL: database.url,
            WORKER_IN_PROCESS: "false",
            ENCRYPTION_KEY: otherKey,
          }),
          logger,
          createDatabase: () => ({ db, pool: {}, close: async () => undefined }) as never,
          startJobSender: vi.fn(async () => ({ send: vi.fn(), stop: vi.fn() })) as never,
          buildServer: vi.fn() as never,
        });
        expect.unreachable("startApi must refuse a credential it cannot read");
      } catch (error) {
        expect(String(error)).not.toContain(secret);
        expect(String(error)).toContain("brightdata:apiKey");
      }
    });
  });
});
