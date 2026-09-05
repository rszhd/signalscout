/**
 * The connections screen's server half: testing a key with the provider, and
 * storing one that passed.
 *
 * Correctness-critical: credential encryption. `credentials.test.ts` asserts
 * that no route returns a stored key, structurally, over every route this
 * build registers — including the ones added here. This file asserts the rules
 * that are particular to writing: a key the provider refused is not stored, a
 * provider that could not be reached is not the same answer as a refusal, and
 * an instance with no `ENCRYPTION_KEY` says so instead of failing at the write.
 *
 * No test here reaches a provider. The source is a fake with Reddit's id, so
 * the row it writes satisfies `source_credentials_source_known` and the probe
 * answers from memory.
 */
import {
  createDatabase,
  createLogger,
  type Database,
  fakeSourceDefinition,
  generateEncryptionKey,
  listCredentialHints,
  loadEnv,
  monitors,
  putSourceCredential,
  readEncryptionKey,
  type SocialSource,
  type SourceDefinition,
  sourceCredentials,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const logger = createLogger({ level: "silent", name: "test" });

/** The key a person pastes. Every leak assertion below is a substring match. */
const goodKey = "brd_7f3a91c4e08b2d65";
const encryptionKey = generateEncryptionKey();
const key = readEncryptionKey(encryptionKey);

const redditFields = [{ name: "apiKey", label: "Bright Data API key", secret: true }] as const;

/**
 * A source with Reddit's id that answers the probe without a network.
 *
 * `validCredentials` makes the fake refuse anything but `goodKey`, so the
 * accepted and the refused case differ by the value alone.
 */
function acceptsOnly(value: string): SourceDefinition {
  return fakeSourceDefinition({
    id: "reddit",
    displayName: "Reddit",
    credentialFields: [...redditFields],
    validCredentials: { apiKey: value },
  });
}

/** A source whose probe throws, the way an unreachable provider does. */
function unreachable(): SourceDefinition {
  const definition = acceptsOnly(goodKey);

  return {
    ...definition,
    create: (runtime) => {
      const source = definition.create(runtime);
      return {
        ...source,
        validateCredentials: () => Promise.reject(new TypeError("fetch failed")),
      } as SocialSource;
    },
  };
}

describe("connecting a provider", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_connections");
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

  async function server(options: {
    sources?: readonly SourceDefinition[];
    environment?: Record<string, string | undefined>;
    encryption?: Record<string, string | undefined>;
  }) {
    return buildServer({
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: options.sources ?? [acceptsOnly(goodKey)],
      environment: options.environment ?? {},
      encryption: options.encryption ?? { ENCRYPTION_KEY: encryptionKey },
      queryGenerator: null,
    });
  }

  async function stored() {
    return listCredentialHints(db);
  }

  describe("what the screen is told", () => {
    it("lists each field with its variable, and no value", async () => {
      const app = await server({ environment: {} });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/connections" })).json();

        expect(body.canStore).toBe(true);
        expect(body.sources).toEqual([
          {
            id: "reddit",
            displayName: "Reddit",
            ready: false,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "REDDIT_API_KEY",
                storedHint: null,
                fromEnvironment: false,
                configured: false,
              },
            ],
          },
        ]);
      } finally {
        await app.close();
      }
    });

    it("shows a stored key as a mask, and says it is stored", async () => {
      await putSourceCredential(db, key, { source: "reddit", field: "apiKey", value: goodKey });

      const app = await server({ environment: {} });

      try {
        const response = await app.inject({ method: "GET", url: "/api/connections" });
        const field = response.json().sources[0].credentials[0];

        expect(field.storedHint).toBe("••••2d65");
        expect(field.configured).toBe(true);
        expect(response.body).not.toContain(goodKey);
      } finally {
        await app.close();
      }
    });

    it("separates a key that is in the environment from one that is stored", async () => {
      // The screen offers different actions for the two. A stored key can be
      // deleted; an environment one is changed by editing a file and
      // restarting, and a delete button beside it would do nothing.
      const app = await server({ environment: { REDDIT_API_KEY: goodKey } });

      try {
        const field = (await app.inject({ method: "GET", url: "/api/connections" })).json()
          .sources[0].credentials[0];

        expect(field.fromEnvironment).toBe(true);
        expect(field.storedHint).toBe(null);
        expect(field.configured).toBe(true);
      } finally {
        await app.close();
      }
    });
  });

  describe("testing a key", () => {
    it("accepts a key the provider accepts, and stores nothing", async () => {
      const app = await server({});

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ valid: true, reason: null });
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("reports the provider's own sentence when it refuses the key", async () => {
      const app = await server({});

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: { credentials: { apiKey: "brd_wrong" } },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().valid).toBe(false);
        expect(response.json().reason).toContain("Bright Data API key");
      } finally {
        await app.close();
      }
    });

    it("answers a provider it could not reach differently from a refusal", async () => {
      // The two need different actions: a refusal means the key is wrong, and
      // an outage means try again. One answer for both sends a person looking
      // for a typo in a key that is correct.
      const app = await server({ sources: [unreachable()] });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(502);
        expect(response.json().message).toMatch(/could not be reached/i);
      } finally {
        await app.close();
      }
    });

    it("tests what is already configured when no key is typed", async () => {
      const app = await server({ environment: { REDDIT_API_KEY: goodKey } });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: {},
        });

        expect(response.json()).toEqual({ valid: true, reason: null });
      } finally {
        await app.close();
      }
    });

    it("says which field is empty when there is nothing to test", async () => {
      const app = await server({ environment: {} });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: {},
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain("Bright Data API key");
      } finally {
        await app.close();
      }
    });

    it("refuses a source that is not registered, naming it", async () => {
      const app = await server({});

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/bluesky/test",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json().message).toContain("bluesky");
      } finally {
        await app.close();
      }
    });
  });

  describe("storing a key", () => {
    it("stores a key the provider accepted, encrypted", async () => {
      const app = await server({});

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().credentials[0].storedHint).toBe("••••2d65");
        expect(response.body).not.toContain(goodKey);

        const [row] = await db.select().from(sourceCredentials);
        expect(row?.ciphertext).toMatch(/^v1\./);
        expect(row?.ciphertext).not.toContain(goodKey);
      } finally {
        await app.close();
      }
    });

    it("does not store a key the provider refused", async () => {
      // The whole reason the test runs before the write. A key that is present
      // and wrong passes every check we have and fails at the first poll.
      const app = await server({});

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: "brd_wrong" } },
        });

        expect(response.statusCode).toBe(400);
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("does not store a key it could not test", async () => {
      const app = await server({ sources: [unreachable()] });

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(502);
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("replaces a stored key with a new one", async () => {
      const second = "brd_0000111122223333";
      await putSourceCredential(db, key, { source: "reddit", field: "apiKey", value: goodKey });

      const app = await server({ sources: [acceptsOnly(second)] });

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: second } },
        });

        expect(response.statusCode).toBe(200);
        expect((await stored()).map((hint) => hint.hint)).toEqual(["••••3333"]);
      } finally {
        await app.close();
      }
    });

    it("deletes a stored key", async () => {
      await putSourceCredential(db, key, { source: "reddit", field: "apiKey", value: goodKey });

      const app = await server({ environment: {} });

      try {
        const response = await app.inject({
          method: "DELETE",
          url: "/api/connections/reddit/apiKey",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().credentials[0].configured).toBe(false);
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("refuses a field the source does not have", async () => {
      const app = await server({});

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiSecret: goodKey } },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain("apiSecret");
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });
  });

  describe("an instance with no encryption key", () => {
    it("says which variable to set, and offers no store", async () => {
      const app = await server({ encryption: {} });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/connections" })).json();

        expect(body.canStore).toBe(false);
        expect(body.storeBlocker).toContain("ENCRYPTION_KEY");
        expect(body.storeBlocker).toContain("openssl rand -base64 32");
      } finally {
        await app.close();
      }
    });

    it("refuses a write with that sentence rather than throwing at the cipher", async () => {
      const app = await server({ encryption: {} });

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json().message).toContain("ENCRYPTION_KEY");
        expect(await stored()).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it("still tests a key, because testing stores nothing", async () => {
      const app = await server({ encryption: {} });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/reddit/test",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.json()).toEqual({ valid: true, reason: null });
      } finally {
        await app.close();
      }
    });
  });

  describe("a monitor that was waiting for the key", () => {
    it("starts once the key is stored, without a restart", async () => {
      // The end of the path US-010 left open. A monitor created with no
      // credential is created and paused, and its resume is refused with the
      // name of what is missing. Storing the key here is what turns that
      // refusal into a start, and nothing in between restarts the process.
      const app = await server({ environment: {} });

      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/monitors",
          payload: {
            name: "Teams replacing manual QA",
            product: "An automated end-to-end testing tool.",
            idealCustomer: "A QA lead at a small software company.",
            problem: "Their end-to-end tests break on every release.",
            signals: ["problem"],
            queries: ["end to end tests keep breaking"],
            sources: ["reddit"],
          },
        });

        expect(created.statusCode).toBe(201);
        const monitorId = created.json().id;
        expect(created.json().paused).toBe(true);
        expect(created.json().missingCredentials[0].environmentVariable).toBe("REDDIT_API_KEY");

        const refused = await app.inject({
          method: "POST",
          url: `/api/monitors/${monitorId}/resume`,
        });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain("REDDIT_API_KEY");

        await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: goodKey } },
        });

        const resumed = await app.inject({
          method: "POST",
          url: `/api/monitors/${monitorId}/resume`,
        });

        expect(resumed.statusCode).toBe(200);
        expect(resumed.json().paused).toBe(false);
        expect(resumed.json().missingCredentials).toEqual([]);
      } finally {
        await app.close();
      }
    });
  });

  describe("readiness, after a write", () => {
    it("reports a key stored in this process without a restart", async () => {
      // `startApi` used to read the stored names once and hand the routes a
      // snapshot. The moment a route can write one, that snapshot is a lie
      // until the process restarts, and the monitor form would go on saying
      // the key is missing.
      const app = await server({ environment: {} });

      try {
        const before = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        expect(before.sources[0].ready).toBe(false);

        await app.inject({
          method: "PUT",
          url: "/api/connections/reddit",
          payload: { credentials: { apiKey: goodKey } },
        });

        const after = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        expect(after.sources[0].ready).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("reports a key deleted in this process without a restart", async () => {
      await putSourceCredential(db, key, { source: "reddit", field: "apiKey", value: goodKey });

      const app = await server({ environment: {} });

      try {
        expect(
          (await app.inject({ method: "GET", url: "/api/monitor-options" })).json().sources[0]
            .ready,
        ).toBe(true);

        await app.inject({ method: "DELETE", url: "/api/connections/reddit/apiKey" });

        expect(
          (await app.inject({ method: "GET", url: "/api/monitor-options" })).json().sources[0]
            .ready,
        ).toBe(false);
      } finally {
        await app.close();
      }
    });
  });
});
