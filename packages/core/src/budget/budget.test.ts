import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, budgets, modelCalls, monitors } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { insertMonitor } from "../worker/testing.js";
import {
  budgetState,
  budgetStates,
  checkBudget,
  clearBudget,
  enforceBudget,
  formatMicros,
  monitorSpend,
  monthStart,
  recordSourceUsage,
  setBudget,
  spendByMonitor,
} from "./budget.js";

/** The account these cases spend on. BUG-009 put the owner on every usage row. */
const owner = "user-1";

/**
 * The budget guard, written before the guard.
 *
 * docs/testing.md names this one of the five correctness-critical surfaces,
 * and its failure shape is "money is spent past a cap, silently, while nobody
 * is watching". Every expected number below is a literal a person can check
 * against the price in `sources/providers/brightdata/reddit.ts` — $1.50 per 1,000 records,
 * so 1,500 micro-dollars per record — and none of them is recomputed the way
 * the code computes it.
 */

/** Reddit's own price. Written out here so the test does not import the code's copy. */
const redditPricePerRecord = 1500;

/** A fixed clock. The month boundary is what several of these assertions turn on. */
const march = new Date("2026-03-14T09:00:00.000Z");

describe("the budget guard", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("budget_guard");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(modelCalls);
    await db.delete(monitors);
    // A usage row that belongs to a monitor goes with it. One that belongs to
    // no monitor — US-014's cost test — outlives every monitor, which is
    // correct and is why this line exists.
    await db.delete(apiUsage);
  });

  describe("recording what a source spent", () => {
    it("multiplies the units the source reported by the source's own price", async () => {
      const monitorId = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 10,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const [row] = await db.select().from(apiUsage);

      // Ten records at $1.50 per thousand is one and a half cents.
      expect(row?.units).toBe(10);
      expect(row?.estimatedCostMicros).toBe(15_000);
      expect(row?.day).toBe("2026-03-14");
      expect(row?.source).toBe("reddit");
    });

    it("adds a second page to the day's row rather than writing a second row", async () => {
      const monitorId = await insertMonitor(database);
      const page = {
        monitorId,
        source: "reddit" as const,
        provider: "brightdata" as const,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      };

      await recordSourceUsage(db, { userId: owner, ...page, units: 10 });
      await recordSourceUsage(db, { userId: owner, ...page, units: 4 });

      const rows = await db.select().from(apiUsage);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.units).toBe(14);
      expect(rows[0]?.estimatedCostMicros).toBe(21_000);
    });

    it("records a call that belongs to no monitor, and keeps it off every cap", async () => {
      // US-014's cost test runs before the monitor exists, which is the point
      // of it. The row is on the bill and on no monitor's cap, the same as a
      // query the model wrote from the same form.
      const monitorId = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId: null,
        source: "reddit",
        provider: "brightdata",
        units: 10,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });
      await recordSourceUsage(db, {
        userId: owner,
        monitorId: null,
        source: "reddit",
        provider: "brightdata",
        units: 4,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const rows = await db.select().from(apiUsage);

      // One row, not two. Postgres counts two nulls as different unless the
      // constraint says otherwise, and a row per press of a button would grow
      // this table without limit.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.monitorId).toBeNull();
      expect(rows[0]?.units).toBe(14);

      expect((await monitorSpend(db, monitorId, march)).totalMicros).toBe(0);
      expect((await spendByMonitor(db, march)).get(monitorId)?.sourceMicros).toBe(0);
    });

    it("keeps a day, a source and a monitor apart", async () => {
      const first = await insertMonitor(database);
      const second = await insertMonitor(database);
      const common = { pricePerUnitMicros: redditPricePerRecord, units: 1 };

      await recordSourceUsage(db, {
        userId: owner,
        ...common,
        monitorId: first,
        source: "reddit",
        provider: "brightdata",
        now: march,
      });
      await recordSourceUsage(db, {
        userId: owner,
        ...common,
        monitorId: first,
        source: "x",
        provider: "brightdata",
        now: march,
      });
      await recordSourceUsage(db, {
        userId: owner,
        ...common,
        monitorId: first,
        source: "reddit",
        provider: "brightdata",
        now: new Date("2026-03-15T09:00:00.000Z"),
      });
      await recordSourceUsage(db, {
        userId: owner,
        ...common,
        monitorId: second,
        source: "reddit",
        provider: "brightdata",
        now: march,
      });

      expect(await db.select().from(apiUsage)).toHaveLength(4);
    });

    it("records a call that was billed nothing", async () => {
      // A Bright Data trigger bills no records, and a poll that finds only old
      // posts bills records and returns none. A ledger that skipped the free
      // call could not tell "polled and cost nothing" from "never polled".
      const monitorId = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 0,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const [row] = await db.select().from(apiUsage);

      expect(row?.units).toBe(0);
      expect(row?.estimatedCostMicros).toBe(0);
    });
  });

  describe("what a monitor has spent this month", () => {
    it("adds the source cost and the model cost", async () => {
      const monitorId = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 20,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });
      await db.insert(modelCalls).values({
        monitorId,
        // The check constraint: a classification records the version it
        // answered, so that BUG-003's skip can read it.
        monitorVersion: 1,
        provider: "anthropic",
        model: "test-model",
        outcome: "scored",
        latencyMs: 10,
        estimatedCostMicros: 1_000,
        createdAt: march,
      });

      const spend = await monitorSpend(db, monitorId, march);

      expect(spend.sourceMicros).toBe(30_000);
      expect(spend.modelMicros).toBe(1_000);
      expect(spend.totalMicros).toBe(31_000);
    });

    it("counts nothing from before this month", async () => {
      const monitorId = await insertMonitor(database);
      const february = new Date("2026-02-27T09:00:00.000Z");

      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 100,
        pricePerUnitMicros: redditPricePerRecord,
        now: february,
      });
      await db.insert(modelCalls).values({
        monitorId,
        // The check constraint: a classification records the version it
        // answered, so that BUG-003's skip can read it.
        monitorVersion: 1,
        provider: "anthropic",
        model: "test-model",
        outcome: "scored",
        latencyMs: 10,
        estimatedCostMicros: 5_000,
        createdAt: february,
      });

      const spend = await monitorSpend(db, monitorId, march);

      expect(spend.totalMicros).toBe(0);
      // A cap is monthly, so the month must start on the first at midnight UTC.
      expect(spend.since.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    });

    it("counts nothing from another monitor", async () => {
      const mine = await insertMonitor(database);
      const theirs = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId: theirs,
        source: "reddit",
        provider: "brightdata",
        units: 100,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      expect((await monitorSpend(db, mine, march)).totalMicros).toBe(0);
    });

    it("counts a model call whose price was not known as nothing, not as a guess", async () => {
      // `model_calls.estimated_cost_micros` is null when the model's price is
      // not configured. Null means "we cannot say". Inventing a number here
      // would put a figure on a bill page that nothing measured.
      const monitorId = await insertMonitor(database);

      await db.insert(modelCalls).values({
        monitorId,
        // The check constraint: a classification records the version it
        // answered, so that BUG-003's skip can read it.
        monitorVersion: 1,
        provider: "ollama",
        model: "test-model",
        outcome: "scored",
        latencyMs: 10,
        estimatedCostMicros: null,
        createdAt: march,
      });

      expect((await monitorSpend(db, monitorId, march)).modelMicros).toBe(0);
    });

    it("applies the same rule to every monitor in one read", async () => {
      // The list route and the guard must not be two readings of one rule.
      const capped = await insertMonitor(database);
      const uncapped = await insertMonitor(database);

      // A dollar cap, and a thousand records at $1.50 per thousand on top of it.
      await setBudget(db, capped, { monthlyCapMicros: 1_000_000, onExhausted: "notify" });
      await recordSourceUsage(db, {
        userId: owner,
        monitorId: capped,
        source: "reddit",
        provider: "brightdata",
        units: 1_000,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const states = await budgetStates(db, march);

      expect(states.get(capped)?.exhausted).toBe(true);
      expect(states.get(capped)?.reason).toContain("an estimated $1.50 of its $1.00");
      expect(states.get(uncapped)?.exhausted).toBe(false);
      expect(states.get(uncapped)?.capMicros).toBeNull();
    });

    it("reports every monitor in one read, for the screen that lists them", async () => {
      const first = await insertMonitor(database);
      const second = await insertMonitor(database);

      await recordSourceUsage(db, {
        userId: owner,
        monitorId: first,
        source: "reddit",
        provider: "brightdata",
        units: 2,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const spend = await spendByMonitor(db, march);

      expect(spend.get(first)?.totalMicros).toBe(3_000);
      expect(spend.get(second)?.totalMicros).toBe(0);
    });
  });

  describe("the rule itself", () => {
    const spend = (totalMicros: number) => ({
      sourceMicros: totalMicros,
      modelMicros: 0,
      totalMicros,
      since: monthStart(march),
    });

    it("lets a monitor with no cap poll, and still says what it spent", () => {
      const state = budgetState(spend(500_000), null);

      expect(state.exhausted).toBe(false);
      expect(state.capMicros).toBeNull();
      expect(state.remainingMicros).toBeNull();
      expect(state.reason).toBeNull();
      expect(state.spend.totalMicros).toBe(500_000);
    });

    it("subtracts what was spent from the cap", () => {
      // A dollar cap, forty cents spent, sixty cents left.
      const state = budgetState(spend(400_000), {
        monthlyCapMicros: 1_000_000,
        onExhausted: "pause",
      });

      expect(state.exhausted).toBe(false);
      expect(state.remainingMicros).toBe(600_000);
    });

    it("refuses at the cap, not past it", () => {
      const state = budgetState(spend(1_000_000), {
        monthlyCapMicros: 1_000_000,
        onExhausted: "pause",
      });

      expect(state.exhausted).toBe(true);
      expect(state.remainingMicros).toBe(0);
    });

    it("reports nothing left rather than a negative remainder", () => {
      // One poll may overshoot: a page is billed when it is fetched, and the
      // guard runs before the poll and cannot know what the poll will cost.
      const state = budgetState(spend(1_400_000), {
        monthlyCapMicros: 1_000_000,
        onExhausted: "pause",
      });

      expect(state.exhausted).toBe(true);
      expect(state.remainingMicros).toBe(0);
    });

    it("refuses a cap of zero before anything is spent", () => {
      const state = budgetState(spend(0), { monthlyCapMicros: 0, onExhausted: "notify" });

      expect(state.exhausted).toBe(true);
    });

    it("says why, with both figures and the word estimated", () => {
      const state = budgetState(spend(1_020_000), {
        monthlyCapMicros: 1_000_000,
        onExhausted: "pause",
      });

      expect(state.reason).toBe(
        "Stopped at the budget: this monitor has spent an estimated $1.02 of its $1.00 monthly " +
          "budget. It is not collecting, and posts it already collected are not being scored. " +
          "Raise the cap to start both again.",
      );
    });
  });

  describe("enforcing it before a poll", () => {
    it("allows a monitor that has no budget row", async () => {
      const monitorId = await insertMonitor(database);

      expect((await checkBudget(db, monitorId, march)).exhausted).toBe(false);
    });

    it("refuses once the recorded spend reaches the cap", async () => {
      const monitorId = await insertMonitor(database);

      // Six hundred records at $1.50 per thousand is ninety cents.
      await setBudget(db, monitorId, { monthlyCapMicros: 900_000, onExhausted: "pause" });
      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 600,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const state = await checkBudget(db, monitorId, march);

      expect(state.spend.totalMicros).toBe(900_000);
      expect(state.exhausted).toBe(true);
    });

    it("pauses the monitor when that is the behaviour it was given", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "pause" });
      const state = await enforceBudget(db, monitorId, march);

      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

      expect(state.exhausted).toBe(true);
      expect(monitor?.pausedAt).not.toBeNull();
    });

    it("leaves the monitor running when the behaviour is notify", async () => {
      // The difference between the two behaviours is what happens next month.
      // A notifying monitor starts polling again on its own when the spend
      // resets; a paused one waits for a person.
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "notify" });
      const state = await enforceBudget(db, monitorId, march);

      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

      expect(state.exhausted).toBe(true);
      expect(monitor?.pausedAt).toBeNull();
    });

    it("does not touch a monitor that is inside its cap", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 1_000_000, onExhausted: "pause" });
      await enforceBudget(db, monitorId, march);

      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

      expect(monitor?.pausedAt).toBeNull();
    });

    it("keeps recording after the cap is gone, so the month is still countable", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 1_000_000, onExhausted: "pause" });
      await clearBudget(db, monitorId);
      await recordSourceUsage(db, {
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "brightdata",
        units: 2,
        pricePerUnitMicros: redditPricePerRecord,
        now: march,
      });

      const state = await checkBudget(db, monitorId, march);

      expect(await db.select().from(budgets)).toHaveLength(0);
      expect(state.exhausted).toBe(false);
      expect(state.spend.totalMicros).toBe(3_000);
    });

    it("replaces a cap rather than adding a second one", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 1_000_000, onExhausted: "pause" });
      await setBudget(db, monitorId, { monthlyCapMicros: 5_000_000, onExhausted: "notify" });

      const state = await checkBudget(db, monitorId, march);

      expect(state.capMicros).toBe(5_000_000);
      expect(state.onExhausted).toBe("notify");
    });
  });

  describe("writing a figure a person reads", () => {
    it("shows cents for a whole amount and more places for a small one", () => {
      // Ten Reddit records cost $0.015. Rounded to cents that is two cents,
      // and a bill page that rounds up the small numbers is a bill page
      // nobody can reconcile.
      expect(formatMicros(15_000_000)).toBe("$15.00");
      expect(formatMicros(15_000)).toBe("$0.015");
      expect(formatMicros(0)).toBe("$0.00");
    });
  });
});
