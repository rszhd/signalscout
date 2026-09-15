/**
 * What one account may spend, as the composition roots ask it. US-128,
 * rekeyed by US-141.
 *
 * Correctness-critical: plan, and the failure is an invoice. US-128 read the
 * answer off `subscriptions.plan`, which the Stripe webhook wrote from the
 * price. There is one price now and the answer is the account's own state, so
 * what is asserted here is that every reader follows that state and follows it
 * on the next call rather than the next restart.
 *
 * Against a real Postgres, because `account_key_source` carries a check
 * constraint TypeScript does not know about.
 */

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { accountKeySource, sourceProviders, subscriptions, users } from "../db/schema.js";
import { setProviderChoice } from "../sources/choices.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { onInstanceKeysAmong, setKeySource } from "./key-source.js";
import { accountKeys, planKeyedCache } from "./plan.js";

describe("whose keys an account runs on, read from the database", () => {
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
    await db.delete(accountKeySource);
    await db.delete(sourceProviders);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  /**
   * An account, and whose keys it runs on. No `source` writes no row, which is
   * what a new account is: this instance's keys, chosen by nobody.
   */
  async function account(id: string, source?: "instance" | "own"): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    if (source) await setKeySource(db, id, source);
    return id;
  }

  const machine = { BRIGHTDATA_API_KEY: "the-machine-key" };
  const model = {
    AI_PROVIDER: "anthropic" as const,
    AI_MODEL: "claude-haiku-4-5",
    AI_API_KEY: "the-machine-model-key",
    AI_TIMEOUT_MS: 30_000,
  };

  it("reads each account's own state, and no row as this instance's keys", async () => {
    await account("ours", "instance");
    await account("theirs", "own");
    await account("no-row");

    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.source("ours")).toBe("instance");
    expect(await keys.source("theirs")).toBe("own");
    // The default, and the direction US-141 chose deliberately: an account
    // that has chosen nothing gets a working product on our keys.
    expect(await keys.source("no-row")).toBe("instance");
  });

  /**
   * The array in `schema.ts` is also a check constraint, and this repository
   * has shipped the other way three times: a value TypeScript accepts, a full
   * suite passing, and the write failing after the money was spent.
   */
  it("refuses a state the application does not understand", async () => {
    await account("odd");

    // The raw pool, because Drizzle rewrites the message and the constraint's
    // own name is the thing worth asserting.
    await expect(
      query("insert into account_key_source (user_id, source) values ('odd', 'borrowed')"),
    ).rejects.toThrow(/account_key_source_known/);
  });

  /** It is the account's to change, and the next read is the new answer. */
  it("moves an account between the two, and keeps nothing else", async () => {
    await account("mover", "instance");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.source("mover")).toBe("instance");

    await setKeySource(db, "mover", "own");
    expect(await keys.source("mover")).toBe("own");

    await setKeySource(db, "mover", "instance");
    expect(await keys.source("mover")).toBe("instance");
  });

  /**
   * The claim the whole ticket rests on: one instance, one `.env`, two accounts,
   * two answers. Nothing below this asks why — it is handed an environment that
   * is already right, which is what has kept the rule in one file.
   */
  it("hands the machine's keys to one account on an open instance and not the next", async () => {
    await account("ours", "instance");
    await account("theirs", "own");

    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.provider("ours")).toEqual(machine);
    expect(await keys.provider("theirs")).toEqual({});

    expect((await keys.model("ours", model)).AI_API_KEY).toBe("the-machine-model-key");
    expect((await keys.model("theirs", model)).AI_API_KEY).toBeUndefined();
  });

  /** The deployment's model settings survive in both states. Only the key moves. */
  it("keeps the deployment's provider and model for an account with neither", async () => {
    await account("theirs", "own");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });
    const mine = await keys.model("theirs", model);

    expect(mine.AI_PROVIDER).toBe("anthropic");
    expect(mine.AI_MODEL).toBe("claude-haiku-4-5");
  });

  /**
   * The self-hosted instance. Every account on it spends the machine's keys,
   * whatever any row says, because `.env` is how one person configures their own
   * machine and that is what US-067 left the environment half for.
   */
  it("hands the machine's keys to every account where signup is closed", async () => {
    await account("theirs", "own");
    const keys = accountKeys(db, { signup: "closed", mode: "stripe", environment: machine });

    expect(await keys.provider("theirs")).toEqual(machine);
    expect((await keys.model("theirs", model)).AI_API_KEY).toBe("the-machine-model-key");
  });

  /**
   * The worker's model cache, and the claim is the money one: an account that
   * moves onto its own keys stops spending our key on the next job rather
   * than at the next restart. Everything else about that cache is unchanged —
   * a *key* changed on the screen still reaches the worker on its next
   * restart.
   */
  it("builds once per account while the state holds, and again when it changes", async () => {
    await account("mover", "instance");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    const built: string[] = [];
    const cached = planKeyedCache(keys, async (userId, source) => {
      built.push(`${userId}:${source}`);
      return { source };
    });

    expect((await cached("mover")).source).toBe("instance");
    expect((await cached("mover")).source).toBe("instance");
    expect(built).toEqual(["mover:instance"]);

    await setKeySource(db, "mover", "own");

    expect((await cached("mover")).source).toBe("own");
    expect(built).toEqual(["mover:instance", "mover:own"]);
  });

  it("keeps one account's clients out of another's", async () => {
    await account("one", "instance");
    await account("two", "instance");
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
    await account("ours", "instance");
    await account("theirs", "own");

    const open = accountKeys(db, {
      signup: "open",
      mode: "stripe",
      environment: machine,
      capMicros: 15_000_000,
    });

    expect(await open.cap("ours")).toBe(15_000_000);
    expect(await open.cap("theirs")).toBeNull();

    const closed = accountKeys(db, {
      signup: "closed",
      mode: "stripe",
      environment: machine,
      capMicros: 15_000_000,
    });

    expect(await closed.cap("ours")).toBeNull();
  });

  it("lends no cap where the deployment named none", async () => {
    await account("ours", "instance");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.cap("ours")).toBeNull();
  });

  /**
   * US-130's original wording, restored by US-141. A recorded choice wins and
   * the deployment's answer is the default under it — US-132 made it an
   * override for a moment, and the account chooses now, so a row it wrote is
   * a decision it made.
   */
  it("lays the deployment's providers under the account's own choices", async () => {
    await account("ours", "instance");
    await account("theirs", "own");
    await setProviderChoice(db, "ours", "reddit", "brightdata");

    const open = accountKeys(db, {
      signup: "open",
      mode: "stripe",
      environment: machine,
      lentProviders: { reddit: "scrapecreators", x: "socialdata" },
    });

    // Reddit is the account's own choice; X is the deployment's, because the
    // account made none.
    expect(await open.choices("ours")).toEqual({ reddit: "brightdata", x: "socialdata" });
    // An account on its own keys reads only its rows: the deployment's answer
    // names providers it holds no key for.
    expect(await open.choices("theirs")).toEqual({});
  });

  it("reads every account's own rows where signup is closed", async () => {
    await account("ours", "instance");
    await setProviderChoice(db, "ours", "reddit", "brightdata");

    const closed = accountKeys(db, {
      signup: "closed",
      mode: "stripe",
      environment: machine,
      lentProviders: { reddit: "scrapecreators" },
    });

    expect(await closed.choices("ours")).toEqual({ reddit: "brightdata" });
  });

  it("says whose money an account spends, per account", async () => {
    await account("ours", "instance");
    await account("theirs", "own");

    const open = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });
    expect(await open.spendsInstanceMoney("ours")).toBe(true);
    expect(await open.spendsInstanceMoney("theirs")).toBe(false);

    const closed = accountKeys(db, { signup: "closed", mode: "stripe", environment: machine });
    expect(await closed.spendsInstanceMoney("ours")).toBe(false);

    /**
     * US-081's rule, and it survives US-141. An open instance that does not
     * charge has no plan, no trial and no invoice, so it lends nothing — and
     * an account that has chosen nothing is on its own keys rather than on
     * the owner's. The state defaults the other way, so this is the one thing
     * the account cannot choose.
     */
    const off = accountKeys(db, { signup: "open", mode: "off", environment: machine });
    expect(await off.spendsInstanceMoney("ours")).toBe(false);
    expect(await off.source("ours")).toBe("own");
    expect(await off.provider("ours")).toEqual({});
  });

  it("answers with the account's own rows where the deployment named nothing", async () => {
    await account("ours", "instance");
    await setProviderChoice(db, "ours", "reddit", "brightdata");
    const keys = accountKeys(db, { signup: "open", mode: "stripe", environment: machine });

    expect(await keys.choices("ours")).toEqual({ reddit: "brightdata" });
  });

  /**
   * The scheduler asks about every owner at once, so it must not read a row
   * per monitor. No row means ours, so the answer is every id asked about
   * minus the ones that said otherwise.
   */
  it("names the accounts on this instance's keys, in one read, for the scheduler", async () => {
    await account("ours", "instance");
    await account("theirs", "own");
    await account("no-row");

    expect(await onInstanceKeysAmong(db, ["ours", "theirs", "no-row"])).toEqual(["ours", "no-row"]);
    expect(await onInstanceKeysAmong(db, [])).toEqual([]);
  });

  /**
   * Billing off is the default deployment, and nothing here may make it behave
   * differently from the way it behaved before this file existed.
   */
  it("hands a self-hosted instance its own keys, whatever any row says", async () => {
    await account("ours", "instance");
    const keys = accountKeys(db, { signup: "closed", mode: "off", environment: machine });

    expect(await keys.source("ours")).toBe("instance");
    expect(await keys.provider("ours")).toEqual(machine);
  });
});
