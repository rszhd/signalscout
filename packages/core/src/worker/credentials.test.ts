import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { sourceCredentials, users } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { generateEncryptionKey, readEncryptionKey } from "../secrets/cipher.js";
import { putSourceCredential } from "../secrets/store.js";
import type { SocialSource } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  credentialsFromEnvironment,
  credentialsFromStore,
  deprecatedEnvironmentVariableFor,
  environmentVariableFor,
} from "./credentials.js";

/**
 * The account these cases ask on behalf of. US-067.
 *
 * The environment lookup ignores it, and that is the point of every case in
 * this file: `.env` belongs to the machine, so the same variable answers for
 * whoever asks. The store's own scoping is asserted in `secrets/store.test.ts`.
 */
const owner = "account-1";

function connectorWith(platformId: string, providerId: string, fields: string[]): SocialSource {
  return {
    platform: { id: platformId, displayName: platformId },
    provider: {
      id: providerId,
      displayName: providerId,
      credentialFields: fields.map((name) => ({ name, label: name, secret: true })),
    },
    billableUnit: "record",
    pricePerUnitMicros: 0,
    maxUnitsPerQueryPoll: 50,
    validateCredentials: async () => ({ valid: true }),
    search: async () => ({ posts: [], unitsConsumed: 0, next: { status: "done" } }),
  };
}

describe("the environment variable a credential comes from", () => {
  it("is named after the provider and the field, never after the platform", () => {
    // A key belongs to the account it was issued for. One Bright Data key
    // serves Reddit, X and LinkedIn, so a name built from the platform would
    // be set three times to the same value and rotated three times.
    expect(environmentVariableFor("brightdata", "apiKey")).toBe("BRIGHTDATA_API_KEY");
    expect(environmentVariableFor("scrapecreators", "apiSecret")).toBe("SCRAPECREATORS_API_SECRET");
    expect(environmentVariableFor("x-api", "token")).toBe("X_API_TOKEN");
  });

  it("still knows the name US-024 replaced", () => {
    expect(deprecatedEnvironmentVariableFor("reddit", "apiKey")).toBe("REDDIT_API_KEY");
  });
});

describe("reading credentials from the environment", () => {
  it("collects every field a connector's provider declares", () => {
    const lookup = credentialsFromEnvironment({
      BRIGHTDATA_API_KEY: "key",
      BRIGHTDATA_API_SECRET: "secret",
    });

    expect(lookup(connectorWith("x", "brightdata", ["apiKey", "apiSecret"]), owner)).toEqual({
      apiKey: "key",
      apiSecret: "secret",
    });
  });

  it("answers nothing at all when one field is missing", () => {
    // Half a key is a failed API call, and a failed API call retries four
    // times before it dead-letters. Four wrong answers to a question that can
    // be answered here for nothing.
    const lookup = credentialsFromEnvironment({ BRIGHTDATA_API_KEY: "key" });

    expect(
      lookup(connectorWith("x", "brightdata", ["apiKey", "apiSecret"]), owner),
    ).toBeUndefined();
  });

  it("treats an empty variable as unset", () => {
    const lookup = credentialsFromEnvironment({ BRIGHTDATA_API_KEY: "" });

    expect(lookup(connectorWith("reddit", "brightdata", ["apiKey"]), owner)).toBeUndefined();
  });

  it("falls back to the platform's old name, so an instance that upgraded keeps polling", () => {
    // The whole point of the fallback: nobody edits `.env` before the deploy,
    // and a monitor that stopped collecting is the one thing a person must not
    // learn from an empty inbox.
    const lookup = credentialsFromEnvironment({ REDDIT_API_KEY: "old-key" });

    expect(lookup(connectorWith("reddit", "brightdata", ["apiKey"]), owner)).toEqual({
      apiKey: "old-key",
    });
  });

  it("prefers the provider's own name when both are set", () => {
    const lookup = credentialsFromEnvironment({
      REDDIT_API_KEY: "old-key",
      BRIGHTDATA_API_KEY: "new-key",
    });

    expect(lookup(connectorWith("reddit", "brightdata", ["apiKey"]), owner)).toEqual({
      apiKey: "new-key",
    });
  });

  it("says which line to change when it reads the old name", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "warn",
      name: "credentials-test",
      destination: { write: (line: string) => lines.push(line) },
    });

    // A fresh variable name, because the warning is given once per process and
    // another case in this file may already have spent it.
    const lookup = credentialsFromEnvironment({ BLUESKY_API_KEY: "old-key" }, logger);
    lookup(connectorWith("bluesky", "someprovider", ["apiKey"]), owner);

    expect(lines.join("\n")).toContain("BLUESKY_API_KEY");
    expect(lines.join("\n")).toContain("SOMEPROVIDER_API_KEY");
  });
});

/**
 * The store and the environment together, which is what a poll actually calls.
 *
 * Correctness-critical, and the failure shape is money: this function decides
 * whose key a fetch is billed to. It had no case of its own until US-128 gave
 * it a second answer to get wrong.
 */
describe("reading credentials from the store, then the environment", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  const key = readEncryptionKey(generateEncryptionKey());
  const logger = createLogger({ level: "silent", name: "credentials-test" });
  const connector = connectorWith("reddit", "brightdata", ["apiKey"]);
  const machine = { BRIGHTDATA_API_KEY: "the-machine-key" };

  beforeAll(async () => {
    database = await createTestDatabase("worker_credentials");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(sourceCredentials);
    await db.delete(users);
  });

  async function account(id: string): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    return id;
  }

  it("prefers the account's stored key over the machine's", async () => {
    await account("stored");
    await putSourceCredential(db, key, {
      userId: "stored",
      provider: "brightdata",
      field: "apiKey",
      value: "the-account-key",
    });

    const lookup = credentialsFromStore(db, key, machine, logger);

    expect(await lookup(connector, "stored")).toEqual({ apiKey: "the-account-key" });
  });

  it("falls back to the machine's key when the account has stored none", async () => {
    await account("empty");
    const lookup = credentialsFromStore(db, key, machine, logger);

    expect(await lookup(connector, "empty")).toEqual({ apiKey: "the-machine-key" });
  });

  /**
   * US-128. The environment half is a function now, and this is why: one
   * process, one `.env`, and two accounts that must be billed differently. The
   * lookup below is what the worker builds — an account on the plan gets the
   * machine's key, the account beside it gets nothing and its poll refuses.
   */
  it("asks per account which environment to read", async () => {
    await account("included");
    await account("own");

    const lookup = credentialsFromStore(
      db,
      key,
      async (userId) => (userId === "included" ? machine : {}),
      logger,
    );

    expect(await lookup(connector, "included")).toEqual({ apiKey: "the-machine-key" });
    expect(await lookup(connector, "own")).toBeUndefined();
  });

  /**
   * The same question with no `ENCRYPTION_KEY`, which is the path a deployment
   * that stores nothing takes. It used to return a lookup built once, and a
   * lookup built once cannot answer per account.
   */
  it("asks per account with no encryption key either", async () => {
    await account("included");
    await account("own");

    const lookup = credentialsFromStore(
      db,
      undefined,
      async (userId) => (userId === "included" ? machine : {}),
      logger,
    );

    expect(await lookup(connector, "included")).toEqual({ apiKey: "the-machine-key" });
    expect(await lookup(connector, "own")).toBeUndefined();
  });
});
