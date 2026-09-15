/**
 * What one account has spent of the instance's money, and whether it may spend
 * more. US-129.
 *
 * Correctness-critical, and it is the budget guard's failure shape with our
 * money in it rather than the customer's. So the cases are the same shape as
 * `budget.test.ts`'s: the rule, both halves of the ledger, the month boundary,
 * and the two ways an account can be over without anybody looking at a screen.
 *
 * Real Postgres, because the sums are SQL and because `model_calls.user_id` is
 * a column US-129 added and a query that read the old shape would still
 * compile.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recordModelCall } from "../ai/record.js";
import { setKeySource } from "../billing/key-source.js";
import { createDatabase, type Database } from "../db/client.js";
import { accountKeySource, apiUsage, modelCalls, monitors, users } from "../db/schema.js";
import { deleteMonitor } from "../monitors/monitors.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  accountBudgetState,
  accountCapFrom,
  accountSpend,
  accountsOverCap,
  checkAccountBudget,
  defaultAccountCapMicros,
} from "./account.js";
import { recordSourceUsage } from "./budget.js";

const now = new Date("2026-09-12T10:00:00Z");
const lastMonth = new Date("2026-08-30T10:00:00Z");

const spend = (sourceMicros: number, modelMicros: number) => ({
  sourceMicros,
  modelMicros,
  totalMicros: sourceMicros + modelMicros,
  since: new Date("2026-09-01T00:00:00Z"),
});

describe("what a deployment lends one account", () => {
  /**
   * US-133 raised it from $15 to $25, and the expected value moved because
   * the behaviour was meant to. $15 sat *below* what the plan sells, so the
   * fuse would have blown inside a month somebody paid for. It now sits above
   * US-134's worst case of about $12.
   */
  it("is twenty-five dollars when nothing says otherwise, above what the plan sells", () => {
    expect(accountCapFrom({})).toBe(defaultAccountCapMicros);
    expect(accountCapFrom({ ACCOUNT_MONTHLY_CAP_MICROS: "" })).toBe(defaultAccountCapMicros);
    expect(defaultAccountCapMicros).toBe(25_000_000);
  });

  it("is whatever the deployment set, including nothing at all", () => {
    expect(accountCapFrom({ ACCOUNT_MONTHLY_CAP_MICROS: "5000000" })).toBe(5_000_000);
    // Zero is a deployment that lends nothing, which is a legal thing to ask
    // for and is not the same as leaving the variable unset.
    expect(accountCapFrom({ ACCOUNT_MONTHLY_CAP_MICROS: "0" })).toBe(0);
  });

  /**
   * A typo that read as zero would stop every monitor on the plan, and one that
   * read as the default would lend a number nobody chose. Both are quiet, so
   * neither is allowed.
   */
  it("refuses a value that is not a number of micro-dollars", () => {
    expect(() => accountCapFrom({ ACCOUNT_MONTHLY_CAP_MICROS: "$15" })).toThrow(
      /ACCOUNT_MONTHLY_CAP_MICROS/,
    );
    expect(() => accountCapFrom({ ACCOUNT_MONTHLY_CAP_MICROS: "-1" })).toThrow(
      /ACCOUNT_MONTHLY_CAP_MICROS/,
    );
  });
});

describe("the rule, over a reading already taken", () => {
  it("says nothing is exhausted where the money is the account's own", () => {
    const state = accountBudgetState(spend(90_000_000, 90_000_000), null);

    expect(state.exhausted).toBe(false);
    expect(state.capMicros).toBeNull();
    expect(state.remainingMicros).toBeNull();
    expect(state.reason).toBeNull();
  });

  it("subtracts both halves of the ledger from the cap", () => {
    const state = accountBudgetState(spend(4_000_000, 1_000_000), 15_000_000);

    expect(state.spend.totalMicros).toBe(5_000_000);
    expect(state.remainingMicros).toBe(10_000_000);
    expect(state.exhausted).toBe(false);
  });

  /** At the cap, not past it: the next poll is billed before anything checks again. */
  it("is exhausted standing exactly on the cap", () => {
    expect(accountBudgetState(spend(15_000_000, 0), 15_000_000).exhausted).toBe(true);
    expect(accountBudgetState(spend(14_999_999, 0), 15_000_000).exhausted).toBe(false);
  });

  it("never reports a negative remainder, however far past the cap it went", () => {
    const state = accountBudgetState(spend(20_000_000, 5_000_000), 15_000_000);

    expect(state.remainingMicros).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  /**
   * The sentence is not the monitor guard's, and the difference is the repair.
   * Nobody raises this cap, so the message must not send somebody looking for a
   * control that does not exist.
   */
  /**
   * US-133. The sentence named the cap and the spend, which printed the
   * deployment's fuse as though it were the customer's allowance — a $49
   * account told its included usage was $15. It names no figure now: what the
   * customer bought is monitors and queries, and the operator's numbers are
   * in the log line at the refusal.
   */
  it("says the month resets, names no figure, and blames nobody", () => {
    const reason = accountBudgetState(spend(25_000_000, 0), 25_000_000).reason ?? "";

    expect(reason).toContain("when the month does");
    expect(reason).toMatch(/nothing you set caused this/);
    expect(reason).not.toMatch(/\$\d/);
    expect(reason.toLowerCase()).not.toContain("raise");
  });
});

describe("the account's month, read from both ledgers", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("budget_account");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(modelCalls);
    await db.delete(apiUsage);
    await db.delete(monitors);
    await db.delete(accountKeySource);
    await db.delete(users);
  });

  async function account(id: string): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    return id;
  }

  async function monitorFor(userId: string): Promise<string> {
    const [row] = await db
      .insert(monitors)
      .values({
        userId,
        name: "A monitor",
        product: "p",
        idealCustomer: "c",
        problem: "x",
        signals: ["problem"],
        sources: ["reddit"],
      })
      .returning({ id: monitors.id });

    return row?.id as string;
  }

  const source = (userId: string, monitorId: string | null, micros: number, at = now) =>
    recordSourceUsage(db, {
      userId,
      monitorId,
      source: "reddit",
      provider: "socialcrawl",
      units: 1,
      pricePerUnitMicros: micros,
      now: at,
    });

  const model = (userId: string, monitorId: string | null, micros: number) =>
    recordModelCall(db, {
      purpose: monitorId ? "classification" : "query_generation",
      outcome: "scored",
      userId,
      monitorId,
      ...(monitorId ? { monitorVersion: 1 } : {}),
      call: {
        provider: "openai",
        model: "gpt-5.6-terra",
        latencyMs: 10,
        estimatedCostMicros: micros,
      },
    });

  /**
   * **The fuse counts what this instance lent, and nothing else.** US-141.
   *
   * Without this the cap would stop an account for the month over money we
   * never spent — its own provider and model calls, counted against our
   * ceiling. The row is stamped from the account's own state where it is
   * written, so five callers of one ledger and eight of the other cannot
   * each forget.
   */
  it("counts only the calls this instance's keys paid for", async () => {
    const ours = await account("ours");
    const theirs = await account("theirs");
    await setKeySource(db, theirs, "own");

    await source(ours, null, 4_000_000);
    await model(ours, null, 1_000_000);
    await source(theirs, null, 9_000_000);
    await model(theirs, null, 9_000_000);

    expect((await accountSpend(db, ours, now)).totalMicros).toBe(5_000_000);
    // Their own spending is theirs. The fuse cannot see it.
    expect((await accountSpend(db, theirs, now)).totalMicros).toBe(0);
  });

  it("stamps each row from the account's own state, without being told", async () => {
    const theirs = await account("stamped");
    await setKeySource(db, theirs, "own");

    await source(theirs, null, 1_000_000);

    const [row] = await db.select().from(apiUsage);
    expect(row?.keySource).toBe("own");
  });

  it("adds the provider half and the model half", async () => {
    const id = await account("one");
    const monitorId = await monitorFor(id);

    await source(id, monitorId, 2_000_000);
    await model(id, monitorId, 3_000_000);

    const total = await accountSpend(db, id, now);

    expect(total.sourceMicros).toBe(2_000_000);
    expect(total.modelMicros).toBe(3_000_000);
    expect(total.totalMicros).toBe(5_000_000);
  });

  /**
   * The whole reason `model_calls.user_id` exists. Writing a monitor's queries,
   * drafting a project and drafting a reply each belong to an account and to no
   * monitor, each is repeatable from a screen, and summing through `monitors`
   * would leave exactly those uncounted.
   */
  it("counts a call that belongs to no monitor", async () => {
    const id = await account("formy");

    await model(id, null, 4_000_000);
    await source(id, null, 1_000_000);

    expect((await accountSpend(db, id, now)).totalMicros).toBe(5_000_000);
  });

  /**
   * US-146. Both ledgers keep their rows when the monitor goes. Before this
   * `api_usage` cascaded, so deleting and re-creating a monitor reset the
   * provider half of the month — and on the plan that lends our keys, a delete
   * is one button on the projects screen.
   */
  it("still counts what a deleted monitor spent", async () => {
    const id = await account("deleter");
    const monitorId = await monitorFor(id);

    await source(id, monitorId, 3_000_000);
    await model(id, monitorId, 2_000_000);
    expect((await accountSpend(db, id, now)).totalMicros).toBe(5_000_000);

    await deleteMonitor(db, monitorId);

    expect((await accountSpend(db, id, now)).totalMicros).toBe(5_000_000);
  });

  it("counts nothing from another account", async () => {
    const mine = await account("mine");
    const theirs = await account("theirs");

    await model(theirs, null, 9_000_000);
    await source(theirs, null, 9_000_000);
    await model(mine, null, 1_000_000);

    expect((await accountSpend(db, mine, now)).totalMicros).toBe(1_000_000);
  });

  it("counts nothing from last month", async () => {
    const id = await account("old");

    await source(id, null, 8_000_000, lastMonth);
    await source(id, null, 2_000_000, now);

    expect((await accountSpend(db, id, now)).totalMicros).toBe(2_000_000);
  });

  /**
   * A null price is a call we cannot cost, and `sum` skips it. Counting it as
   * anything else would put a number nothing measured against somebody's cap.
   */
  it("counts an unpriced call as nothing rather than guessing", async () => {
    const id = await account("unpriced");

    await recordModelCall(db, {
      purpose: "query_generation",
      outcome: "scored",
      userId: id,
      call: { provider: "ollama", model: "local", latencyMs: 10 },
    });

    expect((await accountSpend(db, id, now)).modelMicros).toBe(0);
  });

  it("answers zero and asks the database nothing where no cap applies", async () => {
    const id = await account("uncapped");
    await source(id, null, 9_000_000);

    const state = await checkAccountBudget(db, id, null, now);

    // The spend is not read at all: no cap means no question, and every
    // self-hosted instance takes this path on every poll.
    expect(state.spend.totalMicros).toBe(0);
    expect(state.exhausted).toBe(false);
  });

  it("reads the ledger and decides where a cap applies", async () => {
    const id = await account("capped");
    await source(id, null, 15_000_000);

    const state = await checkAccountBudget(db, id, 15_000_000, now);

    expect(state.spend.totalMicros).toBe(15_000_000);
    expect(state.exhausted).toBe(true);
  });

  /**
   * The scheduler's question, asked once for a whole tick. It is the half that
   * matters: a poll refused in `collect.ts` has already been queued and
   * claimed, and an account over its cap whose monitors keep being queued is
   * forty refused jobs an hour until the month turns over.
   */
  it("names every account over the cap and no others, in one read", async () => {
    const over = await account("over");
    const under = await account("under");
    const exactly = await account("exactly");

    await source(over, null, 10_000_000);
    await model(over, null, 6_000_000);
    await source(under, null, 1_000_000);
    await source(exactly, null, 15_000_000);

    const found = await accountsOverCap(db, [over, under, exactly], 15_000_000, now);

    expect(found.sort()).toEqual(["exactly", "over"]);
  });

  it("asks nothing when there is nobody to ask about", async () => {
    expect(await accountsOverCap(db, [], 15_000_000, now)).toEqual([]);
  });
});
