/**
 * The choices the lent-keys plan holds, and the rows it stops reading. US-132.
 *
 * Correctness-critical, and the enumeration is the point, as it is for the
 * paywall: a sample of routes passes for ever while the one added next month
 * lets an account on our keys choose the dearest model the provider sells. So
 * this walks what the build actually registered and checks every write under
 * the gated prefixes against one rule, for an account on the plan and for one
 * that is not.
 *
 * No test here reaches a provider, Stripe or a model.
 */
import { randomUUID } from "node:crypto";
import {
  accountKeys,
  aiSettings,
  type BillingSettings,
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  monitors,
  saveAiTaskSettings,
  subscriptions,
  users,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  isGatedForLentKeys,
  lentKeysGatedPrefixes,
  lentKeysMessage,
  registerLentKeysGate,
} from "./lent-keys.js";
import { type ApiServer, aiEnvironmentFor, buildServer } from "./server.js";
import { asUser } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

const settings: BillingSettings = {
  mode: "stripe",
  apiKey: "sk_test_not_a_real_key",
  priceId: "price_own",
  keysIncludedPriceId: "price_included",
  webhookSecret: "whsec_test",
  appUrl: "https://app.example.test",
};

describe("what a write under the gate is", () => {
  it("is a write under one of the three prefixes, and never a read", () => {
    expect(isGatedForLentKeys("PUT", "/api/connections/scrapecreators")).toBe(true);
    expect(isGatedForLentKeys("POST", "/api/connections/scrapecreators/test")).toBe(true);
    expect(isGatedForLentKeys("DELETE", "/api/platforms/reddit/provider")).toBe(true);
    expect(isGatedForLentKeys("PUT", "/api/models/classify")).toBe(true);
    expect(isGatedForLentKeys("POST", "/api/models/keys")).toBe(true);

    expect(isGatedForLentKeys("GET", "/api/connections")).toBe(false);
    expect(isGatedForLentKeys("GET", "/api/models")).toBe(false);
    expect(isGatedForLentKeys("POST", "/api/monitors")).toBe(false);
    expect(lentKeysGatedPrefixes).toHaveLength(3);
  });
});

describe("the gate", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_lent_keys");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close();
    await database.drop();
  });

  afterEach(async () => {
    await db.delete(aiSettings);
    await db.delete(monitors);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function account(plan: "own_keys" | "keys_included"): Promise<string> {
    const id = `${plan}-${randomUUID()}`;
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    await db.insert(subscriptions).values({ userId: id, status: "active", plan });
    return id;
  }

  async function server(
    userId: string,
    { signup = "open", charging = true }: { signup?: "open" | "closed"; charging?: boolean } = {},
  ): Promise<ApiServer> {
    const env = loadEnv({
      DATABASE_URL: database.url,
      AUTH_SECRET: "x".repeat(32),
      AUTH_SIGNUP: signup,
    });

    return buildServer({
      env,
      logger,
      db,
      auth: null,
      session: asUser(userId),
      queryGenerator: null,
      billingSettings: charging ? settings : null,
      environment: { SCRAPECREATORS_API_KEY: "the-machine-key" },
    });
  }

  /** Every gated write this build registers, with its parameters filled. */
  function gatedRoutes(app: ApiServer) {
    return app.registeredRoutes
      .filter((route) => isGatedForLentKeys(route.method, route.url))
      .map((route) => ({
        method: route.method as "POST",
        url: route.url.replace(/:\w+/g, randomUUID()),
      }));
  }

  it("refuses every gated write this build registers for an account on the plan, with 403", async () => {
    const app = await server(await account("keys_included"));

    try {
      const gated = gatedRoutes(app);
      // Both connections writes, both platform provider writes, both key
      // tests, and every /api/models write: eleven today, and the walk is
      // what catches the twelfth.
      expect(gated.length).toBeGreaterThanOrEqual(11);

      for (const route of gated) {
        const response = await app.inject({ ...route, payload: {} });

        expect(
          { url: route.url, method: route.method, status: response.statusCode },
          `${route.method} ${route.url} should be the deployment's choice on this plan`,
        ).toEqual({ url: route.url, method: route.method, status: 403 });
        expect(response.json()).toMatchObject({ message: lentKeysMessage });
      }
    } finally {
      await app.close();
    }
  });

  it("lets an account on the plan read both screens", async () => {
    const app = await server(await account("keys_included"));

    try {
      expect((await app.inject({ method: "GET", url: "/api/connections" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/models" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("refuses nothing for an account spending its own keys", async () => {
    const app = await server(await account("own_keys"));

    try {
      for (const route of gatedRoutes(app)) {
        const response = await app.inject({ ...route, payload: {} });
        // Whatever each route answers an empty body with, it is the route
        // answering and not this gate.
        expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it("registers nothing where signup is closed, whatever the plan says", async () => {
    const app = await server(await account("keys_included"), { signup: "closed" });

    try {
      for (const route of gatedRoutes(app)) {
        const response = await app.inject({ ...route, payload: {} });
        expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it("registers nothing where this deployment does not charge", async () => {
    const app = await server(await account("keys_included"), { charging: false });

    try {
      for (const route of gatedRoutes(app)) {
        const response = await app.inject({ ...route, payload: {} });
        expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it("is a hook and not a list: a fake app records it once", () => {
    const hooks: string[] = [];
    const app = {
      addHook: (name: string) => hooks.push(name),
    } as unknown as ApiServer;
    const keys = { spendsInstanceMoney: async () => true } as never;

    registerLentKeysGate(app, { keys, signup: "closed", mode: "stripe" });
    registerLentKeysGate(app, { keys, signup: "open", mode: "off" });
    expect(hooks).toEqual([]);

    registerLentKeysGate(app, { keys, signup: "open", mode: "stripe" });
    expect(hooks).toEqual(["onRequest"]);
  });

  /**
   * The precedence flip, at the API's seam. A row an account stored before
   * the plan names a model; on the plan the environment answers instead, and
   * the row is still there for the day it leaves.
   */
  it("reads the deployment's model and not the account's rows on the plan", async () => {
    const included = await account("keys_included");
    const own = await account("own_keys");
    for (const id of [included, own]) {
      await saveAiTaskSettings(db, id, "classify", { model: "the-dearest-model" });
    }

    const env = loadEnv({
      DATABASE_URL: database.url,
      AUTH_SECRET: "x".repeat(32),
      AUTH_SIGNUP: "open",
      AI_MODEL: "the-deployments-model",
    });
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: {} });
    const aiFor = aiEnvironmentFor(db, env, keys);

    expect((await aiFor(included)).AI_MODEL).toBe("the-deployments-model");
    expect((await aiFor(own)).AI_MODEL).toBe("the-dearest-model");

    // Nothing deleted: the row is read again once the account leaves the plan.
    await db.update(subscriptions).set({ plan: "own_keys" });
    expect((await aiFor(included)).AI_MODEL).toBe("the-dearest-model");
  });
});
