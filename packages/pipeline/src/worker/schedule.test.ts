import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { defaultPollIntervalSeconds, monitors, subscriptions, users } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { enqueueDuePolls, findDueMonitors } from "./schedule.js";
import { fakeRegistry, fastRetries, insertMonitor, silentLogger, until } from "./testing.js";

const minutes = (count: number) => sql`now() - interval '${sql.raw(String(count))} minutes'`;

describe("which monitors are due", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("polls a monitor that has never been polled", async () => {
    const id = await insertMonitor(database);

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("leaves a monitor alone until its own interval has passed", async () => {
    // Twenty minutes ago, on a fifteen-minute interval: due.
    const due = await insertMonitor(database, { pollIntervalSeconds: 900 });
    // The same twenty minutes ago, on a one-hour interval: not due.
    //
    // This pair is the whole point of the column. A scheduler that reads a
    // constant of fifteen minutes returns both, and a scheduler that reads a
    // constant of one hour returns neither. Only one that reads the row
    // returns exactly the first.
    const notDue = await insertMonitor(database, { pollIntervalSeconds: 3600 });

    await db.update(monitors).set({ lastPolledAt: minutes(20) });

    const ids = (await findDueMonitors(db)).map((monitor) => monitor.id);

    expect(ids).toEqual([due]);
    expect(ids).not.toContain(notDue);
  });

  it("does not poll a monitor that names no source", async () => {
    await insertMonitor(database, { sources: [] });

    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("does not poll a paused monitor, however long it has waited", async () => {
    // Overdue on every other test in this file, and still not due. Pausing is
    // enforced here because it is a promise about money: a pause that only hid
    // the monitor in the UI would keep collecting and keep billing. US-010.
    const paused = await insertMonitor(database, { pausedAt: new Date() });
    const running = await insertMonitor(database);

    await db.update(monitors).set({ lastPolledAt: minutes(120) });

    const ids = (await findDueMonitors(db)).map((monitor) => monitor.id);

    expect(ids).toEqual([running]);
    expect(ids).not.toContain(paused);
  });

  it("gives a new monitor the default interval, not one the worker chose", async () => {
    const id = await insertMonitor(database);
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id));

    expect(monitor?.pollIntervalSeconds).toBe(defaultPollIntervalSeconds);
  });

  it("refuses an interval below the floor", async () => {
    // A typo of 1 instead of 100 is an invoice on a metered source, so the
    // floor is a database constraint and not form validation.
    const rejection = await insertMonitor(database, { pollIntervalSeconds: 5 }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String((rejection as { cause?: unknown })?.cause)).toMatch(
      /monitors_poll_interval_floor/,
    );
  });
});

/**
 * Two workers tick at the same time on purpose. The poll queue's policy, keyed
 * on the monitor id, is what makes the second send a no-op — not a lock this
 * repository wrote.
 */
/**
 * Which days a monitor polls on. US-041.
 *
 * A filter on the interval rather than a replacement for it, so a person can
 * say "hourly, on weekdays" without this product growing a cron parser. The
 * reason it exists is money: a B2B monitor polled on Saturday buys the weekend
 * at full price and finds the weekend's conversation.
 */
describe("the days a monitor polls on", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due_days");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  /** What day it is in Postgres's own clock, which is what the query reads. */
  async function todayInUtc(): Promise<number> {
    const [row] = (await db.execute(sql.raw("select extract(dow from now()) as dow"))).rows as {
      dow: string;
    }[];

    return Number(row?.dow);
  }

  it("polls every day unless somebody says otherwise", async () => {
    const id = await insertMonitor(database);

    // The default is all seven, so a monitor made before this column existed
    // behaves exactly as it did.
    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("does not poll on a day it was not asked to", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database);

    // Every day except this one.
    await db
      .update(monitors)
      .set({ pollDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== today) })
      .where(eq(monitors.id, id));

    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("polls on a day it was asked to, even if that is the only one", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database);

    await db
      .update(monitors)
      .set({ pollDays: [today] })
      .where(eq(monitors.id, id));

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  /**
   * The reason the timezone column exists. A person who chose weekdays meant
   * their weekdays, and in UTC a Monday in Kuala Lumpur starts at 8am on
   * Sunday.
   */
  it("counts the day in the monitor's own timezone", async () => {
    const id = await insertMonitor(database);

    // Kiritimati is UTC+14 and Niue is UTC-11: 25 hours apart, so they are
    // never on the same weekday at the same instant. Whichever day the monitor
    // is set to, exactly one of the two zones agrees.
    const [row] = (
      await db.execute(
        sql.raw(
          "select extract(dow from (now() AT TIME ZONE 'Pacific/Kiritimati')) as ahead," +
            " extract(dow from (now() AT TIME ZONE 'Pacific/Niue')) as behind",
        ),
      )
    ).rows as { ahead: string; behind: string }[];

    const ahead = Number(row?.ahead);
    const behind = Number(row?.behind);

    expect(ahead).not.toBe(behind);

    await db
      .update(monitors)
      .set({ pollDays: [ahead], pollTimezone: "Pacific/Kiritimati" })
      .where(eq(monitors.id, id));

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);

    // The same day, read in a zone where it is not that day yet.
    await db.update(monitors).set({ pollTimezone: "Pacific/Niue" }).where(eq(monitors.id, id));

    expect(await findDueMonitors(db)).toEqual([]);
  });

  /**
   * A missed window is not owed.
   *
   * The query asks whether now is inside the schedule, never how many windows
   * have passed, so a monitor whose worker was down over a weekend polls once
   * when it returns rather than three times to catch up.
   */
  it("does not owe a poll for a day it missed", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database, { pollIntervalSeconds: 3600 });

    await db
      .update(monitors)
      .set({ pollDays: [today], lastPolledAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(monitors.id, id));

    // Thirty days of missed hourly polls behind it, and it is due exactly once.
    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("refuses a monitor that can never poll", async () => {
    const id = await insertMonitor(database);

    // An empty day list reads as broken rather than as off. A person who wants
    // a monitor to stop presses pause, and pause says so on the screen.
    await expect(
      db.update(monitors).set({ pollDays: [] }).where(eq(monitors.id, id)),
    ).rejects.toThrow();
  });
});

describe("two workers ticking at once", () => {
  let database: TestDatabase;
  let firstWorker: WorkerHandle;
  let secondWorker: WorkerHandle;
  const polled: string[] = [];

  beforeAll(async () => {
    database = await createTestDatabase("worker_singleton");

    const start = () =>
      startWorker({
        databaseUrl: database.url,
        logger: silentLogger,
        registry: fakeRegistry(),
        credentialsFor: () => ({ token: "test-token" }),
        retry: fastRetries,
        scheduleTicks: false,
        steps: {
          poll: async ({ monitorId }) => {
            polled.push(monitorId);
            // Long enough that the second worker's tick lands while this one
            // is still active, which is the collision being asserted.
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      });

    firstWorker = await start();
    secondWorker = await start();
  }, 60_000);

  afterAll(async () => {
    await firstWorker?.stop();
    await secondWorker?.stop();
    await database?.drop();
  });

  it("polls each monitor once, and every monitor, however many workers tick", async () => {
    // Two monitors, not one. With a single monitor "one poll per monitor" and
    // "one poll at a time, anywhere" give the same answer, and the second is a
    // scheduler where one slow monitor holds up all the others.
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second monitor" });

    const [a, b] = await Promise.all([
      enqueueDuePolls(firstWorker.db, firstWorker.boss, silentLogger),
      enqueueDuePolls(secondWorker.db, secondWorker.boss, silentLogger),
    ]);

    expect(a.due).toBe(2);
    expect(b.due).toBe(2);
    // Four sends, two monitors, two jobs. The two that were turned away are
    // the duplicates, and the key is what makes them duplicates of each other
    // rather than of the other monitor's poll.
    expect(a.alreadyQueued + b.alreadyQueued).toBe(2);

    await until("both monitors to be polled", () => (polled.length >= 2 ? true : undefined));

    // Give a duplicate every chance to appear.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect([...polled].sort()).toEqual([first, second].sort());
  }, 30_000);

  it("releases the key once the poll has finished, so the monitor polls again", async () => {
    // The guard has to let go. A singleton key that never released would poll
    // each monitor exactly once and then go quiet, which looks like a working
    // scheduler for the first hour.
    const before = polled.length;
    const { db, close } = createDatabase(database.url);

    try {
      // The stub step does not move the mark, so age it by hand. The real step
      // moves it, and `collect.test.ts` asserts that separately.
      await db.update(monitors).set({ lastPolledAt: minutes(90) });

      const tick = await enqueueDuePolls(db, firstWorker.boss, silentLogger);

      expect(tick.due).toBe(2);
      expect(tick.alreadyQueued).toBe(0);
    } finally {
      await close();
    }

    await until("both monitors to be polled again", () =>
      polled.length >= before + 2 ? true : undefined,
    );
  }, 30_000);
});

/**
 * Who has paid, and whose monitors therefore run. US-072.
 *
 * This is the half of the billing gate that costs money. A route that refuses
 * to write is what a person sees; an account that keeps polling after its trial
 * ran out is invisible from every screen and shows up on an invoice.
 */
describe("whether the owner has paid", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due_billing");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function ownerWith(status: string, trialEndsAt: Date | null): Promise<string> {
    const id = `owner-${status}-${trialEndsAt ? trialEndsAt.getTime() : "none"}`;
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    await db.insert(subscriptions).values({ userId: id, status, trialEndsAt });
    return id;
  }

  it("polls an expired account's monitors when this deployment does not charge", async () => {
    const owner = await ownerWith("trialing", new Date(Date.now() - 60_000));
    const id = await insertMonitor(database, { userId: owner });

    /**
     * The self-hosted default, and the assertion is that nothing changed. A
     * `subscriptions` row on an instance that charges nobody must not be able
     * to stop a poll.
     */
    expect((await findDueMonitors(db, "off")).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("does not poll a monitor whose owner's trial has run out", async () => {
    const expired = await ownerWith("trialing", new Date(Date.now() - 60_000));
    const running = await ownerWith("trialing", new Date(Date.now() + 60 * 60 * 1000));

    const stopped = await insertMonitor(database, { userId: expired });
    const polling = await insertMonitor(database, { userId: running });

    const ids = (await findDueMonitors(db, "stripe")).map((monitor) => monitor.id);

    expect(ids).toEqual([polling]);
    expect(ids).not.toContain(stopped);
  });

  it("keeps polling for a past-due card and stops for a cancelled one", async () => {
    // The one judgement in the rule: a card that failed this morning is a
    // person Stripe is still retrying, and stopping their monitors throws away
    // collection they paid for. `canceled` is where Stripe gave up.
    const retrying = await ownerWith("past_due", null);
    const gone = await ownerWith("canceled", null);

    const polling = await insertMonitor(database, { userId: retrying });
    const stopped = await insertMonitor(database, { userId: gone });

    const ids = (await findDueMonitors(db, "stripe")).map((monitor) => monitor.id);

    expect(ids).toEqual([polling]);
    expect(ids).not.toContain(stopped);
  });

  it("polls for an account that has no subscription row at all", async () => {
    /**
     * No row is the normal state for an account older than the table — the
     * owner's own among them. A migration that silently stopped the instance
     * that runs the product is not a state anybody should be able to reach.
     */
    const id = await insertMonitor(database, { userId: "older-than-billing" });

    expect((await findDueMonitors(db, "stripe")).map((monitor) => monitor.id)).toEqual([id]);
  });
});
