/**
 * The entitlement rule, in both of its forms.
 *
 * Correctness-critical. The rule is written twice — once for a row already
 * read, once inside the scheduler's query — and the thing worth testing is not
 * either form on its own but that they agree. So every case below is driven
 * through `entitlementFor` and through Postgres, from the same fixture.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { type SubscriptionStatus, subscriptions, users } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { daysUntil, entitledCondition, entitlementFor, trialDays } from "./entitlement.js";
import { readSubscription, startTrial } from "./store.js";

const now = new Date("2026-09-08T12:00:00Z");
const hours = (count: number) => new Date(now.getTime() + count * 60 * 60 * 1000);

describe("the rule, without a database", () => {
  it("entitles everybody when this deployment does not charge", () => {
    const entitlement = entitlementFor({ mode: "off", subscription: null, now });

    expect(entitlement).toEqual({ entitled: true, reason: "billing_off", trialDaysLeft: null });
  });

  it("entitles an account with no row", () => {
    /**
     * Backwards until you count the two ways it happens: a self-hosted
     * instance never writes here, and a hosted one has accounts older than the
     * table. Neither is somebody who stopped paying.
     */
    const entitlement = entitlementFor({ mode: "stripe", subscription: null, now });

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.reason).toBe("no_record");
  });

  it("entitles a trial that has time left, and says how much", () => {
    const entitlement = entitlementFor({
      mode: "stripe",
      subscription: record({ status: "trialing", trialEndsAt: hours(30) }),
      now,
    });

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.reason).toBe("trialing");
    // Rounded up: thirty hours is two days left, not one. A person with four
    // hours left has a day, and zero would read as expired on a screen that
    // still works.
    expect(entitlement.trialDaysLeft).toBe(2);
  });

  it("refuses a trial whose deadline has passed", () => {
    const entitlement = entitlementFor({
      mode: "stripe",
      subscription: record({ status: "trialing", trialEndsAt: hours(-1) }),
      now,
    });

    expect(entitlement.entitled).toBe(false);
    expect(entitlement.reason).toBe("trial_expired");
  });

  it("entitles a past-due account, because Stripe is still retrying the card", () => {
    const entitlement = entitlementFor({
      mode: "stripe",
      subscription: record({ status: "past_due" }),
      now,
    });

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.reason).toBe("past_due");
  });

  it("refuses a cancelled account and an incomplete one", () => {
    expect(
      entitlementFor({ mode: "stripe", subscription: record({ status: "canceled" }), now })
        .entitled,
    ).toBe(false);
    expect(
      entitlementFor({ mode: "stripe", subscription: record({ status: "incomplete" }), now })
        .entitled,
    ).toBe(false);
  });

  it("counts whole days up, never below zero", () => {
    expect(daysUntil(hours(1), now)).toBe(1);
    expect(daysUntil(hours(24), now)).toBe(1);
    expect(daysUntil(hours(25), now)).toBe(2);
    expect(daysUntil(hours(-100), now)).toBe(0);
  });
});

function record(overrides: { status: SubscriptionStatus; trialEndsAt?: Date | null }) {
  return {
    userId: "user-1",
    trialEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("the same rule, inside a query", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  /**
   * The raw pool, for the two constraint assertions. Drizzle rewrites a
   * database error into its own message and the constraint's name is what the
   * assertion is about, so those two go straight to Postgres.
   */
  let query: Pool["query"];

  beforeAll(async () => {
    database = await createTestDatabase("billing_entitlement");
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
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function makeAccount(id: string): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    return id;
  }

  /** The accounts Postgres says are entitled, through the scheduler's own condition. */
  async function entitledInSql(): Promise<string[]> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(
        and(entitledCondition(sql`${subscriptions.status}`, sql`${subscriptions.trialEndsAt}`)),
      );

    return rows.map((row) => row.id).sort();
  }

  it("agrees with the TypeScript rule about every status", async () => {
    await makeAccount("no-row");

    const cases: { id: string; status: SubscriptionStatus; trialEndsAt: Date | null }[] = [
      { id: "trialing-left", status: "trialing", trialEndsAt: hoursFromNow(30) },
      { id: "trialing-over", status: "trialing", trialEndsAt: hoursFromNow(-1) },
      { id: "active", status: "active", trialEndsAt: null },
      { id: "past-due", status: "past_due", trialEndsAt: null },
      { id: "canceled", status: "canceled", trialEndsAt: null },
      { id: "incomplete", status: "incomplete", trialEndsAt: null },
    ];

    for (const one of cases) {
      await makeAccount(one.id);
      await db
        .insert(subscriptions)
        .values({ userId: one.id, status: one.status, trialEndsAt: one.trialEndsAt });
    }

    /**
     * The assertion that matters. Postgres answers one list; the TypeScript
     * rule answers another, from the same rows. A change to one form and not
     * the other turns this red, which is the only thing stopping the paywall
     * and the scheduler disagreeing about who has paid.
     */
    const inTypeScript: string[] = ["no-row"];

    for (const one of cases) {
      const subscription = await readSubscription(db, one.id);
      const entitlement = entitlementFor({ mode: "stripe", subscription, now: new Date() });
      if (entitlement.entitled) inTypeScript.push(one.id);
    }

    expect(await entitledInSql()).toEqual(inTypeScript.sort());
    expect(inTypeScript.sort()).toEqual(["active", "no-row", "past-due", "trialing-left"]);
  });

  it("gives a new account seven days and never a second week", async () => {
    const startedAt = new Date("2026-09-08T00:00:00Z");
    await makeAccount("new");

    const first = await startTrial(db, "new", { now: startedAt });

    expect(first.status).toBe("trialing");
    expect(first.trialEndsAt?.toISOString()).toBe("2026-09-15T00:00:00.000Z");

    /**
     * The second call is the one worth having. A hook that runs twice, or a
     * re-registration, must not hand somebody a fresh week — and must not push
     * a paying subscription back into a trial.
     */
    const again = await startTrial(db, "new", { now: new Date("2026-09-14T00:00:00Z") });

    expect(again.trialEndsAt?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(trialDays).toBe(7);
  });

  it("refuses a trialing row with no deadline, in the database", async () => {
    await makeAccount("open-ended");

    /**
     * An open-ended trial is the one thing a trial must never be, so the
     * refusal is a check constraint and not a rule in a route — a route is one
     * of the ways a row arrives.
     */
    await expect(
      query("insert into subscriptions (user_id, status) values ('open-ended', 'trialing')"),
    ).rejects.toThrow(/subscriptions_trial_has_an_end/);
  });

  it("refuses a status the application does not understand", async () => {
    await makeAccount("odd");

    await expect(
      query("insert into subscriptions (user_id, status) values ('odd', 'unpaid')"),
    ).rejects.toThrow(/subscriptions_status_known/);
  });
});

function hoursFromNow(count: number): Date {
  return new Date(Date.now() + count * 60 * 60 * 1000);
}
