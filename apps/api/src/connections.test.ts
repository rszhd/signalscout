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
  type ConnectorDefinition,
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
  readSourceCredential,
  type SocialSource,
  sourceCredentials,
  sourceProviders,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asOwner, asUser, testOwner as owner } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

/** The key a person pastes. Every leak assertion below is a substring match. */
const goodKey = "brd_7f3a91c4e08b2d65";
const encryptionKey = generateEncryptionKey();
const key = readEncryptionKey(encryptionKey);

const redditFields = [{ name: "apiKey", label: "Bright Data API key", secret: true }] as const;

/**
 * The Reddit-through-Bright-Data pair, answering the probe without a network.
 *
 * `validCredentials` makes the fake refuse anything but `goodKey`, so the
 * accepted and the refused case differ by the value alone.
 */
function acceptsOnly(value: string): ConnectorDefinition {
  return fakeSourceDefinition({
    id: "reddit",
    displayName: "Reddit",
    providerId: "brightdata",
    providerName: "Bright Data",
    credentialFields: [...redditFields],
    validCredentials: { apiKey: value },
  });
}

/** A source whose probe throws, the way an unreachable provider does. */
function unreachable(): ConnectorDefinition {
  const definition = acceptsOnly(goodKey);

  return {
    ...definition,
    create: (runtime: Parameters<ConnectorDefinition["create"]>[0]) => {
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
    await db.delete(sourceProviders);
    await db.delete(monitors);
  });

  async function server(options: {
    sources?: readonly ConnectorDefinition[];
    environment?: Record<string, string | undefined>;
    encryption?: Record<string, string | undefined>;
    signup?: "open" | "closed";
  }) {
    return buildServer({
      session: asOwner,
      env: loadEnv({
        DATABASE_URL: database.url,
        ...(options.signup ? { AUTH_SIGNUP: options.signup } : {}),
      }),
      logger,
      db,
      sources: options.sources ?? [acceptsOnly(goodKey)],
      environment: options.environment ?? {},
      encryption: options.encryption ?? { ENCRYPTION_KEY: encryptionKey },
      queryGenerator: null,
    });
  }

  async function stored() {
    return listCredentialHints(db, owner);
  }

  /** The same build, signed in as somebody else. US-067. */
  async function serverAs(userId: string) {
    return buildServer({
      session: asUser(userId),
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [acceptsOnly(goodKey)],
      environment: {},
      encryption: { ENCRYPTION_KEY: encryptionKey },
      queryGenerator: null,
    });
  }

  /** Reddit through both of its providers, which is what a choice looks like. */
  function bothRedditProviders(): ConnectorDefinition[] {
    return [
      acceptsOnly(goodKey),
      fakeSourceDefinition({
        id: "reddit",
        displayName: "Reddit",
        providerId: "scrapecreators",
        providerName: "ScrapeCreators",
        credentialFields: [{ name: "apiKey", label: "ScrapeCreators API key", secret: true }],
        validCredentials: { apiKey: goodKey },
      }),
    ];
  }

  function platformIn(body: { platforms: { id: string }[] }, id = "reddit") {
    const found = body.platforms.find((platform) => platform.id === id);
    if (!found) throw new Error(`The response has no platform "${id}".`);

    return found as Record<string, unknown>;
  }

  describe("what the screen is told", () => {
    it("lists each field with its variable, and no value", async () => {
      const app = await server({ environment: {} });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/connections" })).json();

        expect(body.canStore).toBe(true);
        expect(body.providers).toEqual([
          {
            id: "brightdata",
            displayName: "Bright Data",
            // The platforms this one key unlocks, so a person reading "Bright
            // Data" still knows it is Reddit they are connecting.
            platforms: ["Reddit"],
            ready: false,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "BRIGHTDATA_API_KEY",
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
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: goodKey,
      });

      const app = await server({ environment: {} });

      try {
        const response = await app.inject({ method: "GET", url: "/api/connections" });
        const field = response.json().providers[0].credentials[0];

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
      const app = await server({ environment: { BRIGHTDATA_API_KEY: goodKey } });

      try {
        const field = (await app.inject({ method: "GET", url: "/api/connections" })).json()
          .providers[0].credentials[0];

        expect(field.fromEnvironment).toBe(true);
        expect(field.storedHint).toBe(null);
        expect(field.configured).toBe(true);
      } finally {
        await app.close();
      }
    });
    /**
     * The machine's provider keys are the machine's, on an instance taking
     * registrations. US-081.
     *
     * Without this a stranger who signs up polls Bright Data on the owner's
     * account, and the first anybody knows of it is the invoice.
     */
    it("does not offer a key from the environment when signup is open", async () => {
      const app = await server({
        environment: { BRIGHTDATA_API_KEY: goodKey },
        signup: "open",
      });

      try {
        const field = (await app.inject({ method: "GET", url: "/api/connections" })).json()
          .providers[0].credentials[0];

        expect(field.fromEnvironment).toBe(false);
        expect(field.configured).toBe(false);
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
          url: "/api/connections/brightdata/test",
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
          url: "/api/connections/brightdata/test",
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
          url: "/api/connections/brightdata/test",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(response.statusCode).toBe(502);
        expect(response.json().message).toMatch(/could not be reached/i);
      } finally {
        await app.close();
      }
    });

    it("tests what is already configured when no key is typed", async () => {
      const app = await server({ environment: { BRIGHTDATA_API_KEY: goodKey } });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/connections/brightdata/test",
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
          url: "/api/connections/brightdata/test",
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
          url: "/api/connections/brightdata",
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
          url: "/api/connections/brightdata",
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
          url: "/api/connections/brightdata",
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
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: goodKey,
      });

      const app = await server({ sources: [acceptsOnly(second)] });

      try {
        const response = await app.inject({
          method: "PUT",
          url: "/api/connections/brightdata",
          payload: { credentials: { apiKey: second } },
        });

        expect(response.statusCode).toBe(200);
        expect((await stored()).map((hint) => hint.hint)).toEqual(["••••3333"]);
      } finally {
        await app.close();
      }
    });

    it("deletes a stored key", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: goodKey,
      });

      const app = await server({ environment: {} });

      try {
        const response = await app.inject({
          method: "DELETE",
          url: "/api/connections/brightdata/apiKey",
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
          url: "/api/connections/brightdata",
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
          url: "/api/connections/brightdata",
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
          url: "/api/connections/brightdata/test",
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
            queries: { reddit: ["end to end tests keep breaking"] },
            sources: ["reddit"],
          },
        });

        expect(created.statusCode).toBe(201);
        const monitorId = created.json().id;
        expect(created.json().paused).toBe(true);
        expect(created.json().missingCredentials[0].environmentVariable).toBe("BRIGHTDATA_API_KEY");

        const refused = await app.inject({
          method: "POST",
          url: `/api/monitors/${monitorId}/resume`,
        });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain("BRIGHTDATA_API_KEY");

        await app.inject({
          method: "PUT",
          url: "/api/connections/brightdata",
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
          url: "/api/connections/brightdata",
          payload: { credentials: { apiKey: goodKey } },
        });

        const after = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        expect(after.sources[0].ready).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("reports a key deleted in this process without a restart", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: goodKey,
      });

      const app = await server({ environment: {} });

      try {
        expect(
          (await app.inject({ method: "GET", url: "/api/monitor-options" })).json().sources[0]
            .ready,
        ).toBe(true);

        await app.inject({ method: "DELETE", url: "/api/connections/brightdata/apiKey" });

        expect(
          (await app.inject({ method: "GET", url: "/api/monitor-options" })).json().sources[0]
            .ready,
        ).toBe(false);
      } finally {
        await app.close();
      }
    });
  });
  /**
   * Which provider fetches a platform.
   *
   * US-026 put it on this screen and not on the monitor form: a person ticks
   * networks to watch, and which account pays for each one is decided once,
   * here, for every monitor. The rules are `decideProvider`'s, so what these
   * cases own is the sentence a person reads and what the routes write.
   */
  describe("which provider fetches a platform", () => {
    it("names the one provider, and asks nothing, when only one has a key", async () => {
      // The common deployment: two connectors in the build, one account held.
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey },
      });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/connections" })).json();
        const reddit = platformIn(body);

        expect(reddit.effective).toBe("brightdata");
        expect(reddit.needsChoice).toBe(false);
        expect(reddit.chosen).toBe(null);
        expect(reddit.blocker).toBe(null);
      } finally {
        await app.close();
      }
    });

    it("asks which one, once both have a key", async () => {
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey, SCRAPECREATORS_API_KEY: goodKey },
      });

      try {
        const body = (await app.inject({ method: "GET", url: "/api/connections" })).json();
        const reddit = platformIn(body);

        expect(reddit.needsChoice).toBe(true);
        expect(reddit.effective).toBe(null);
        expect(reddit.blocker).toContain("Choose one");
        expect(reddit.providers).toEqual([
          { id: "brightdata", displayName: "Bright Data", connected: true },
          { id: "scrapecreators", displayName: "ScrapeCreators", connected: true },
        ]);
      } finally {
        await app.close();
      }
    });

    it("records the choice, and reads it back after the write", async () => {
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey, SCRAPECREATORS_API_KEY: goodKey },
      });

      try {
        const written = await app.inject({
          method: "PUT",
          url: "/api/platforms/reddit/provider",
          payload: { provider: "scrapecreators" },
        });

        expect(written.statusCode).toBe(200);
        expect(platformIn(written.json()).chosen).toBe("scrapecreators");

        const reread = platformIn(
          (await app.inject({ method: "GET", url: "/api/connections" })).json(),
        );

        expect(reread.chosen).toBe("scrapecreators");
        expect(reread.effective).toBe("scrapecreators");
        expect(reread.needsChoice).toBe(false);
      } finally {
        await app.close();
      }
    });

    it("forgets a choice, and asks again", async () => {
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey, SCRAPECREATORS_API_KEY: goodKey },
      });

      try {
        await app.inject({
          method: "PUT",
          url: "/api/platforms/reddit/provider",
          payload: { provider: "scrapecreators" },
        });

        const cleared = await app.inject({
          method: "DELETE",
          url: "/api/platforms/reddit/provider",
        });

        expect(cleared.statusCode).toBe(200);
        expect(platformIn(cleared.json()).chosen).toBe(null);
        expect(platformIn(cleared.json()).needsChoice).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("refuses a provider that does not fetch the platform, and names the ones that do", async () => {
      // The database cannot check this: the pairs live in the registry, not in
      // a constraint. So it is checked here, and refused rather than written
      // to be discovered at the next poll.
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey },
      });

      try {
        const refused = await app.inject({
          method: "PUT",
          url: "/api/platforms/reddit/provider",
          payload: { provider: "a-provider-that-does-not-fetch-reddit" },
        });

        expect(refused.statusCode).toBe(400);
        expect(refused.json().message).toContain("brightdata, scrapecreators");
        expect(
          platformIn((await app.inject({ method: "GET", url: "/api/connections" })).json()).chosen,
        ).toBe(null);
      } finally {
        await app.close();
      }
    });

    it("says a platform is unavailable, with the reason, when nothing can fetch it", async () => {
      const app = await server({ sources: bothRedditProviders(), environment: {} });

      try {
        const reddit = platformIn(
          (await app.inject({ method: "GET", url: "/api/connections" })).json(),
        );

        expect(reddit.effective).toBe(null);
        expect(reddit.needsChoice).toBe(false);
        expect(reddit.blocker).toContain("No provider is connected for Reddit");
        // One account or the other, never both. A sentence joining them with
        // "and" would send a person to open a second account they do not need.
        expect(reddit.blocker).toContain("Bright Data or ScrapeCreators");
      } finally {
        await app.close();
      }
    });

    it("says a chosen provider that lost its key is the reason, not the missing one", async () => {
      // Falling back to the connected provider would collect on an account the
      // person did not pick, at a price they never saw. The screen names the
      // choice and both repairs instead.
      const app = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey, SCRAPECREATORS_API_KEY: goodKey },
      });

      try {
        await app.inject({
          method: "PUT",
          url: "/api/platforms/reddit/provider",
          payload: { provider: "scrapecreators" },
        });
      } finally {
        await app.close();
      }

      const afterRotation = await server({
        sources: bothRedditProviders(),
        environment: { BRIGHTDATA_API_KEY: goodKey },
      });

      try {
        const reddit = platformIn(
          (await afterRotation.inject({ method: "GET", url: "/api/connections" })).json(),
        );

        expect(reddit.effective).toBe(null);
        expect(reddit.blocker).toContain("set to fetch through ScrapeCreators");

        // And the monitor form agrees: a monitor on Reddit cannot start.
        const options = (
          await afterRotation.inject({ method: "GET", url: "/api/monitor-options" })
        ).json();

        expect(options.sources[0].ready).toBe(false);
        expect(options.sources[0].missingCredentials[0].providerId).toBe("scrapecreators");
      } finally {
        await afterRotation.close();
      }
    });

    it("answers 404 for a platform this build does not have", async () => {
      const app = await server({ sources: bothRedditProviders(), environment: {} });

      try {
        const answer = await app.inject({
          method: "PUT",
          url: "/api/platforms/bluesky/provider",
          payload: { provider: "brightdata" },
        });

        expect(answer.statusCode).toBe(404);
        expect(answer.json().message).toContain("reddit");
      } finally {
        await app.close();
      }
    });
  });

  /**
   * What one account can do to another's keys, through the screen. US-067.
   *
   * `secrets/store.test.ts` asserts the same rule against the table. This is
   * the other half, and it is the half a person can actually reach: until
   * US-067 every signed-in account shared one row per provider, so the second
   * person to paste a key silently replaced the first, and anybody could
   * delete one and stop every monitor on the instance.
   */
  describe("one account's keys and another's", () => {
    const other = "account-2";

    async function storeFor(userId: string, value: string) {
      await putSourceCredential(db, key, {
        userId,
        provider: "brightdata",
        field: "apiKey",
        value,
      });
    }

    it("shows an account only its own keys", async () => {
      await storeFor(owner, goodKey);
      const app = await serverAs(other);

      try {
        const view = (await app.inject({ method: "GET", url: "/api/connections" })).json();
        const provider = view.providers.find((one: { id: string }) => one.id === "brightdata");

        expect(provider.ready).toBe(false);
        expect(provider.credentials[0].stored).toBeFalsy();
        // The mask is a fact about somebody else's key and must not be here.
        expect(JSON.stringify(view)).not.toContain("••••");
      } finally {
        await app.close();
      }
    });

    it("stores a second account's key beside the first, not over it", async () => {
      await storeFor(owner, goodKey);
      const app = await serverAs(other);

      try {
        const saved = await app.inject({
          method: "PUT",
          url: "/api/connections/brightdata",
          payload: { credentials: { apiKey: goodKey } },
        });

        expect(saved.statusCode).toBe(200);

        // Two rows. One overwritten is the fault this ticket exists for.
        expect(await db.select().from(sourceCredentials)).toHaveLength(2);
        expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe(goodKey);
        expect(await readSourceCredential(db, key, other, "brightdata", "apiKey")).toBe(goodKey);
      } finally {
        await app.close();
      }
    });

    it("refuses to delete a key it does not own, and deletes nothing", async () => {
      await storeFor(owner, goodKey);
      const app = await serverAs(other);

      try {
        const removed = await app.inject({
          method: "DELETE",
          url: "/api/connections/brightdata/apiKey",
        });

        // The same 404 an unstored field gets: from `other`'s side there is
        // genuinely nothing stored, and saying otherwise would confirm that
        // somebody else has connected this provider.
        expect(removed.statusCode).toBe(404);
        expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe(goodKey);
      } finally {
        await app.close();
      }
    });

    /**
     * The consequence a person meets, rather than a row in a table.
     *
     * An account with no key of its own, on an instance with no environment
     * key, cannot start a monitor — and is told which key to paste rather than
     * being left with a monitor that never polls.
     */
    it("tells an account with no key of its own what is missing", async () => {
      await storeFor(owner, goodKey);
      const app = await serverAs(other);

      try {
        const options = (await app.inject({ method: "GET", url: "/api/monitor-options" })).json();
        const reddit = options.sources.find((one: { id: string }) => one.id === "reddit");

        expect(reddit.ready).toBe(false);
        expect(reddit.missingCredentials[0].environmentVariable).toBe("BRIGHTDATA_API_KEY");
      } finally {
        await app.close();
      }
    });
  });
});
