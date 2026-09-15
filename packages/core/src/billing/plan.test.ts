/**
 * Which plan an account is on, and therefore whose keys it spends. US-128.
 *
 * Correctness-critical, and the failure is an invoice. The rule fails towards
 * `own_keys` everywhere, so most of what is asserted here is that an unknown of
 * any kind — no row, no column value, a price nobody configured — reads as the
 * plan that spends the account's own money.
 *
 * The two halves are apart on purpose. `planOf` and `planForPrice` are pure and
 * need no database. `readPlan` and `accountKeys` read one, and they read a real
 * Postgres because the column has a check constraint that TypeScript does not
 * know about.
 */

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { sourceProviders, subscriptions, users } from "../db/schema.js";
import { readProviderChoices, setProviderChoice } from "../sources/choices.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import type { SubscriptionRecord } from "./entitlement.js";
import {
  accountKeys,
  keysIncludedAmong,
  planForPrice,
  planKeyedCache,
  planOf,
  readPlan,
} from "./plan.js";

function record(overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    userId: "user-1",
    status: "active",
    plan: "own_keys",
    trialEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("the plan a stored row is on", () => {
  it("reads the column when this deployment charges", () => {
    expect(planOf("stripe", record({ plan: "keys_included" }))).toBe("keys_included");
    expect(planOf("stripe", record({ plan: "own_keys" }))).toBe("own_keys");
  });

  /**
   * No row is entitled — `entitlementFor` says so, for the owner's own account
   * and every self-hosted instance. It is not the plan, and the two rules
   * failing in opposite directions is the whole design: being allowed to poll
   * and being allowed to poll on our keys are different questions.
   */
  it("reads no row as the plan that spends nobody else's money", () => {
    expect(planOf("stripe", null)).toBe("own_keys");
  });

  /**
   * A deployment that does not charge is self-hosted, and `machineKeysUsable`
   * has already said yes to every account on it. Answering here keeps a caller
   * from having to know that.
   */
  it("answers own keys where this deployment does not charge", () => {
    expect(planOf("off", record({ plan: "keys_included" }))).toBe("own_keys");
  });
});

describe("the plan a Stripe price sells", () => {
  it("names the keys-included plan only for the price configured for it", () => {
    expect(planForPrice("price_included", "price_included")).toBe("keys_included");
    expect(planForPrice("price_ordinary", "price_included")).toBe("own_keys");
  });

  /**
   * A price created in the dashboard that nobody told this instance about must
   * not be guessed into the plan that costs us money. Neither must a
   * subscription carrying no price at all.
   */
  it("reads an unknown price and no price as own keys", () => {
    expect(planForPrice("price_nobody_configured", "price_included")).toBe("own_keys");
    expect(planForPrice(null, "price_included")).toBe("own_keys");
  });

  /**
   * A deployment that sells one plan cannot be put onto the second by a price,
   * however that price is named. This is the state every instance running today
   * is in.
   */
  it("sells one plan where no keys-included price is configured", () => {
    expect(planForPrice("price_anything", undefined)).toBe("own_keys");
  });
});

describe("the plan, and the keys, read from the database", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  /** The raw pool, for the constraint assertion. Drizzle rewrites the message. */
  let query: Pool["query"];

  beforeAll(async () => {
    database = await createTestDatabase("billing_plan");
    const opened = createDatabase(database.url);
    db = opened.db;
    close = opened.close;
    query = opened.pool.query.bind(opened.pool);
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(sourceProviders);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function account(id: string, plan?: "own_keys" | "keys_included"): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });

    if (plan) {
      await db.insert(subscriptions).values({ userId: id, status: "active", plan });
    }

    return id;
  }

  const machine = { BRIGHTDATA_API_KEY: "the-machine-key" };
  const model = {
    AI_PROVIDER: "anthropic" as const,
    AI_MODEL: "claude-haiku-4-5",
    AI_API_KEY: "the-machine-model-key",
    AI_TIMEOUT_MS: 30_000,
  };

  it("reads each account's own plan", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");
    await account("no-row");

    expect(await readPlan(db, "included", "stripe")).toBe("keys_included");
    expect(await readPlan(db, "own", "stripe")).toBe("own_keys");
    expect(await readPlan(db, "no-row", "stripe")).toBe("own_keys");
  });

  /**
   * A row written before the column existed. The default is what makes every
   * account that predates this ticket spend its own money rather than ours.
   */
  it("defaults a row that names no plan to own keys", async () => {
    await account("older");
    await db.insert(subscriptions).values({ userId: "older", status: "active" });

    expect(await readPlan(db, "older", "stripe")).toBe("own_keys");
  });

  /**
   * The array in `schema.ts` is also a check constraint, and this repository
   * has shipped the other way three times: a value TypeScript accepts, a full
   * suite passing, and the write failing after the money was spent.
   */
  it("refuses a plan the application does not understand", async () => {
    await account("odd");

    await expect(
      query("insert into subscriptions (user_id, status, plan) values ('odd', 'active', 'free')"),
    ).rejects.toThrow(/subscriptions_plan_known/);
  });

  /**
   * The claim the whole ticket rests on: one instance, one `.env`, two accounts,
   * two answers. Nothing below this asks why — it is handed an environment that
   * is already right, which is what has kept the rule in one file.
   */
  it("hands the machine's keys to one account on an open instance and not the next", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");

    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.provider("included")).toEqual(machine);
    expect(await keys.provider("own")).toEqual({});

    expect((await keys.model("included", model)).AI_API_KEY).toBe("the-machine-model-key");
    expect((await keys.model("own", model)).AI_API_KEY).toBeUndefined();
  });

  /** The model settings of the deployment survive on both plans. Only the key moves. */
  it("keeps the deployment's provider and model for an account with neither", async () => {
    await account("own", "own_keys");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });
    const mine = await keys.model("own", model);

    expect(mine.AI_PROVIDER).toBe("anthropic");
    expect(mine.AI_MODEL).toBe("claude-haiku-4-5");
  });

  /**
   * The self-hosted instance. Every account on it spends the machine's keys,
   * whatever any row says, because `.env` is how one person configures their own
   * machine and that is what US-067 left the environment half for.
   */
  it("hands the machine's keys to every account where signup is closed", async () => {
    await account("own", "own_keys");
    const keys = accountKeys(db, { signup: "closed", mode: "stripe", environment: machine });

    expect(await keys.provider("own")).toEqual(machine);
    expect((await keys.model("own", model)).AI_API_KEY).toBe("the-machine-model-key");
  });

  /**
   * The worker's model cache, and the claim is the money one: an account that
   * leaves the plan stops spending our key on the next job rather than at the
   * next restart. Everything else about that cache is unchanged — a *key*
   * changed on the screen still reaches the worker on its next restart.
   */
  it("builds once per account while the plan holds, and again when it changes", async () => {
    await account("mover", "keys_included");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    const built: string[] = [];
    const cached = planKeyedCache(keys, async (userId, plan) => {
      built.push(`${userId}:${plan}`);
      return { plan };
    });

    expect((await cached("mover")).plan).toBe("keys_included");
    expect((await cached("mover")).plan).toBe("keys_included");
    expect(built).toEqual(["mover:keys_included"]);

    await db.update(subscriptions).set({ plan: "own_keys" });

    expect((await cached("mover")).plan).toBe("own_keys");
    expect(built).toEqual(["mover:keys_included", "mover:own_keys"]);
  });

  it("keeps one account's clients out of another's", async () => {
    await account("one", "keys_included");
    await account("two", "keys_included");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    const built: string[] = [];
    const cached = planKeyedCache(keys, async (userId) => {
      built.push(userId);
      return { userId };
    });

    expect((await cached("one")).userId).toBe("one");
    expect((await cached("two")).userId).toBe("two");
    expect(built).toEqual(["one", "two"]);
  });

  /**
   * US-129. The cap turns on the plan, and on nothing else the account can see.
   *
   * The self-hosted case is the one worth the assertion. `machineKeysUsableFor`
   * says yes there, because `.env` is how one person configures their own
   * machine — but the money is theirs, so a cap the deployment lends would be a
   * limit nobody asked for. The two questions are close and they are not the
   * same one.
   */
  it("lends a cap to the plan that spends our money, and to nobody else", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");

    const open = accountKeys(db, {
      signup: "open",
      mode: "stripe",
      environment: machine,
      capMicros: 15_000_000,
    });

    expect(await open.cap("included")).toBe(15_000_000);
    expect(await open.cap("own")).toBeNull();

    const closed = accountKeys(db, {
      signup: "closed",
      mode: "stripe",
      environment: machine,
      capMicros: 15_000_000,
    });

    expect(await closed.cap("included")).toBeNull();
  });

  it("lends no cap where the deployment named none", async () => {
    await account("included", "keys_included");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.cap("included")).toBeNull();
  });

  /**
   * US-130. The deployment names the provider for an account on the plan, and
   * that answer is the whole answer there: a row the account recorded before
   * moving onto the plan is left in place and not read. An account spending
   * its own keys reads its rows, US-026's refusal untouched.
   */
  it("answers a lent-keys account with the deployment's provider, and nobody else", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");
    await setProviderChoice(db, "included", "reddit", "brightdata");
    await setProviderChoice(db, "own", "reddit", "brightdata");

    const lent = { reddit: "scrapecreators" } as const;
    const open = accountKeys(db, {
      signup: "open",
      mode: "stripe",
      environment: machine,
      lentProviders: lent,
    });

    expect(await open.choices("included")).toEqual(lent);
    expect(await open.choices("own")).toEqual({ reddit: "brightdata" });
    // Nothing was deleted: leaving the plan reads the row again.
    expect(await readProviderChoices(db, "included")).toEqual({ reddit: "brightdata" });
  });

  it("reads every account's own rows where signup is closed, whatever the plan", async () => {
    await account("included", "keys_included");
    await setProviderChoice(db, "included", "reddit", "brightdata");

    const closed = accountKeys(db, {
      signup: "closed",
      mode: "stripe",
      environment: machine,
      lentProviders: { reddit: "scrapecreators" },
    });

    expect(await closed.choices("included")).toEqual({ reddit: "brightdata" });
  });

  it("says whose money an account spends, per account", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");

    const open = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });
    expect(await open.spendsInstanceMoney("included")).toBe(true);
    expect(await open.spendsInstanceMoney("own")).toBe(false);

    const closed = accountKeys(db, { signup: "closed", mode: "stripe", environment: machine });
    expect(await closed.spendsInstanceMoney("included")).toBe(false);

    const off = accountKeys(db, { signup: "open", mode: "off", environment: machine });
    expect(await off.spendsInstanceMoney("included")).toBe(false);
  });

  it("answers a lent-keys account with nothing where the deployment named nothing", async () => {
    await account("included", "keys_included");
    await setProviderChoice(db, "included", "reddit", "brightdata");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.choices("included")).toEqual({});
  });

  it("names the accounts on the plan, in one read, for the scheduler", async () => {
    await account("included", "keys_included");
    await account("own", "own_keys");
    await account("no-row");

    expect(await keysIncludedAmong(db, ["included", "own", "no-row"], "stripe")).toEqual([
      "included",
    ]);
    // A deployment that does not charge has no plans to find.
    expect(await keysIncludedAmong(db, ["included"], "off")).toEqual([]);
  });

  /**
   * Billing off is the default deployment, and nothing here may make it behave
   * differently from the way it behaved before this file existed.
   */
  it("ignores the column entirely where this deployment does not charge", async () => {
    await account("included", "keys_included");
    const keys = accountKeys(db, { signup: "closed", mode: "off", environment: machine });

    expect(await keys.plan("included")).toBe("own_keys");
    expect(await keys.provider("included")).toEqual(machine);
  });
});
